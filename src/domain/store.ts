import type {
  ArtifactDoc, Assignment, Batch, BoxOp, Conflict, Grade,
  HandoverState, LogEntry, Site,
} from "./types";
import {
  SEED_ARTIFACTS, SEED_BOXES, SEED_LOCATIONS, boxLoad, canAcceptFragility, findBox, findLoc, now,
} from "./util";
import { planPacking } from "./planner";

// ---------- 初始化 ----------

export function initialState(): HandoverState {
  const docs: HandoverState["docs"] = {};
  for (const a of SEED_ARTIFACTS) {
    docs[a.id] = { boxId: null, vclock: { hub: 0 } };
  }
  return {
    catalogVersion: 1,
    artifacts: structuredClone(SEED_ARTIFACTS),
    boxes: structuredClone(SEED_BOXES),
    locations: structuredClone(SEED_LOCATIONS),
    docs,
    placements: {},
    queue: [],
    assignments: {},
    conflicts: {},
    batch: null,
    nodes: {
      site: { online: true, clock: 0, edits: {}, baseVc: {} },
      vault: { online: true, clock: 0, edits: {}, baseVc: {} },
    },
    failureMode: "none",
    log: [{ id: 0, t: now(), level: "info", msg: "台账建立：现场与库房共用出土物总台账（catalog v1）" }],
    tick: 1,
  };
}

// ---------- Action ----------

export type Action =
  | { type: "RESET" }
  | { type: "SET_ONLINE"; node: Site; online: boolean }
  | { type: "SET_FAILURE"; mode: HandoverState["failureMode"] }
  | { type: "MOVE"; node: Site; artifactId: string; toBoxId: string }
  | { type: "RECONNECT"; node: Site }
  | { type: "ADJUDICATE"; artifactId: string; boxId: string; note: string }
  | { type: "CHANGE_BOX"; id: string; grade?: Grade; maxLoadKg?: number }
  | { type: "CHANGE_LOCATION"; id: string; grade?: Grade; boxSlots?: number; maxLoadKg?: number }
  | { type: "REPLAN"; reason?: string }
  | { type: "BUILD_BATCH" }
  | { type: "RUN_BATCH" }
  | { type: "RETRY_BATCH" }
  | { type: "CLEAR_LOG" };

// ---------- 基础工具 ----------

function log(s: HandoverState, level: LogEntry["level"], msg: string) {
  s.log = [{ id: s.tick, t: now(), level, msg }, ...s.log].slice(0, 80);
  s.tick += 1;
}

/** 向量时钟：a 是否支配 b（a 的每一维都 ≥ b） */
function dominates(a: Record<string, number>, b: Record<string, number>): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[k] ?? 0) < (b[k] ?? 0)) return false;
  }
  return true;
}

function applyPlan(s: HandoverState, reason: string | undefined) {
  const plan = planPacking(s);
  for (const a of s.artifacts) {
    const doc = s.docs[a.id];
    if (doc.quarantine) continue; // 冲突未裁决，不自动装箱
    const boxId = plan.membership[a.id];
    doc.boxId = boxId ?? null;
    const row = plan.assignments[a.id];
    if (row) {
      s.assignments[a.id] = row;
    } else if (s.assignments[a.id]?.state !== "stored") {
      delete s.assignments[a.id];
    }
  }
  s.queue = plan.queue;
  // 活动批次的成员/柜位快照若与新方案漂移（回连合并、裁决、手工重算），即失效需重建
  if (s.batch && (s.batch.status === "running" || s.batch.status === "interrupted")) {
    const drifted = s.batch.ops.some((op) => {
      const nowMembers = s.artifacts.filter((a) => plan.membership[a.id] === op.boxId).map((a) => a.id).sort();
      const oldMembers = [...op.artifactIds].sort();
      if (JSON.stringify(nowMembers) !== JSON.stringify(oldMembers)) return true;
      if (!op.stages.claimed && (plan.boxLocation[op.boxId] ?? null) !== op.plannedLocationId) return true;
      return false;
    });
    if (drifted) {
      s.batch.status = "invalid";
      log(s, "warn", `批次 ${s.batch.id} 的装箱方案已漂移，标记失效，需重建批次（已完成箱的入库不受影响）`);
    }
  }
  for (const w of plan.warnings) log(s, "warn", w);
  return plan;
}

