import type {
  Artifact, Box, Grade, HandoverState, Location,
} from "./types";

export const now = () => Date.now();

let logId = 0;
export function makeLog(level: HandoverState["log"][number]["level"], msg: string): HandoverState["log"][number] {
  logId += 1;
  return { id: logId, t: now(), level, msg };
}

/** 简单确定性指纹：FNV-1a 32 位，用作"登记依据" */
export function hashBasis(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function boxLoad(artifacts: Artifact[], boxId: string, docs: HandoverState["docs"]): number {
  return artifacts
    .filter((a) => docs[a.id]?.boxId === boxId)
    .reduce((sum, a) => sum + a.weightKg, 0);
}

export function boxArtifactIds(artifacts: Artifact[], boxId: string, docs: HandoverState["docs"]): string[] {
  return artifacts.filter((a) => docs[a.id]?.boxId === boxId).map((a) => a.id);
}

export function occupiedSlots(state: HandoverState, locationId: string): number {
  return Object.values(state.placements).filter((p) => p.locationId === locationId).length;
}

export function canAcceptFragility(grade: Grade, fragility: Grade): boolean {
  return grade >= fragility; // 普通箱柜装普通件；易碎件须进易碎及以上；珍品件须进珍品柜
}

export function findBox(state: HandoverState, id: string): Box | undefined {
  return state.boxes.find((b) => b.id === id);
}
export function findLoc(state: HandoverState, id: string): Location | undefined {
  return state.locations.find((l) => l.id === id);
}
export function findArtifact(state: HandoverState, id: string): Artifact | undefined {
  return state.artifacts.find((a) => a.id === id);
}

export const SEED_ARTIFACTS: Artifact[] = [
  { id: "TC-001", name: "夹砂陶片（一组）", weightKg: 3.2, fragility: 1 },
  { id: "TC-002", name: "彩绘陶罐口沿", weightKg: 1.8, fragility: 2 },
  { id: "TC-003", name: "青铜残片", weightKg: 6.5, fragility: 1 },
  { id: "TC-004", name: "玉珠串饰", weightKg: 0.4, fragility: 3 },
  { id: "TC-005", name: "动物骨胳标本", weightKg: 4.1, fragility: 2 },
  { id: "TC-006", name: "石斧", weightKg: 5.8, fragility: 1 },
  { id: "TC-007", name: "漆木残件", weightKg: 2.2, fragility: 3 },
  { id: "TC-008", name: "炭化植物遗存", weightKg: 1.1, fragility: 2 },
];

export const SEED_BOXES: Box[] = [
  { id: "箱A", grade: 3, maxLoadKg: 8 },
  { id: "箱B", grade: 2, maxLoadKg: 12 },
  { id: "箱C", grade: 2, maxLoadKg: 12 },
  { id: "箱D", grade: 1, maxLoadKg: 20 },
  { id: "箱E", grade: 1, maxLoadKg: 20 },
];

export const SEED_LOCATIONS: Location[] = [
  { id: "柜P-01（珍品）", grade: 3, boxSlots: 2, maxLoadKg: 20 },
  { id: "柜F-01（易碎）", grade: 2, boxSlots: 2, maxLoadKg: 25 },
  { id: "柜N-01（普通）", grade: 1, boxSlots: 2, maxLoadKg: 40 },
];
