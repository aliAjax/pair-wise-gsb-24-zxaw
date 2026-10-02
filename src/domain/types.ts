// 出土物交接台 · 领域模型
// 三类记录：① 出土物总台账（artifact/docs）② 现场装箱登记（assignment 计划）③ 库房入库登记（stored + 冻结依据）

export type Grade = 1 | 2 | 3; // 1=普通 2=易碎 3=珍品；箱子防护等级 / 柜位安保等级同此标尺

export const GRADE_LABEL: Record<Grade, string> = { 1: "普通", 2: "易碎", 3: "珍品" };

export type Site = "site" | "vault"; // 现场 / 库房

export interface Artifact {
  id: string; // 出土号
  name: string;
  weightKg: number;
  fragility: Grade; // 易碎等级
}

export interface Box {
  id: string; // 周转箱号
  grade: Grade; // 防护等级
  maxLoadKg: number;
}

export interface Location {
  id: string; // 库位号
  grade: Grade; // 柜位安保等级
  boxSlots: number; // 可放箱数
  maxLoadKg: number; // 柜位总承重
}

/** 复制台账：一件出土物当前归属的周转箱（现场/库房各持一份副本，回连后逐件合并） */
export interface ArtifactDoc {
  boxId: string | null;
  vclock: Record<string, number>; // 向量时钟：site/vault/hub 各节点计数
  quarantine?: boolean; // 并发换箱冲突未裁决期间隔离，规划器不自动装箱
}

/** 一件出土物的入库登记（现场装箱登记 → 库房入库登记 共用一行，随交接推进状态） */
export interface Assignment {
  artifactId: string;
  boxId: string;
  plannedLocationId: string | null; // null = 满柜排队中
  state: "planned" | "stale" | "stored";
  basis: string; // 登记依据指纹（catalogVersion + 箱柜等级容量）
  staleReason?: string;
  frozen?: FrozenBasis; // 已入库：冻结当时的依据
  storedAt?: number;
}

/** 入库时刻冻结的依据：等级/容量事后变更不追溯已入库记录 */
export interface FrozenBasis {
  catalogVersion: number;
  boxGrade: Grade;
  locationId: string;
  locationGrade: Grade;
  slot: number;
  boxSlots: number;
  usedSlots: number;
  at: number;
}

export interface Conflict {
  artifactId: string;
  siteBoxId: string | null;
  vaultBoxId: string | null;
  siteVc: Record<string, number>;
  vaultVc: Record<string, number>;
  at: number;
  resolved?: { boxId: string; by: "keeper"; at: number; note: string };
}

/** 交接批次里一个箱的操作：装箱 → 占柜位 → 确认入库，三段检查点分别落账 */
export interface BoxOp {
  id: string;
  boxId: string;
  artifactIds: string[];
  plannedLocationId: string | null;
  state: "pending" | "failed" | "done";
  stages: { packed: boolean; claimed: boolean; confirmed: boolean };
  phase: "pack" | "claim" | "confirm"; // 中断时停在哪一段，续作从这一段重试
  attempts: number;
  error?: string;
  outcome?: string;
}

export interface Batch {
  id: string;
  createdAt: number;
  status: "running" | "interrupted" | "done" | "invalid";
  ops: BoxOp[];
  planBasis: string;
}

export type FailureMode = "none" | "writefail" | "acklost";

export interface LocalEdit {
  toBoxId: string;
  n: number; // 本节点已累计的时钟自增
  baseBoxId: string | null; // 断网基线下该件原归属，回连冲突时还原"另一版"用
}

export interface NodeState {
  online: boolean;
  clock: number;
  edits: Record<string, LocalEdit>; // 离线期间未回连的本地改动
  baseVc: Record<string, Record<string, number>>; // 断网时刻各件台账的向量时钟基线
}

export interface LogEntry {
  id: number;
  t: number;
  level: "info" | "ok" | "warn" | "danger";
  msg: string;
}

export interface HandoverState {
  catalogVersion: number; // 主数据（箱/柜等级容量）版本，变更即 bump
  artifacts: Artifact[];
  boxes: Box[];
  locations: Location[];
  docs: Record<string, ArtifactDoc>; // 合并后的归属事实
  placements: Record<string, { locationId: string; slot: number; at: number }>; // 已占柜位的箱
  queue: string[]; // 满柜排队的箱
  assignments: Record<string, Assignment>;
  conflicts: Record<string, Conflict>;
  batch: Batch | null;
  nodes: { site: NodeState; vault: NodeState };
  failureMode: FailureMode;
  log: LogEntry[];
  tick: number;
}
