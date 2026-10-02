/**
 * 交接台领域模型：出土物、周转箱、库位三类主数据，
 * 以及贯穿现场端 / 交接台 / 库房端的记录类型。
 */

/** 易碎等级 / 防护等级：1 最坚固，5 最易碎（要求最高防护）。 */
export type Level = 1 | 2 | 3 | 4 | 5;

export const LEVEL_NAMES: Record<Level, string> = {
  1: "Ⅰ级·坚固",
  2: "Ⅱ级·较稳",
  3: "Ⅲ级·一般",
  4: "Ⅳ级·易碎",
  5: "Ⅴ级·极易碎",
};

export interface Artifact {
  id: string;
  /** 出土物登记号，如 HXW-T0203-001 */
  code: string;
  name: string;
  weightGrams: number;
  /** 易碎等级：只能装入防护等级 ≥ 该等级的周转箱 */
  fragility: Level;
  /** 出处：探方 / 地层 */
  provenance: string;
}

export interface TurnoverBox {
  id: string;
  /** 周转箱编号，如 ZX-01 */
  code: string;
  /** 箱体防护等级 */
  level: Level;
  maxWeightGrams: number;
}

export interface CabinetSlot {
  id: string;
  /** 库位号，如 A-01 */
  code: string;
  /** 库位防护等级：只接纳等级 ≤ 该值的箱子 */
  level: Level;
  /** 可容纳箱数 */
  capacityBoxes: number;
  /** 可承受总重 */
  maxWeightGrams: number;
}

/** 装箱结果：器物 → 箱 */
export interface Placement {
  artifactId: string;
  boxId: string;
}

/** 登记依据快照：生成登记那一刻的规则输入，已入库后永久保留 */
export interface RegistrationBasis {
  boxCode: string;
  boxLevel: Level;
  boxLoadGrams: number;
  slotCode: string;
  slotLevel: Level;
  ruleVersion: string;
  computedAt: string;
}

export type RegistrationStatus = "pending" | "stored" | "invalidated";

/** 待入库登记：箱 → 库位的待执行分配 */
export interface Registration {
  id: string;
  boxId: string;
  slotId: string;
  basis: RegistrationBasis;
  status: RegistrationStatus;
  /** 失效原因（库位/箱等级变化等） */
  invalidReason?: string;
  /** 失效后由哪张新登记接替 */
  supersededBy?: string;
  storedAt?: string;
}

export type NodeId = "field" | "warehouse";

export const NODE_NAMES: Record<NodeId, string> = {
  field: "现场端",
  warehouse: "库房端",
};

/** 离线期间某一端对器物做出的移箱操作 */
export interface MoveOp {
  seq: number;
  node: NodeId;
  artifactId: string;
  /** 目标箱；null 表示移出周转箱（回到待装箱） */
  toBoxId: string | null;
  at: string;
}

/** 合并冲突：同一出土物在两端被换入不同的箱，两版并存待裁决 */
export interface MergeConflict {
  id: string;
  artifactId: string;
  baseBoxId: string | null;
  fieldBoxId: string | null;
  warehouseBoxId: string | null;
  status: "awaiting" | "resolved";
  resolution?: { chosen: NodeId; resolvedAt: string };
}

export type EventKind =
  | "boxing"
  | "register"
  | "queue"
  | "store"
  | "retry"
  | "invalidate"
  | "recompute"
  | "connection"
  | "merge"
  | "conflict"
  | "resolve";

export interface DeskEvent {
  seq: number;
  at: string;
  kind: EventKind;
  message: string;
}
