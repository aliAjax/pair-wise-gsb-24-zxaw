import type { HandoverState } from "./types";
import { boxArtifactIds, boxLoad } from "./util";

export interface Violation {
  code: string;
  level: "danger" | "warn";
  msg: string;
}

/**
 * 交接台一致性稽核——任何动作后都应保持：
 *  V1 一件出土物至多在一个周转箱（不占两箱）
 *  V2 一个周转箱至多占一个柜位槽（不抢两位）
 *  V3 箱承重 / 柜承重 / 柜槽数 不超限
 *  V4 等级合规：箱防护 ≥ 物易碎；柜安保 ≥ 箱等级
 *  V5 入库登记与物理占用一致，且冻结依据与当时主数据快照相符
 *  V6 待入库登记不陈旧（等级变更后须 stale 或重算），排队登记不得指向库位
 */
export function audit(state: HandoverState): Violation[] {
  const out: Violation[] = [];
  const isStored = (aid: string) => state.assignments[aid]?.state === "stored";

  // V1：docs 本身是 artifactId→box 的唯一映射；隔离件不算装箱
  for (const a of state.artifacts) {
    const doc = state.docs[a.id];
    if (!doc) out.push({ code: "V1", level: "danger", msg: `${a.id} 无归属台账` });
  }

  // V2：placements 是 boxId→位置的唯一映射；同位置槽号不得重复
  const slotSeen: Record<string, Set<number>> = {};
  for (const [boxId, p] of Object.entries(state.placements)) {
    slotSeen[p.locationId] ??= new Set();
    if (slotSeen[p.locationId].has(p.slot)) {
      out.push({ code: "V2", level: "danger", msg: `${p.locationId} 槽${p.slot} 被 ${boxId} 重复占用` });
    }
    slotSeen[p.locationId].add(p.slot);
  }

  // V3：承重 / 槽数（已入库物遇主数据缩容属事后漂移，warn 而非 danger）
  for (const box of state.boxes) {
    const ids = boxArtifactIds(state.artifacts, box.id, state.docs);
    const load = boxLoad(state.artifacts, box.id, state.docs);
    if (load > box.maxLoadKg + 1e-9) {
      const allStored = ids.length > 0 && ids.every(isStored);
      out.push(allStored
        ? { code: "V3", level: "warn", msg: `${box.id} 承重下调后现载 ${load.toFixed(1)}kg 超 ${box.maxLoadKg}kg；已入库物保留当时依据，待保管员处理` }
        : { code: "V3", level: "danger", msg: `${box.id} 装载 ${load.toFixed(1)}kg 超过承重 ${box.maxLoadKg}kg` });
    }
  }
  for (const loc of state.locations) {
    const boxes = state.boxes.filter((b) => state.placements[b.id]?.locationId === loc.id);
    if (boxes.length > loc.boxSlots) {
      out.push({ code: "V3", level: "danger", msg: `${loc.id} 占用 ${boxes.length} 槽，超过容量 ${loc.boxSlots}` });
    }
    const load = boxes.reduce((s, b) => s + boxLoad(state.artifacts, b.id, state.docs), 0);
    if (load > loc.maxLoadKg + 1e-9) {
      out.push({ code: "V3", level: "warn", msg: `${loc.id} 承重下调后现载 ${load.toFixed(1)}kg 超 ${loc.maxLoadKg}kg；已入库记录保留当时依据` });
    }
  }

  // V4：等级合规（隔离件不参与；已入库按冻结快照判定，事后降级只告警）
  for (const a of state.artifacts) {
    const doc = state.docs[a.id];
    if (!doc || doc.quarantine || !doc.boxId) continue;
    const box = state.boxes.find((b) => b.id === doc.boxId);
    if (!box) continue;
    const row = state.assignments[a.id];
    if (row?.state === "stored" && row.frozen) {
      if (row.frozen.boxGrade < a.fragility) {
        out.push({ code: "V4", level: "danger", msg: `${a.id} 入库冻结快照自身等级不合规` });
      } else if (box.grade < a.fragility) {
        out.push({ code: "V4", level: "warn", msg: `${a.id} 已入库（${box.id} 防护${row.frozen.boxGrade}→${box.grade}级），主数据事后降级，保留当时依据` });
      }
    } else if (box.grade < a.fragility) {
      out.push({ code: "V4", level: "danger", msg: `${a.id}（易碎${a.fragility}级）装在 ${box.id}（防护${box.grade}级），等级不足` });
    }
  }
  for (const [boxId, p] of Object.entries(state.placements)) {
    const box = state.boxes.find((b) => b.id === boxId)!;
    const loc = state.locations.find((l) => l.id === p.locationId)!;
    if (loc.grade < box.grade) {
      const ids = boxArtifactIds(state.artifacts, boxId, state.docs);
      const frozenOk = ids.every((id) => {
        const f = state.assignments[id]?.frozen;
        return f && f.locationId === loc.id && f.locationGrade >= box.grade;
      });
      out.push(frozenOk && ids.length > 0
        ? { code: "V4", level: "warn", msg: `${boxId}（${box.grade}级）所在 ${loc.id} 已降为 ${loc.grade} 级；已入库物保留入库时依据，待保管员处理` }
        : { code: "V4", level: "danger", msg: `${boxId}（${box.grade}级）放入 ${loc.id}（${loc.grade}级），柜位安保不足` });
    }
  }

  // V5：入库登记 ↔ 物理占用
  for (const row of Object.values(state.assignments)) {
    if (row.state !== "stored") continue;
    const p = state.placements[row.boxId];
    if (!p) {
      out.push({ code: "V5", level: "danger", msg: `${row.artifactId} 已入库但 ${row.boxId} 无物理柜位占用` });
      continue;
    }
    if (p.locationId !== row.plannedLocationId) {
      out.push({ code: "V5", level: "danger", msg: `${row.artifactId} 入库柜位与占用不一致` });
    }
    const f = row.frozen;
    if (!f) {
      out.push({ code: "V5", level: "danger", msg: `${row.artifactId} 已入库但缺少冻结依据` });
    } else if (f.locationId !== p.locationId || f.slot !== p.slot) {
      out.push({ code: "V5", level: "warn", msg: `${row.artifactId} 冻结槽位与现状不符（事后调整？）` });
    }
  }

  // V6：排队/陈旧一致性
  for (const row of Object.values(state.assignments)) {
    if (row.state === "planned") {
      const p = state.placements[row.boxId];
      if (p && p.locationId !== row.plannedLocationId) {
        out.push({ code: "V6", level: "warn", msg: `${row.artifactId} 计划柜位与已占柜位漂移，需重算` });
      }
    }
  }
  for (const boxId of state.queue) {
    if (state.placements[boxId]) {
      out.push({ code: "V6", level: "warn", msg: `${boxId} 已占柜却仍留在排队队列` });
    }
  }
  return out;
}
