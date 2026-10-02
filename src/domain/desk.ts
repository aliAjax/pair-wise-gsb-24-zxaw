import {
  allocateSlots,
  findInvalidated,
  occupancyFrom,
  RULE_VERSION,
} from "./allocation";
import { canHold, loadsOf, planBoxing } from "./boxing";
import { LedgerStore, placementKey, type PlacementOp } from "./ledger";
import { mergeNodeEdits } from "./merge";
import {
  LEVEL_NAMES,
  NODE_NAMES,
  type Artifact,
  type CabinetSlot,
  type DeskEvent,
  type EventKind,
  type Level,
  type MergeConflict,
  type MoveOp,
  type NodeId,
  type Registration,
  type TurnoverBox,
} from "./types";

export interface DeskSeed {
  artifacts: Artifact[];
  boxes: TurnoverBox[];
  slots: CabinetSlot[];
}

export interface BatchProgress {
  total: number;
  done: number;
  interrupted: boolean;
}

export interface DeskState {
  artifacts: Artifact[];
  boxes: TurnoverBox[];
  slots: CabinetSlot[];
  connection: "online" | "offline";
  activeNode: NodeId;
  /** 三端记录：现场端 / 库房端各自视图，交接台基线（合并后的共同视图） */
  nodeViews: Record<NodeId, Record<string, string | null>>;
  baseView: Record<string, string | null>;
  pendingOps: Record<NodeId, MoveOp[]>;
  unassigned: string[];
  /** 满柜排队的箱（按分配优先级排序） */
  queue: string[];
  registrations: Registration[];
  conflicts: MergeConflict[];
  events: DeskEvent[];
  lastBatch: BatchProgress | null;
}

export interface ExecuteOptions {
  /** 写入中断：只落账前 N 项 */
  failAfter?: number;
  /** 应答丢失：全部落账，但前 N 项之后的结果调用方收不到 */
  loseResponseAfter?: number;
}

const emptyView = (artifacts: Artifact[]): Record<string, string | null> =>
  Object.fromEntries(artifacts.map((a) => [a.id, null]));

/**
 * 交接台：把现场端、库房端两套记录与交接台自身的登记流水接到一处。
 * 所有命令走统一入口，状态变更后 commit 一次，UI 订阅快照。
 */
export class HandoffDesk {
  private state: DeskState;
  private ledger: LedgerStore;
  private listeners = new Set<() => void>();
  private regSeq = 0;
  private conflictSeq = 0;
  private eventSeq = 0;
  private opSeq = 0;

  constructor(
    seed: DeskSeed,
    private now: () => string = () => new Date().toISOString(),
  ) {
    const view = emptyView(seed.artifacts);
    this.state = {
      artifacts: seed.artifacts,
      boxes: seed.boxes,
      slots: seed.slots,
      connection: "online",
      activeNode: "field",
      nodeViews: { field: { ...view }, warehouse: { ...view } },
      baseView: { ...view },
      pendingOps: { field: [], warehouse: [] },
      unassigned: [],
      queue: [],
      registrations: [],
      conflicts: [],
      events: [],
      lastBatch: null,
    };
    this.ledger = new LedgerStore(this.slotMap(), {});
    this.log("connection", "交接台就绪：现场端、库房端记录已挂上共同基线");
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): DeskState => this.state;

  // ---------------------------------------------------------------- 装箱

  /** 自动装箱：按重量与易碎等级分箱，三端视图同步刷新。 */
  runBoxing(): void {
    if (this.state.connection === "offline") {
      this.log("boxing", "离线期间不能重排装箱，请先回连合并");
      this.commit();
      return;
    }
    const result = planBoxing(this.state.artifacts, this.state.boxes);
    const view: Record<string, string | null> = emptyView(this.state.artifacts);
    for (const p of result.placements) view[p.artifactId] = p.boxId;
    this.state.baseView = view;
    this.state.nodeViews = { field: { ...view }, warehouse: { ...view } };
    this.state.unassigned = result.unassigned;
    const placed = result.placements.length;
    this.log(
      "boxing",
      `装箱完成：${placed} 件入箱` +
        (result.unassigned.length ? `，${result.unassigned.length} 件无箱可装（超重或等级不符）` : ""),
    );
    this.commit();
  }

  // ---------------------------------------------------------------- 登记

  /** 封箱登记：为有内容的箱分配库位，满柜的箱进入排队。 */
  sealAndRegister(): void {
    const loads = this.currentLoads();
    const active = new Set(
      this.state.registrations.filter((r) => r.status !== "invalidated").map((r) => r.boxId),
    );
    const candidates = this.state.boxes
      .filter((b) => (loads[b.id] ?? 0) > 0 && !active.has(b.id) && !this.state.queue.includes(b.id))
      .map((b) => b.id);
    if (candidates.length === 0) {
      this.log("register", "没有待登记的箱（空箱不登记）");
      this.commit();
      return;
    }
    this.reallocate(candidates);
    this.commit();
  }

