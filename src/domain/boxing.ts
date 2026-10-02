import type { Artifact, Placement, TurnoverBox } from "./types";

export interface BoxingResult {
  placements: Placement[];
  /** 没有任何箱子能容纳的器物（等级不够或超重） */
  unassigned: string[];
  /** 装箱后各箱总重：boxId -> grams */
  boxLoads: Record<string, number>;
}

export function canHold(box: TurnoverBox, artifact: Artifact, currentLoadGrams: number): boolean {
  return (
    box.level >= artifact.fragility &&
    currentLoadGrams + artifact.weightGrams <= box.maxWeightGrams
  );
}

/**
 * 装箱：按重量与易碎等级把器物分入周转箱。
 * 处理顺序：易碎等级降序 → 重量降序（最娇贵最重的先落位）；
 * 选箱策略：先取“够用即可”的最低防护等级（高等级箱留给高等级器物），
 * 同等级内 best-fit——装入后剩余承重最小者，减少承重碎片。
 */
export function planBoxing(artifacts: Artifact[], boxes: TurnoverBox[]): BoxingResult {
  const sorted = [...artifacts].sort(
    (a, b) =>
      b.fragility - a.fragility ||
      b.weightGrams - a.weightGrams ||
      a.code.localeCompare(b.code),
  );
  const loads = new Map<string, number>(boxes.map((b) => [b.id, 0]));
  const placements: Placement[] = [];
  const unassigned: string[] = [];

  for (const artifact of sorted) {
    let best: TurnoverBox | null = null;
    let bestRemaining = Infinity;
    for (const box of boxes) {
      const load = loads.get(box.id) ?? 0;
      if (!canHold(box, artifact, load)) continue;
      const remaining = box.maxWeightGrams - (load + artifact.weightGrams);
      if (
        best === null ||
        box.level < best.level ||
        (box.level === best.level && remaining < bestRemaining) ||
        (box.level === best.level && remaining === bestRemaining && box.code < best.code)
      ) {
        best = box;
        bestRemaining = remaining;
      }
    }
    if (best === null) {
      unassigned.push(artifact.id);
      continue;
    }
    loads.set(best.id, (loads.get(best.id) ?? 0) + artifact.weightGrams);
    placements.push({ artifactId: artifact.id, boxId: best.id });
  }

  return { placements, unassigned, boxLoads: Object.fromEntries(loads) };
}

/** 由器物 → 箱映射计算各箱装载，便于合并 / 裁决后重算展示。 */
export function loadsOf(
  view: Record<string, string | null>,
  artifacts: Artifact[],
): Record<string, number> {
  const weightById = new Map(artifacts.map((a) => [a.id, a.weightGrams]));
  const loads: Record<string, number> = {};
  for (const [artifactId, boxId] of Object.entries(view)) {
    if (boxId === null) continue;
    loads[boxId] = (loads[boxId] ?? 0) + (weightById.get(artifactId) ?? 0);
  }
  return loads;
}