function markPendingStale(s: HandoverState, reason: string) {
  let n = 0;
  for (const row of Object.values(s.assignments)) {
    if (row.state === "planned") {
      row.state = "stale";
      row.staleReason = reason;
      n += 1;
    }
  }
  if (s.batch && s.batch.status !== "done") {
    s.batch.status = "invalid";
    log(s, "warn", `进行中的交接批次 ${s.batch.id} 依据已变更，标记失效，需重建批次`);
  }
  return n;
}

// ---------- 离线改动与回连合并 ----------

function localMove(s: HandoverState, node: Site, artifactId: string, toBoxId: string) {
  const doc = s.docs[artifactId];
  const box = findBox(s, toBoxId);
  if (!doc || !box) return;
  if (s.nodes[node].online) {
    // 在线：直接写主台账（hub 受理），节点时钟 +1
    doc.boxId = toBoxId;
    doc.vclock = { ...doc.vclock, [node]: (doc.vclock[node] ?? 0) + 1 };
    s.nodes[node].clock += 1;
    // 进行中/中断批次的成员快照基于旧归属，台账一变即失效
    if (s.batch && (s.batch.status === "running" || s.batch.status === "interrupted")) {
      s.batch.status = "invalid";
      log(s, "warn", `批次 ${s.batch.id} 因 ${artifactId} 在线换箱、成员已变而失效，需重建批次`);
    }
    log(s, "info", `${node === "site" ? "现场" : "库房"}在线登记：${artifactId} 移入 ${toBoxId}`);
    return;
  }
  // 离线：只记本地改动，回连后逐件合并
  const ex = s.nodes[node].edits[artifactId];
  if (ex) {
    ex.n += 1;
    ex.toBoxId = toBoxId;
  } else {
    s.nodes[node].edits[artifactId] = {
      toBoxId, n: 1, baseBoxId: doc.boxId,
    };
  }
  s.nodes[node].clock += 1;
  log(s, "info", `${node === "site" ? "现场" : "库房"}离线改动（本地）：${artifactId} → ${toBoxId}，回连后合并`);
}

function reconnect(s: HandoverState, node: Site) {
  const edits = s.nodes[node].edits;
  const ids = Object.keys(edits);
  if (ids.length === 0) {
    log(s, "info", `${node === "site" ? "现场" : "库房"}回连：无待合并改动`);
    return;
  }
  log(s, "info", `${node === "site" ? "现场" : "库房"}回连：开始逐件合并 ${ids.length} 件本地改动`);
  for (const id of ids) {
    const edit = edits[id];
    const doc = s.docs[id];
    // 入站版本 = 断网基线时钟上叠加本地自增；基线缺失时退化为当前主时钟
    const base = s.nodes[node].baseVc[id] ?? doc.vclock;
    const incoming: ArtifactDoc["vclock"] = {
      ...base,
      [node]: (base[node] ?? 0) + edit.n,
    };
    const hub = doc.vclock;
    const sameBox = doc.boxId === edit.toBoxId;
    if (dominates(hub, incoming)) {
      log(s, "warn", `合并 ${id}：主台账版本更新，本地"移箱至 ${edit.toBoxId}"作废，以 ${doc.boxId ?? "未装箱"} 为准`);
    } else if (dominates(incoming, hub)) {
      doc.boxId = edit.toBoxId;
      doc.vclock = incoming;
      log(s, "ok", `合并 ${id}：快进接受本地版本 → ${edit.toBoxId}`);
    } else if (sameBox) {
      // 并发但结论一致：时钟取大值即可
      doc.vclock = mergeClock(hub, incoming);
      log(s, "ok", `合并 ${id}：两边并发改动结论一致（${edit.toBoxId}），时钟合并`);
    } else {
      // 并发且两边换箱不同：保留两版，隔离等待保管员裁决
      doc.quarantine = true;
      doc.vclock = mergeClock(hub, incoming);
      const conflict: Conflict = {
        artifactId: id,
        siteBoxId: node === "site" ? edit.toBoxId : edit.baseBoxId,
        vaultBoxId: node === "vault" ? edit.toBoxId : edit.baseBoxId,
        siteVc: node === "site" ? incoming : hub,
        vaultVc: node === "vault" ? incoming : hub,
        at: now(),
      };
      s.conflicts[id] = conflict;
      const row = s.assignments[id];
      if (row && row.state !== "stored") {
        row.state = "stale";
        row.staleReason = "两边并发换箱，等待保管员裁决";
      }
      log(s, "danger", `合并冲突 ${id}：现场版=${conflict.siteBoxId ?? "未装箱"}，库房版=${conflict.vaultBoxId ?? "未装箱"}，已隔离，保留两版等保管员裁决`);
    }
  }
  s.nodes[node].edits = {};
  s.nodes[node].baseVc = {};
  applyPlan(s, undefined);
  log(s, "ok", `逐件合并完成，待入库登记已按合并结果重算`);
}

