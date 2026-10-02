import type { Assignment, HandoverState } from "./types";
import {
  boxLoad, canAcceptFragility, hashBasis, occupiedSlots,
} from "./util";

/**
 * 装箱 + 柜位分配（现场装箱登记的计算核心）
 *
 * 规则：
 *  - 按易碎等级（高→低）、重量（重→轻）依次装箱
 *  - 箱子防护等级须 ≥ 物件易碎等级；总重不超箱承重；已打包的物件不无故翻箱
 *  - 柜位安保等级须 ≥ 箱等级；有空槽且不超柜位承重才占柜，否则进入排队
 *  - 等级/容量变更后，stale 登记全部重算；stored 行不进规划器（已冻结）
 */
export interface PlanResult {
  membership: Record<string, string>; // artifactId -> boxId（全部非入库件）
  boxLocation: Record<string, string | null>; // boxId -> locationId|null(排队)
  queue: string[];
  assignments: Record<string, Assignment>; // 只含非入库件
  basis: string;
  warnings: string[];
}

export function planPacking(state: HandoverState): PlanResult {
  const warnings: string[] = [];
  const storedIds = new Set(
    Object.values(state.assignments).filter((a) => a.state === "stored").map((a) => a.artifactId),
  );
  // 冲突未裁决的出土物隔离：不进装箱规划，保留原 stale 登记等裁决
  const quarantined = new Set(
    state.artifacts.filter((a) => state.docs[a.id]?.quarantine).map((a) => a.id),
  );

  // 1) 保留已打包成员；stale/未打包件重新装箱
  const membership: Record<string, string> = {};
  for (const a of state.artifacts) {
    if (storedIds.has(a.id) || quarantined.has(a.id)) continue;
    const cur = state.docs[a.id]?.boxId;
    if (cur && state.boxes.some((b) => b.id === cur)) membership[a.id] = cur;
  }

  const loadOf = (boxId: string) =>
    state.artifacts
      .filter((a) => membership[a.id] === boxId)
      .reduce((s, a) => s + a.weightKg, 0);

  const pending = state.artifacts
    .filter((a) => !storedIds.has(a.id) && !quarantined.has(a.id))
    .filter((a) => !(membership[a.id] && boxStillValid(state, membership[a.id], a, loadOf)))
    .sort((x, y) => (y.fragility - x.fragility) || (y.weightKg - x.weightKg));

  for (const art of pending) {
    const candidates = state.boxes
      .filter((b) => canAcceptFragility(b.grade, art.fragility))
      .filter((b) => loadOf(b.id) + art.weightKg <= b.maxLoadKg + 1e-9)
      .sort((x, y) => {
        // 优先当前箱（少翻箱），再选等级恰好匹配（珍品柜位留给珍品箱）、装得最满的箱
        const cur = state.docs[art.id]?.boxId;
        if ((x.id === cur) !== (y.id === cur)) return x.id === cur ? -1 : 1;
        const gx = Math.abs(x.grade - art.fragility);
        const gy = Math.abs(y.grade - art.fragility);
        if (gx !== gy) return gx - gy;
        return loadOf(y.id) - loadOf(x.id);
      });
    const pick = candidates[0];
    if (!pick) {
      warnings.push(`${art.id}（${art.name}）找不到满足易碎等级与承重的周转箱`);
      continue;
    }
    membership[art.id] = pick.id;
  }

  // 2) 箱 → 柜位：等级匹配 + 空槽 + 承重；放不下就排队
  const boxLocation: Record<string, string | null> = {};
  const plannedSlots: Record<string, number> = {};
  const plannedLoad: Record<string, number> = {};
  for (const loc of state.locations) {
    plannedSlots[loc.id] = occupiedSlots(state, loc.id);
    plannedLoad[loc.id] = 0;
  }

  const activeBoxes = state.boxes
    .filter((b) => Object.values(membership).includes(b.id))
    .sort((x, y) => {
      // 已占柜的不动；其余按等级高者优先、载重大者优先
      const px = state.placements[x.id] ? 0 : 1;
      const py = state.placements[y.id] ? 0 : 1;
      if (px !== py) return px - py;
      const gx = Math.max(...state.artifacts.filter((a) => membership[a.id] === x.id).map((a) => a.fragility));
      const gy = Math.max(...state.artifacts.filter((a) => membership[a.id] === y.id).map((a) => a.fragility));
      return gy - gx || loadOf(y.id) - loadOf(x.id);
    });

  const queue: string[] = [];
  for (const box of activeBoxes) {
    const existing = state.placements[box.id];
    if (existing) {
      boxLocation[box.id] = existing.locationId;
      continue;
    }
    const boxGrade = box.grade;
    const weight = loadOf(box.id);
    const loc = state.locations
      .filter((l) => canAcceptFragility(l.grade, boxGrade))
      .filter((l) => plannedSlots[l.id] < l.boxSlots)
      .filter((l) => plannedLoad[l.id] + weight <= l.maxLoadKg + 1e-9)
      .sort((x, y) => {
        // 等级恰好匹配优先（珍品箱不要白占普通……普通箱进最低合格柜，给易碎/珍品留柜）
        if (Math.abs(x.grade - boxGrade) !== Math.abs(y.grade - boxGrade)) {
          return Math.abs(x.grade - boxGrade) - Math.abs(y.grade - boxGrade);
        }
        return plannedLoad[y.id] - plannedLoad[x.id];
      })[0];
    if (loc) {
      boxLocation[box.id] = loc.id;
      plannedSlots[loc.id] += 1;
      plannedLoad[loc.id] += weight;
    } else {
      boxLocation[box.id] = null;
      queue.push(box.id);
    }
  }

  // 3) 生成/更新待入库登记
  const assignments: Record<string, Assignment> = {};
  for (const row of Object.values(state.assignments)) {
    if (row.state === "stored") {
      assignments[row.artifactId] = row; // 已入库不动
    } else if (quarantined.has(row.artifactId)) {
      assignments[row.artifactId] = row; // 隔离件保留"待裁决"登记
    }
  }
  for (const art of state.artifacts) {
    const boxId = membership[art.id];
    if (!boxId) continue;
    const prev = state.assignments[art.id];
    assignments[art.id] = {
      artifactId: art.id,
      boxId,
      plannedLocationId: boxLocation[boxId] ?? null,
      state: "planned",
      basis: "", // 回填
      staleReason: prev?.state === "stale" ? prev.staleReason : undefined,
    };
  }

  const basis = fingerprint(state, membership, boxLocation);
  for (const row of Object.values(assignments)) {
    if (row.state !== "stored") row.basis = basis;
  }
  return { membership, boxLocation, queue, assignments, basis, warnings };
}

function boxStillValid(
  state: HandoverState,
  boxId: string,
  art: { fragility: number },
  loadOf: (id: string) => number,
): boolean {
  const box = state.boxes.find((b) => b.id === boxId);
  if (!box || !canAcceptFragility(box.grade, art.fragility as 1 | 2 | 3)) return false;
  return loadOf(boxId) <= box.maxLoadKg + 1e-9;
}

function fingerprint(
  state: HandoverState,
  membership: Record<string, string>,
  boxLocation: Record<string, string | null>,
): string {
  const b = state.boxes.map((x) => `${x.id}:${x.grade}:${x.maxLoadKg}`).join(",");
  const l = state.locations.map((x) => `${x.id}:${x.grade}:${x.boxSlots}:${x.maxLoadKg}`).join(",");
  const m = Object.keys(membership).sort()
    .map((id) => `${id}>${membership[id]}@${boxLocation[membership[id]] ?? "排队"}`)
    .join("|");
  return hashBasis(`v${state.catalogVersion}||${b}||${l}||${m}`);
}
