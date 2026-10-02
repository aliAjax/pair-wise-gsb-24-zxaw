import type { Artifact, Assignment, HandoverState, Site } from "./types";
import { GRADE_LABEL } from "./types";
import { boxArtifactIds, boxLoad, occupiedSlots } from "./util";
import { planPacking } from "./planner";

export const gradeLabel = (g: number) => GRADE_LABEL[g as 1 | 2 | 3] ?? String(g);
export const gradeClass = (g: number) => `grade-${g}`;

export interface ViewStats {
  total: number;
  stored: number;
  planned: number;
  stale: number;
  queuedBoxes: number;
  conflicts: number;
  quarantined: number;
}

export function stats(s: HandoverState): ViewStats {
  const rows = Object.values(s.assignments);
  return {
    total: s.artifacts.length,
    stored: rows.filter((r) => r.state === "stored").length,
    planned: rows.filter((r) => r.state === "planned").length,
    stale: rows.filter((r) => r.state === "stale").length,
    queuedBoxes: s.queue.length,
    conflicts: Object.values(s.conflicts).filter((c) => !c.resolved).length,
    quarantined: s.artifacts.filter((a) => s.docs[a.id]?.quarantine).length,
  };
}

export function assignmentOf(s: HandoverState, id: string): Assignment | undefined {
  return s.assignments[id];
}

export interface BoxView {
  id: string;
  grade: number;
  maxLoad: number;
  load: number;
  artifactIds: string[];
  locationId: string | null;
  queued: boolean;
}

export function boxViews(s: HandoverState): BoxView[] {
  return s.boxes.map((b) => ({
    id: b.id,
    grade: b.grade,
    maxLoad: b.maxLoadKg,
    load: boxLoad(s.artifacts, b.id, s.docs),
    artifactIds: boxArtifactIds(s.artifacts, b.id, s.docs),
    locationId: s.placements[b.id]?.locationId ?? null,
    queued: s.queue.includes(b.id),
  }));
}

export interface LocView {
  id: string;
  grade: number;
  boxSlots: number;
  usedSlots: number;
  maxLoad: number;
  load: number;
  boxes: { boxId: string; slot: number }[];
}

export function locViews(s: HandoverState): LocView[] {
  return s.locations.map((l) => {
    const boxes = Object.entries(s.placements)
      .filter(([, p]) => p.locationId === l.id)
      .map(([boxId, p]) => ({ boxId, slot: p.slot }))
      .sort((a, b) => a.slot - b.slot);
    return {
      id: l.id,
      grade: l.grade,
      boxSlots: l.boxSlots,
      usedSlots: occupiedSlots(s, l.id),
      maxLoad: l.maxLoadKg,
      load: boxes.reduce((sum, { boxId }) => sum + boxLoad(s.artifacts, boxId, s.docs), 0),
      boxes,
    };
  });
}

/** 不落库的规划预览（UI 里展示"如果现在重算会怎么分"） */
export function preview(s: HandoverState) {
  return planPacking(s);
}

export function offlineCount(s: HandoverState, node: Site): number {
  return Object.keys(s.nodes[node].edits).length;
}

export function artifactStateLabel(s: HandoverState, a: Artifact): string {
  const doc = s.docs[a.id];
  if (doc?.quarantine) return "待裁决";
  const row = s.assignments[a.id];
  if (row?.state === "stored") return "已入库";
  if (row?.state === "stale") return "登记失效";
  if (row?.state === "planned") return "待入库";
  if (doc?.boxId) return "已装箱未登记";
  return "未装箱";
}

export const STATE_BADGE: Record<string, string> = {
  已入库: "badge-stored",
  待入库: "badge-planned",
  登记失效: "badge-stale",
  待裁决: "badge-danger",
  已装箱未登记: "badge-loose",
  未装箱: "badge-loose",
};