function mergeClock(a: Record<string, number>, b: Record<string, number>) {
  const out: Record<string, number> = { ...a };
  for (const k of Object.keys(b)) out[k] = Math.max(out[k] ?? 0, b[k]);
  return out;
}

function adjudicate(s: HandoverState, artifactId: string, boxId: string, note: string) {
  const c = s.conflicts[artifactId];
  const doc = s.docs[artifactId];
  if (!c || !doc) return;
  c.resolved = { boxId, by: "keeper", at: now(), note };
  doc.boxId = boxId;
  doc.quarantine = false;
  doc.vclock = { ...doc.vclock, hub: (doc.vclock.hub ?? 0) + 1 };
  log(s, "ok", `保管员裁决 ${artifactId}：采用 ${boxId}（${note || "无备注"}），冲突两版已归档`);
  applyPlan(s, undefined);
}

// ---------- 等级/容量变更：待入库失效重算，已入库冻结 ----------

function changeBox(s: HandoverState, id: string, grade?: Grade, maxLoadKg?: number) {
  const box = findBox(s, id);
  if (!box) return;
  const before = `${box.grade}级/承重${box.maxLoadKg}kg`;
  if (grade !== undefined) box.grade = grade;
  if (maxLoadKg !== undefined) box.maxLoadKg = maxLoadKg;
  s.catalogVersion += 1;
  const reason = `${id} 变更为 ${box.grade}级/承重${box.maxLoadKg}kg（原${before}，catalog v${s.catalogVersion}）`;
  const n = markPendingStale(s, reason);
  log(s, "warn", `主数据变更：${reason}；${n} 条待入库登记失效，需重算；已入库记录保留当时依据`);
}

function changeLocation(s: HandoverState, id: string, grade?: Grade, boxSlots?: number, maxLoadKg?: number) {
  const loc = findLoc(s, id);
  if (!loc) return;
  const before = `${loc.grade}级/${loc.boxSlots}槽/承重${loc.maxLoadKg}kg`;
  if (grade !== undefined) loc.grade = grade;
  if (boxSlots !== undefined) loc.boxSlots = boxSlots;
  if (maxLoadKg !== undefined) loc.maxLoadKg = maxLoadKg;
  s.catalogVersion += 1;
  const reason = `${id} 变更为 ${loc.grade}级/${loc.boxSlots}槽/承重${loc.maxLoadKg}kg（原${before}，catalog v${s.catalogVersion}）`;
  const n = markPendingStale(s, reason);
  log(s, "warn", `主数据变更：${reason}；${n} 条待入库登记失效，需重算；已入库记录保留当时依据`);
}

// ---------- 交接批次：装箱 → 占柜位 → 入库确认（可续作、幂等） ----------

