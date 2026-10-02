import type { MergeConflict, MoveOp, NodeId } from "./types";

export interface MergeResult {
  /** 合并后的器物 → 箱视图（冲突件保持基线值，等裁决） */
  merged: Record<string, string | null>;
  conflicts: MergeConflict[];
  /** 被单边改动、自动合并的出土物 */
  autoMerged: Array<{ artifactId: string; from: NodeId; toBoxId: string | null }>;
}

function lastOpsByArtifact(ops: MoveOp[]): Map<string, MoveOp> {
  const byArtifact = new Map<string, MoveOp>();
  for (const op of ops) byArtifact.set(op.artifactId, op);
  return byArtifact;
}

/**
 * 离线改动回连后的逐件合并。
 * 以断开时的共同基线为准：只有一端动过的件采用该端；
 * 两端都动且目标一致则去重采用；两端换入不同箱 → 冲突，
 * 两版都保留在冲突单里，等保管员裁决，避免一件出土物暗占两个周转箱。
 */
export function mergeNodeEdits(input: {
  base: Record<string, string | null>;
  fieldOps: MoveOp[];
  warehouseOps: MoveOp[];
  now: string;
  conflictId: () => string;
}): MergeResult {
  const { base, fieldOps, warehouseOps, conflictId } = input;
  const fieldLast = lastOpsByArtifact(fieldOps);
  const warehouseLast = lastOpsByArtifact(warehouseOps);
  const artifactIds = new Set([...fieldLast.keys(), ...warehouseLast.keys()]);

  const merged: Record<string, string | null> = { ...base };
  const conflicts: MergeConflict[] = [];
  const autoMerged: MergeResult["autoMerged"] = [];

  for (const artifactId of [...artifactIds].sort()) {
    const baseBox = base[artifactId] ?? null;
    const fieldOp = fieldLast.get(artifactId);
    const warehouseOp = warehouseLast.get(artifactId);
    const fieldBox = fieldOp ? fieldOp.toBoxId : baseBox;
    const warehouseBox = warehouseOp ? warehouseOp.toBoxId : baseBox;

    const fieldChanged = fieldBox !== baseBox;
    const warehouseChanged = warehouseBox !== baseBox;

    if (!fieldChanged && !warehouseChanged) continue;
    if (fieldChanged && !warehouseChanged) {
      merged[artifactId] = fieldBox;
      autoMerged.push({ artifactId, from: "field", toBoxId: fieldBox });
      continue;
    }
    if (warehouseChanged && !fieldChanged) {
      merged[artifactId] = warehouseBox;
      autoMerged.push({ artifactId, from: "warehouse", toBoxId: warehouseBox });
      continue;
    }
    if (fieldBox === warehouseBox) {
      merged[artifactId] = fieldBox;
      autoMerged.push({ artifactId, from: "field", toBoxId: fieldBox });
      continue;
    }
    conflicts.push({
      id: conflictId(),
      artifactId,
      baseBoxId: baseBox,
      fieldBoxId: fieldBox,
      warehouseBoxId: warehouseBox,
      status: "awaiting",
    });
  }

  return { merged, conflicts, autoMerged };
}