  // ---------------------------------------------------------------- 入库写入

  /** 执行入库：把待入库登记写成一批放置指令落台账。 */
  executePending(opts: ExecuteOptions = {}): void {
    this.runBatch(opts, "store");
  }

  /** 断点续作：只重放上批未完成的箱；已落账的靠幂等键跳过。 */
  retryIncomplete(): void {
    this.runBatch({}, "retry");
  }

  private runBatch(opts: ExecuteOptions, kind: "store" | "retry"): void {
    const pending = this.state.registrations
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.id.localeCompare(b.id));
    if (pending.length === 0) {
      this.log(kind, "没有待入库的箱");
      this.commit();
      return;
    }
    if (kind === "retry") {
      this.log("retry", `断点续作：只重放未完成的 ${pending.length} 箱`);
    }
    const ops: PlacementOp[] = pending.map((reg) => ({
      key: placementKey(reg.boxId, reg.slotId),
      registrationId: reg.id,
      boxId: reg.boxId,
      slotId: reg.slotId,
    }));
    const { results, failedAt } = this.ledger.applyBatch(ops, opts);

    const recompute: string[] = [];
    for (const { op, outcome } of results) {
      const reg = pending.find((r) => r.id === op.registrationId);
      if (!reg) continue;
      const boxCode = this.boxCode(reg.boxId);
      const slotCode = this.slotCode(reg.slotId);
      if (outcome === "applied") {
        reg.status = "stored";
        reg.storedAt = this.now();
        this.log("store", `${reg.id} 已入库：${boxCode} → 库位 ${slotCode}`);
      } else if (outcome === "duplicate") {
        reg.status = "stored";
        reg.storedAt = this.now();
        this.log("store", `${reg.id} 重放命中幂等键（${boxCode}@${slotCode}），未重复占库位`);
      } else if (outcome === "slot_full") {
        reg.status = "invalidated";
        reg.invalidReason = `落账时库位 ${slotCode} 已被占满`;
        recompute.push(reg.boxId);
        this.log("invalidate", `${reg.id} 落账失败：库位 ${slotCode} 已满，${boxCode} 重新分配`);
      } else {
        reg.status = "invalidated";
        reg.invalidReason = "该箱已入其他库位，登记过期";
        this.log("invalidate", `${reg.id} 落账失败：${boxCode} 已在其他库位，登记作废`);
      }
    }