function buildBatch(s: HandoverState) {
  if (s.batch && (s.batch.status === "running" || s.batch.status === "interrupted")) {
    log(s, "warn", `批次 ${s.batch.id} 尚未终结（含未完成箱），请直接续作，不要另开批次`);
    return;
  }
  const plan = applyPlan(s, undefined);
  const ops: BoxOp[] = [];
  for (const box of s.boxes) {
    const placed = s.placements[box.id];
    // 已入库的箱不再进新批次（重开批次只交接剩余工作）
    if (placed) continue;
    const artifactIds = s.artifacts
      .filter((a) => plan.membership[a.id] === box.id)
      .filter((a) => s.assignments[a.id]?.state !== "stored")
      .map((a) => a.id);
    if (artifactIds.length === 0) continue;
    const locId = plan.boxLocation[box.id] ?? null;
    ops.push({
      id: `OP-${s.tick}-${box.id}`,
      boxId: box.id,
      artifactIds,
      plannedLocationId: locId,
      state: "pending",
      stages: { packed: false, claimed: false, confirmed: false },
      phase: "pack",
      attempts: 0,
      outcome: locId ? undefined : "满柜排队中",
    });
  }
  if (ops.length === 0) {
    log(s, "info", "没有需要交接的箱（全部已入库或无装箱方案），未建立批次");
    return;
  }
  const batch: Batch = {
    id: `JJD-${s.tick}`,
    createdAt: now(),
    status: "running",
    ops,
    planBasis: plan.basis,
  };
  s.batch = batch;
  log(s, "info", `建立交接批次 ${batch.id}：${ops.length} 个周转箱，依据指纹 ${plan.basis.slice(0, 8)}；排队 ${plan.queue.length} 箱`);
}

