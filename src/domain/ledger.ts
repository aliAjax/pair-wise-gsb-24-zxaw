import type { CabinetSlot } from "./types";

/** 入库放置指令：一个箱到一个库位，幂等键即“箱@库位”。 */
export interface PlacementOp {
  key: string;
  registrationId: string;
  boxId: string;
  slotId: string;
}

export type OpOutcome = "applied" | "duplicate" | "slot_full" | "box_elsewhere";

export interface OpResult {
  op: PlacementOp;
  outcome: OpOutcome;
}

export interface BatchResult {
  results: OpResult[];
  /** 模拟写入中断：第 failedAt 个（含）之后的指令未执行 */
  failedAt: number | null;
}

export function placementKey(boxId: string, slotId: string): string {
  return `${boxId}@${slotId}`;
}

/**
 * 库房台账（模拟服务端）。入库写入以“箱@库位”为幂等键：
 * 重放已成功的指令直接跳过，不会重复占库位；
 * 容量与承重在校验通过后才落账，写断时已完成的部分保留，
 * 调用方只需重放未完成的箱。
 */
export class LedgerStore {
  private slotOfBox = new Map<string, string>();
  private boxesInSlot = new Map<string, string[]>();
  private weightInSlot = new Map<string, number>();
  private appliedKeys = new Set<string>();

  constructor(
    private slots: Map<string, CabinetSlot>,
    private boxLoads: Record<string, number>,
  ) {}

  syncMasterData(slots: Map<string, CabinetSlot>, boxLoads: Record<string, number>): void {
    this.slots = slots;
    this.boxLoads = boxLoads;
  }

  /**
   * 批量落账。两种中断模拟：
   * - failAfter：第 N 项起不再落账（写入中断）；
   * - loseResponseAfter：全部落账，但第 N 项起的应答丢失
   *   （调用方以为没写成，重放时靠幂等键跳过）。
   */
  applyBatch(
    ops: PlacementOp[],
    opts: { failAfter?: number; loseResponseAfter?: number } = {},
  ): BatchResult {
    const results: OpResult[] = [];
    for (let i = 0; i < ops.length; i++) {
      if (opts.failAfter !== undefined && i >= opts.failAfter) {
        return { results, failedAt: opts.failAfter };
      }
      const result = this.applyOne(ops[i]);
      if (opts.loseResponseAfter !== undefined && i >= opts.loseResponseAfter) {
        continue; // 已落账，应答丢失
      }
      results.push(result);
    }
    if (opts.loseResponseAfter !== undefined && opts.loseResponseAfter < ops.length) {
      return { results, failedAt: opts.loseResponseAfter };
    }
    return { results, failedAt: null };
  }

  private applyOne(op: PlacementOp): OpResult {
    if (this.appliedKeys.has(op.key)) {
      return { op, outcome: "duplicate" };
    }
    const current = this.slotOfBox.get(op.boxId);
    if (current === op.slotId) {
      this.appliedKeys.add(op.key);
      return { op, outcome: "duplicate" };
    }
    if (current !== undefined) {
      return { op, outcome: "box_elsewhere" };
    }
    const slot = this.slots.get(op.slotId);
    if (!slot) return { op, outcome: "slot_full" };
    const boxes = this.boxesInSlot.get(op.slotId) ?? [];
    const weight = this.weightInSlot.get(op.slotId) ?? 0;
    const load = this.boxLoads[op.boxId] ?? 0;
    if (boxes.length >= slot.capacityBoxes || weight + load > slot.maxWeightGrams) {
      return { op, outcome: "slot_full" };
    }
    boxes.push(op.boxId);
    this.boxesInSlot.set(op.slotId, boxes);
    this.weightInSlot.set(op.slotId, weight + load);
    this.slotOfBox.set(op.boxId, op.slotId);
    this.appliedKeys.add(op.key);
    return { op, outcome: "applied" };
  }

  locationOf(boxId: string): string | undefined {
    return this.slotOfBox.get(boxId);
  }

  boxesAt(slotId: string): string[] {
    return [...(this.boxesInSlot.get(slotId) ?? [])];
  }

  weightAt(slotId: string): number {
    return this.weightInSlot.get(slotId) ?? 0;
  }
}
