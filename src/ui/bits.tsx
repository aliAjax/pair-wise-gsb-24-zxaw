import { LEVEL_NAMES, type Level } from "../domain/types";

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`level-badge level-${level}`}>{LEVEL_NAMES[level]}</span>;
}

export function LoadBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 100 ? "over" : pct >= 85 ? "hot" : "";
  return (
    <div className="load-bar">
      <i style={{ width: `${pct}%` }} className={tone} />
      <span>
        {value}g / {max}g
      </span>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待入库",
  stored: "已入库",
  invalidated: "已失效",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill st-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const KIND_LABEL: Record<string, string> = {
  boxing: "装箱",
  register: "登记",
  queue: "排队",
  store: "入库",
  retry: "重试",
  invalidate: "失效",
  recompute: "重算",
  connection: "连接",
  merge: "合并",
  conflict: "冲突",
  resolve: "裁决",
};

export function KindPill({ kind }: { kind: string }) {
  return <span className={`kind-pill kind-${kind}`}>{KIND_LABEL[kind] ?? kind}</span>;
}