/** 运行/续作：已 done 的箱整体跳过；未完成的箱从断点阶段重试 */
function runBatch(s: HandoverState, isRetry: boolean) {
  const b = s.batch;
  if (!b) {
    log(s, "warn", "尚无交接批次，请先建立批次");
    return;
  }
  if (b.status === "done") {
    log(s, "info", `批次 ${b.id} 已全部完成`);
    return;
  }
  if (b.status === "invalid") {
    log(s, "warn", `批次 ${b.id} 已因主数据变更失效，请重新规划并建立批次`);
    return;
  }

  // 续作前重算柜位：之前满柜排队的箱可能已能入柜；已占柜/已入库的不动
  const plan = planPacking(s);
  for (const op of b.ops) {
    if (!op.stages.claimed) op.plannedLocationId = plan.boxLocation[op.boxId] ?? null;
  }

  const locatable = b.ops.filter((op) => op.state !== "done" && op.plannedLocationId);
  // 故障注入：仅对"首次尝试"的箱生效；重试时 attempts>0 不再触发（模拟瞬时故障已恢复）
  const failTarget = s.failureMode === "writefail" && !isRetry
    ? locatable[1]?.id
    : s.failureMode === "acklost" && !isRetry
      ? locatable[0]?.id
      : undefined;

  let interrupted = false;
  for (const op of b.ops) {
    if (interrupted) break;
    if (op.state === "done") continue;
    if (!op.plannedLocationId) {
      op.state = "pending";
      op.phase = "claim";
      op.outcome = "满柜排队中";
      continue;
    }
    op.attempts += 1;
    op.error = undefined;
    op.outcome = undefined;

    // 阶段 1：装箱登记（幂等：已 packed 则不重复写）
    if (!op.stages.packed) {
      op.stages.packed = true;
      op.phase = "claim";
      log(s, "info", `${b.id} · ${op.boxId}：装箱登记完成（${op.artifactIds.join("、")}）`);
    }

    // 阶段 2：占柜位（幂等：物理位已存在则绝不重复占；ACK 丢失后重放走这里去重）
    if (!op.stages.claimed) {
      const existing = s.placements[op.boxId];
      if (existing) {
        // 上次写入实际成功、只是回执丢失：识别到既成占用，不重复占库位
        op.stages.claimed = true;
        op.plannedLocationId = existing.locationId;
        log(s, "warn", `${b.id} · ${op.boxId}：检测到柜位 ${existing.locationId} 已被本箱占用（上次写入回执丢失），跳过重复占柜`);
      } else {
        if (op.id === failTarget) {
          op.state = "failed";
          if (s.failureMode === "acklost") {
            // 写入实际落库但 ACK 丢失：占用已生效
            const claimed = claimSlot(s, op);
            if (claimed) {
              log(s, "danger", `${b.id} · ${op.boxId}：库房写入已落柜 ${claimed} 但回执丢失，交接中断`);
              op.error = "回执丢失（写入已生效）";
            } else {
              log(s, "danger", `${b.id} · ${op.boxId}：柜位不足，交接中断`);
              op.error = "无可用柜位";
            }
          } else {
            log(s, "danger", `${b.id} · ${op.boxId}：库房写入失败，交接中断；后续箱未执行`);
            op.error = "写入失败（未生效）";
          }
          interrupted = true;
          break;
        }
        const claimed = claimSlot(s, op);
        if (!claimed) {
          op.state = "failed";
          op.error = "无可用柜位";
          log(s, "danger", `${b.id} · ${op.boxId}：计划柜位已满，未能占柜，交接中断`);
          interrupted = true;
          break;
        }
        op.stages.claimed = true;
        log(s, "ok", `${b.id} · ${op.boxId}：已占柜位 ${claimed}（槽 ${s.placements[op.boxId].slot}）`);
      }
      op.phase = "confirm";
    }

    // 阶段 3：入库确认（冻结当时依据）
    if (!op.stages.confirmed) {
      const placement = s.placements[op.boxId];
      const loc = findLoc(s, placement.locationId)!;
      const box = findBox(s, op.boxId)!;
      const usedSlots = Object.values(s.placements).filter((p) => p.locationId === loc.id).length;
      for (const id of op.artifactIds) {
        const row: Assignment = s.assignments[id] ?? {
          artifactId: id, boxId: op.boxId, plannedLocationId: loc.id, state: "stored", basis: "",
        };
        row.state = "stored";
        row.boxId = op.boxId;
        row.plannedLocationId = loc.id;
        row.storedAt = now();
        row.frozen = {
          catalogVersion: s.catalogVersion,
          boxGrade: box.grade,
          locationId: loc.id,
          locationGrade: loc.grade,
          slot: placement.slot,
          boxSlots: loc.boxSlots,
          usedSlots,
          at: now(),
        };
        s.assignments[id] = row;
      }
      op.stages.confirmed = true;
      op.state = "done";
      op.outcome = `已入库 ${loc.id} 槽${placement.slot}`;
      log(s, "ok", `${b.id} · ${op.boxId}：入库确认，${op.artifactIds.length} 件登记为已入库并冻结依据（catalog v${s.catalogVersion}）`);
    }
  }

  const unfinished = b.ops.filter((op) => op.state !== "done");
  const queued = unfinished.filter((op) => !op.plannedLocationId);
  const failed = unfinished.filter((op) => op.state === "failed");
  if (failed.length > 0) {
    b.status = "interrupted";
    log(s, "warn", `交接中断于 ${failed[0].boxId}（${failed[0].error}）；已完成箱不受影响，续作只重试 ${unfinished.length} 个未完成箱`);
  } else if (queued.length > 0) {
    b.status = "interrupted";
    s.queue = queued.map((op) => op.boxId);
    log(s, "warn", `${queued.map((o) => o.boxId).join("、")} 满柜排队，等待空柜；其余箱已交接完成，可随时续作`);
  } else {
    b.status = "done";
    s.queue = [];
    log(s, "ok", `批次 ${b.id} 全部完成：所有箱已入库`);
  }
}

