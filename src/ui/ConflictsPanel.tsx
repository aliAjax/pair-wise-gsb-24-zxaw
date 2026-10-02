import type { HandoffDesk, DeskState } from "../domain/desk";
import { NODE_NAMES } from "../domain/types";

function boxLabel(state: DeskState, boxId: string | null): string {
  if (boxId === null) return "待装箱";
  return state.boxes.find((b) => b.id === boxId)?.code ?? boxId;
}

/** 冲突裁决：同一出土物两端换箱，两版并存，保管员选定一版后另一版释放。 */
export function ConflictsPanel({ state, desk }: { state: DeskState; desk: HandoffDesk }) {
  const awaiting = state.conflicts.filter((c) => c.status === "awaiting");
  const resolved = state.conflicts.filter((c) => c.status === "resolved");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>一件出土物不占两个周转箱</p>
          <h2>冲突裁决（保管员）</h2>
        </div>
      </div>
      {awaiting.length === 0 && resolved.length === 0 && (
        <p className="cell-sub">暂无冲突：离线两端对同一出土物换入不同箱时，会在此生成裁决单</p>
      )}
      <div className="conflict-list">
        {awaiting.map((c) => {
          const artifact = state.artifacts.find((a) => a.id === c.artifactId);
          return (
            <article key={c.id} className="conflict-card">
              <header>
                <strong>
                  {c.id} · {artifact?.code ?? c.artifactId} {artifact?.name}
                </strong>
                <span className="tag-warn">待裁决</span>
              </header>
              <p className="cell-sub">原箱：{boxLabel(state, c.baseBoxId)}</p>
              <div className="conflict-versions">
                {(["field", "warehouse"] as const).map((side) => (
                  <div key={side} className="version-card">
                    <span>{NODE_NAMES[side]}版</span>
                    <strong>{boxLabel(state, side === "field" ? c.fieldBoxId : c.warehouseBoxId)}</strong>
                    <button onClick={() => desk.resolveConflict(c.id, side)}>
                      采用{NODE_NAMES[side]}版
                    </button>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
        {resolved.map((c) => {
          const artifact = state.artifacts.find((a) => a.id === c.artifactId);
          return (
            <article key={c.id} className="conflict-card resolved">
              <header>
                <strong>
                  {c.id} · {artifact?.code ?? c.artifactId}
                </strong>
                <span className="cell-sub">
                  已裁决：采用{c.resolution ? NODE_NAMES[c.resolution.chosen] : ""}版 →{" "}
                  {boxLabel(state, state.baseView[c.artifactId] ?? null)}，另一版已释放
                </span>
              </header>
            </article>
          );
        })}
      </div>
    </section>
  );
}
