import type {
  CabinetSlot,
  Level,
  Registration,
  RegistrationBasis,
  TurnoverBox,
} from "./types";

export const RULE_VERSION = "柜位分配规则 v1.3";

export interface SlotLoad {
  boxes: string[];
  weightGrams: number;
}

/**
 * 库位占用：既含已入库（台账确认），也含已登记待入库的箱，
 * 这样重放批次与并发登记都不会把两个箱算进同一个库位。
 */
export type Occupancy = Map<string, SlotLoad>;

export function emptyOccupancy(): Occupancy {
  return new Map();
}

export function slotLoadOf(occupancy: Occupancy, slotId: string): SlotLoad {
  return occupancy.get(slotId) ?? { boxes: [], weightGrams: 0 };
}

export function slotAccepts(
  slot: CabinetSlot,
  box: TurnoverBox,
  boxLoadGrams: number,
  load: SlotLoad,
): boolean {
  return (
    slot.level >= box.level &&
    load.boxes.length < slot.capacityBoxes &&
    load.weightGrams + boxLoadGrams <= slot.maxWeightGrams
  );
}

/**
 * 为一批箱分配库位。箱按防护等级降序（高需求优先）处理；
 * 选位策略 best-fit：等级够、箱数与承重都装得下的库位中，选剩余箱位最少者。
 * 分不到位的箱进入排队队列，保持提交顺序。
 */
export function allocateSlots(input: {
  boxIds: string[];
  boxes: Map<string, TurnoverBox>;
  boxLoads: Record<string, number>;
  slots: CabinetSlot[];
  occupancy: Occupancy;
  now: string;
  nextRegId: () => string;
}): { registrations: Registration[]; queued: string[] } {
  const { boxes, boxLoads, slots, occupancy, now, nextRegId } = input;
  const ordered = [...input.boxIds].sort((a, b) => {
    const ba = boxes.get(a);
    const bb = boxes.get(b);
    if (!ba || !bb) return a.localeCompare(b);
    return bb.level - ba.level || ba.code.localeCompare(bb.code);
  });

  const registrations: Registration[] = [];
  const queued: string[] = [];

  for (const boxId of ordered) {
    const box = boxes.get(boxId);
    if (!box) continue;
    const load = boxLoads[boxId] ?? 0;
    let best: CabinetSlot | null = null;
    let bestRemaining = Infinity;
    for (const slot of slots) {
      const occ = slotLoadOf(occupancy, slot.id);
      if (!slotAccepts(slot, box, load, occ)) continue;
      const remaining = slot.capacityBoxes - occ.boxes.length;
      if (remaining < bestRemaining || (remaining === bestRemaining && best && slot.code < best.code)) {
        best = slot;
        bestRemaining = remaining;
      }
    }
    if (best === null) {
      queued.push(boxId);
      continue;
    }
    const occ = slotLoadOf(occupancy, best.id);
    occupancy.set(best.id, {
      boxes: [...occ.boxes, boxId],
      weightGrams: occ.weightGrams + load,
    });
    registrations.push({
      id: nextRegId(),
      boxId,
      slotId: best.id,
      status: "pending",
      basis: basisOf(box, load, best, now),
    });
  }

  return { registrations, queued };
}

function basisOf(box: TurnoverBox, loadGrams: number, slot: CabinetSlot, now: string): RegistrationBasis {
  return {
    boxCode: box.code,
    boxLevel: box.level,
    boxLoadGrams: loadGrams,
    slotCode: slot.code,
    slotLevel: slot.level,
    ruleVersion: RULE_VERSION,
    computedAt: now,
  };
}

/**
 * 失效判定：库位等级/容量/承重变化，或箱等级变化时，
 * 引用这些主数据的待入库登记全部失效。已入库记录不受影响，
 * 其 basis 快照保留当时依据。
 */
export function findInvalidated(
  registrations: Registration[],
  changed: { slotIds?: string[]; boxIds?: string[] },
): Registration[] {
  const slots = new Set(changed.slotIds ?? []);
  const boxes = new Set(changed.boxIds ?? []);
  return registrations.filter(
    (r) => r.status === "pending" && (slots.has(r.slotId) || boxes.has(r.boxId)),
  );
}

/** 当前占用 = 已入库 + 待入库登记的合计，供重新分配时打底。 */
export function occupancyFrom(
  registrations: Registration[],
  boxLoads: Record<string, number>,
): Occupancy {
  const occupancy: Occupancy = new Map();
  for (const reg of registrations) {
    if (reg.status === "invalidated") continue;
    const occ = slotLoadOf(occupancy, reg.slotId);
    occupancy.set(reg.slotId, {
      boxes: [...occ.boxes, reg.boxId],
      weightGrams: occ.weightGrams + (boxLoads[reg.boxId] ?? 0),
    });
  }
  return occupancy;
}