/** 占柜位：以"物理位"为幂等键；运行时再次校验空槽/承重，计划柜位被占满就换柜，都没有则排队 */
function claimSlot(s: HandoverState, op: BoxOp): string | null {
  const box = findBox(s, op.boxId)!;
  if (s.placements[box.id]) return s.placements[box.id].locationId;
  const weight = boxLoad(s.artifacts, box.id, s.docs);
  const choose = (locId: string | null | undefined) => {
    const locs = s.locations
      .filter((l) => canAcceptFragility(l.grade, box.grade))
      .filter((l) => {
        const used = Object.values(s.placements).filter((p) => p.locationId === l.id).length;
        return used < l.boxSlots;
      })
      .filter((l) => {
        const usedLoad = s.boxes
          .filter((bx) => s.placements[bx.id]?.locationId === l.id)
          .reduce((sum, bx) => sum + boxLoad(s.artifacts, bx.id, s.docs), 0);
        return usedLoad + weight <= l.maxLoadKg + 1e-9;
      })
      .sort((x, y) => Math.abs(x.grade - box.grade) - Math.abs(y.grade - box.grade));
    if (locId) {
      const preferred = locs.find((l) => l.id === locId);
      if (preferred) return preferred;
    }
    return locs[0];
  };
  const loc = choose(op.plannedLocationId);
  if (!loc) return null;
  const used = Object.values(s.placements).filter((p) => p.locationId === loc.id).length;
  s.placements[box.id] = { locationId: loc.id, slot: used + 1, at: now() };
  s.queue = s.queue.filter((id) => id !== box.id);
  op.plannedLocationId = loc.id;
  return loc.id;
}

// ---------- Reducer ----------

export function reducer(prev: HandoverState, action: Action): HandoverState {
  if (action.type === "RESET") return initialState();
  const s = structuredClone(prev);
  switch (action.type) {
    case "SET_ONLINE": {
      const wasOnline = s.nodes[action.node].online;
      s.nodes[action.node].online = action.online;
      if (!action.online) {
        // 断网瞬间冻结各件台账的向量时钟，作为回连时判定因果/并发的基线
        s.nodes[action.node].baseVc = {};
        for (const [id, doc] of Object.entries(s.docs)) {
          s.nodes[action.node].baseVc[id] = { ...doc.vclock };
        }
        log(s, "info", `${action.node === "site" ? "现场" : "库房"}进入离线，改动先记本地账`);
      } else if (!wasOnline) {
        log(s, "info", `${action.node === "site" ? "现场" : "库房"}网络恢复（尚未回连）`);
      }
      break;
    }
    case "SET_FAILURE":
      s.failureMode = action.mode;
      log(s, "info", action.mode === "none"
        ? "故障注入关闭"
        : action.mode === "writefail"
          ? "已开启故障注入：下一批次第 2 个箱写入将失败（不生效）"
          : "已开启故障注入：下一批次第 1 个箱占柜成功但回执丢失");
      break;
    case "MOVE":
      localMove(s, action.node, action.artifactId, action.toBoxId);
      break;
    case "RECONNECT":
      reconnect(s, action.node);
      s.nodes[action.node].online = true;
      break;
    case "ADJUDICATE":
      adjudicate(s, action.artifactId, action.boxId, action.note);
      break;
    case "CHANGE_BOX":
      changeBox(s, action.id, action.grade, action.maxLoadKg);
      break;
    case "CHANGE_LOCATION":
      changeLocation(s, action.id, action.grade, action.boxSlots, action.maxLoadKg);
      break;
    case "REPLAN": {
      const plan = applyPlan(s, action.reason);
      log(s, "ok", `待入库登记已重算（依据指纹 ${plan.basis.slice(0, 8)}），排队 ${plan.queue.length} 箱`);
      break;
    }
    case "BUILD_BATCH":
      buildBatch(s);
      break;
    case "RUN_BATCH":
      runBatch(s, false);
      break;
    case "RETRY_BATCH":
      runBatch(s, true);
      break;
    case "CLEAR_LOG":
      s.log = [];
      break;
    default:
      break;
  }
  return s;
}