    if (failedAt !== null) {
      this.state.lastBatch = { total: ops.length, done: failedAt, interrupted: true };
      this.log(
        kind,
        `批次中断：${ops.length} 项只完成 ${failedAt} 项，剩余箱保持待入库，可断点续作`,
      );
    } else {
      this.state.lastBatch = { total: ops.length, done: results.length, interrupted: false };
    }
    if (recompute.length > 0) this.reallocate(recompute);
    this.commit();
  }

  // ---------------------------------------------------------------- 主数据变更 → 失效重算

  /** 库位等级调整：引用该库位的待入库登记失效重算；已入库记录保留当时依据。 */
  changeSlotLevel(slotId: string, level: Level): void {
    const slot = this.state.slots.find((s) => s.id === slotId);
    if (!slot || slot.level === level) return;
    const old = slot.level;
    slot.level = level;
    this.log(
      "invalidate",
      `库位 ${slot.code} 等级调整：${LEVEL_NAMES[old]} → ${LEVEL_NAMES[level]}`,
    );
    this.invalidateAndRecompute({ slotIds: [slotId] }, `库位 ${slot.code} 等级变为 ${LEVEL_NAMES[level]}`);
    this.commit();
  }

  /** 箱防护等级调整：该箱的待入库登记失效重算；已入库记录不动。 */
  changeBoxLevel(boxId: string, level: Level): void {
    const box = this.state.boxes.find((b) => b.id === boxId);
    if (!box || box.level === level) return;
    const old = box.level;
    box.level = level;
    this.log(
      "invalidate",
      `周转箱 ${box.code} 防护等级调整：${LEVEL_NAMES[old]} → ${LEVEL_NAMES[level]}`,
    );
    const over = this.state.artifacts.filter(
      (a) => this.state.baseView[a.id] === boxId && a.fragility > level,
    );
    if (over.length > 0) {
      this.log(
        "invalidate",
        `注意：${box.code} 内 ${over.map((a) => a.code).join("、")} 的易碎等级超出新防护等级，请重新装箱`,
      );
    }
    this.invalidateAndRecompute({ boxIds: [boxId] }, `箱 ${box.code} 等级变为 ${LEVEL_NAMES[level]}`);
    this.commit();
  }

  private invalidateAndRecompute(
    changed: { slotIds?: string[]; boxIds?: string[] },
    reason: string,
  ): void {
    const invalidated = findInvalidated(this.state.registrations, changed);
    for (const reg of invalidated) {
      reg.status = "invalidated";
      reg.invalidReason = reason;
      this.log(
        "invalidate",
        `${reg.id} 失效（${reason}）；已入库记录不受影响，保留当时依据`,
      );
    }
    const before = this.state.registrations.filter((r) => r.status === "pending");
    this.reallocate(invalidated.map((r) => r.boxId));
    const after = this.state.registrations.filter((r) => r.status === "pending");
    for (const oldReg of invalidated) {
      const next = after.find(
        (r) => r.boxId === oldReg.boxId && !before.some((b) => b.id === r.id),
      );
      if (next) oldReg.supersededBy = next.id;
    }
  }

  /** 统一的重分配入口：候选箱 + 排队箱一起按规则分配，分不到的继续排队。 */
  private reallocate(candidates: string[]): void {
    const pool = [...new Set([...candidates, ...this.state.queue])];
    if (pool.length === 0) return;
    const wasQueued = new Set(this.state.queue);
    const occupancy = occupancyFrom(this.state.registrations, this.currentLoads());
    const { registrations, queued } = allocateSlots({
      boxIds: pool,
      boxes: new Map(this.state.boxes.map((b) => [b.id, b])),
      boxLoads: this.currentLoads(),
      slots: this.state.slots,
      occupancy,
      now: this.now(),
      nextRegId: () => this.nextRegId(),
    });
    this.state.registrations.push(...registrations);
    for (const reg of registrations) {
      this.log(
        "register",
        `${reg.id} 登记：${reg.basis.boxCode} → 库位 ${reg.basis.slotCode}` +
          `（依据：箱 ${LEVEL_NAMES[reg.basis.boxLevel]} / 柜 ${LEVEL_NAMES[reg.basis.slotLevel]}，${reg.basis.ruleVersion}）`,
      );
      if (wasQueued.has(reg.boxId)) {
        this.log("queue", `${reg.basis.boxCode} 结束排队，补位成功`);
      }
    }
    for (const boxId of queued) {
      if (!wasQueued.has(boxId)) {
        this.log("queue", `满柜：${this.boxCode(boxId)} 无可用库位，进入排队`);
      }
    }
    this.state.queue = queued;
  }

  // ---------------------------------------------------------------- 离线 / 合并

  setConnection(connection: "online" | "offline"): void {
    if (this.state.connection === connection) return;
    if (connection === "offline") {
      this.state.connection = "offline";
      this.state.pendingOps = { field: [], warehouse: [] };
      this.log("connection", "已离线：两端各自记录，改动逐件暂存，回连后合并");
    } else {
      const { merged, conflicts, autoMerged } = mergeNodeEdits({
        base: this.state.baseView,
        fieldOps: this.state.pendingOps.field,
        warehouseOps: this.state.pendingOps.warehouse,
        now: this.now(),
        conflictId: () => this.nextConflictId(),
      });
      this.state.connection = "online";
      this.state.baseView = merged;
      this.state.nodeViews = { field: { ...merged }, warehouse: { ...merged } };
      this.state.pendingOps = { field: [], warehouse: [] };
      this.state.conflicts.push(...conflicts);
      for (const m of autoMerged) {
        const target = m.toBoxId === null ? "待装箱" : this.boxCode(m.toBoxId);
        this.log("merge", `逐件合并：${this.artifactCode(m.artifactId)} 采用${NODE_NAMES[m.from]}改动 → ${target}`);
      }
      for (const c of conflicts) {
        this.log(
          "conflict",
          `同一出土物两边换箱：${this.artifactCode(c.artifactId)} 现场版 ${this.boxCodeOr(c.fieldBoxId)} / 库房版 ${this.boxCodeOr(c.warehouseBoxId)}，两版保留待裁决`,
        );
      }
      if (autoMerged.length === 0 && conflicts.length === 0) {
        this.log("merge", "回连合并：两端无分歧改动");
      }
      this.warnOverflow();
    }
    this.commit();
  }

  setActiveNode(node: NodeId): void {
    this.state.activeNode = node;
    this.commit();
  }

  /** 移箱：在线时三端同步；离线时只记到当前操作端，回连后逐件合并。 */
  moveArtifact(artifactId: string, toBoxId: string | null): void {
    const artifact = this.state.artifacts.find((a) => a.id === artifactId);
    if (!artifact) return;
    const offline = this.state.connection === "offline";
    const node = this.state.activeNode;
    const view = offline ? this.state.nodeViews[node] : this.state.baseView;
    if ((view[artifactId] ?? null) === toBoxId) return;

    if (toBoxId !== null) {
      const box = this.state.boxes.find((b) => b.id === toBoxId);
      if (!box) return;
      const loads = loadsOf(view, this.state.artifacts);
      if (!canHold(box, artifact, loads[toBoxId] ?? 0)) {
        this.log(
          "merge",
          `移箱被拒：${artifact.code} 放不进 ${box.code}（等级或承重不足），保持原箱`,
        );
        this.commit();
        return;
      }
    }

    if (offline) {
      this.state.nodeViews[node] = { ...view, [artifactId]: toBoxId };
      this.state.pendingOps[node] = [
        ...this.state.pendingOps[node].filter((op) => op.artifactId !== artifactId),
        {
          seq: ++this.opSeq,
          node,
          artifactId,
          toBoxId,
          at: this.now(),
        },
      ];
      this.log(
        "merge",
        `${NODE_NAMES[node]}离线改动：${artifact.code} → ${toBoxId === null ? "待装箱" : this.boxCode(toBoxId)}（待回连合并）`,
      );
    } else {
      this.state.baseView = { ...this.state.baseView, [artifactId]: toBoxId };
      this.state.nodeViews = {
        field: { ...this.state.baseView },
        warehouse: { ...this.state.baseView },
      };
      this.log(
        "merge",
        `移箱：${artifact.code} → ${toBoxId === null ? "待装箱" : this.boxCode(toBoxId)}，三端同步`,
      );
    }
    this.commit();
  }

  /** 保管员裁决：选定一版，另一版释放，出土物不再暗占两个箱。 */
  resolveConflict(conflictId: string, chosen: NodeId): void {
    const conflict = this.state.conflicts.find((c) => c.id === conflictId);
    if (!conflict || conflict.status !== "awaiting") return;
    const winning = chosen === "field" ? conflict.fieldBoxId : conflict.warehouseBoxId;
    conflict.status = "resolved";
    conflict.resolution = { chosen, resolvedAt: this.now() };
    this.state.baseView = { ...this.state.baseView, [conflict.artifactId]: winning };
    this.state.nodeViews = {
      field: { ...this.state.baseView },
      warehouse: { ...this.state.baseView },
    };
    this.log(
      "resolve",
      `保管员裁决：${this.artifactCode(conflict.artifactId)} 采用${NODE_NAMES[chosen]}版 → ${this.boxCodeOr(winning)}，另一版释放`,
    );
    this.commit();
  }

  // ---------------------------------------------------------------- 内部

  private warnOverflow(): void {
    const loads = loadsOf(this.state.baseView, this.state.artifacts);
    for (const box of this.state.boxes) {
      const load = loads[box.id] ?? 0;
      if (load > box.maxWeightGrams) {
        this.log(
          "merge",
          `合并后 ${box.code} 超重（${load}g / ${box.maxWeightGrams}g），请调整装箱`,
        );
      }
    }
  }

  private currentLoads(): Record<string, number> {
    return loadsOf(this.state.baseView, this.state.artifacts);
  }

  private slotMap(): Map<string, CabinetSlot> {
    return new Map(this.state.slots.map((s) => [s.id, s]));
  }

  private boxCode(boxId: string): string {
    return this.state.boxes.find((b) => b.id === boxId)?.code ?? boxId;
  }

  private boxCodeOr(boxId: string | null): string {
    return boxId === null ? "待装箱" : this.boxCode(boxId);
  }

  private slotCode(slotId: string): string {
    return this.state.slots.find((s) => s.id === slotId)?.code ?? slotId;
  }

  private artifactCode(artifactId: string): string {
    return this.state.artifacts.find((a) => a.id === artifactId)?.code ?? artifactId;
  }

  private nextRegId(): string {
    return `REG-${String(++this.regSeq).padStart(3, "0")}`;
  }

  private nextConflictId(): string {
    return `CF-${String(++this.conflictSeq).padStart(2, "0")}`;
  }

  private log(kind: EventKind, message: string): void {
    this.state.events = [
      ...this.state.events,
      { seq: ++this.eventSeq, at: this.now(), kind, message },
    ].slice(-300);
  }

  private commit(): void {
    this.ledger.syncMasterData(this.slotMap(), this.currentLoads());
    this.state = { ...this.state };
    for (const fn of this.listeners) fn();
  }
}

export { RULE_VERSION };
