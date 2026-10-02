import type { HandoverState } from "../domain/types";
import type { Action } from "../domain/store";
import { boxViews, gradeClass, gradeLabel, locViews, preview } from "../domain/view";

/** 记录二：现场装箱登记 —— 按重量/易碎等级分配柜位，满柜排队 */
export function PackingPanel({ state, dispatch }: { state: HandoverState; dispatch: React.Dispatch<Action> }) {
  const boxes = boxViews(state);
  const locs = locViews(state);
  const plan = preview(state);
  const hasStale = Object.values(state.assignments).some((a) => a.state === "stale");
  const batchActive = state.batch && (state.batch.status === "running" || state.batch.status === "interrupted");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>记录二</p>
          <h2>现场装箱登记 · 柜位分配</h2>
        </div>
        <div className="row-actions">
          <button
            onClick={() => dispatch({ type: "REPLAN", reason: "手工触发重算" })}
            className={hasStale ? "primary-action" : ""}
          >
            {hasStale ? "失效登记重算" : "重新规划"}
          </button>
          <button
            className="primary-action"
            disabled={!!batchActive}
            onClick={() => dispatch({ type: "BUILD_BATCH" })}
            title={batchActive ? "当前批次未终结，请直接续作" : "把当前装箱方案固化为交接批次"}
          >
            建立交接批次
          </button>
        </div>
      </div>

      <div className="loc-grid">
        {locs.map((l) => (
          <div key={l.id} className={`loc-card ${l.usedSlots >= l.boxSlots ? "loc-full" : ""}`}>
            <header>
              <span className={`grade-tag ${gradeClass(l.grade)}`}>{gradeLabel(l.grade)}柜</span>
              <strong>{l.id}</strong>
            </header>
            <div className="slots">
              {Array.from({ length: Math.max(l.boxSlots, l.boxes.length) }).map((_, i) => {
                const occupant = l.boxes.find((b) => b.slot === i + 1);
                return (
                  <div key={i} className={`slot ${occupant ? "slot-used" : i < l.boxSlots ? "slot-free" : "slot-none"}`}>
                    {occupant ? occupant.boxId : i < l.boxSlots ? "空槽" : "—"}
                  </div>
                );
              })}
            </div>
            <footer>
              槽 {l.usedSlots}/{l.boxSlots} · 承重 {l.load.toFixed(1)}/{l.maxLoad}kg
            </footer>
          </div>
        ))}
      </div>

      <div className="box-grid">
        {boxes.map((b) => {
          const plannedLoc = plan.boxLocation[b.id];
          return (
            <div key={b.id} className={`box-card ${b.queued ? "box-queued" : ""} ${b.locationId ? "box-stored" : ""}`}>
              <header>
                <span className={`grade-tag ${gradeClass(b.grade)}`}>{gradeLabel(b.grade)}级</span>
                <strong>{b.id}</strong>
                {b.queued && <span className="queue-flag">排队中</span>}
                {b.locationId && <span className="stored-flag">已在柜</span>}
              </header>
              <p className="box-items">{b.artifactIds.length ? b.artifactIds.join("、") : "空箱"}</p>
              <footer>
                载重 {b.load.toFixed(1)}/{b.maxLoad}kg ·{" "}
                {b.locationId
                  ? <>柜位 <b>{b.locationId}</b></>
                  : plannedLoc
                    ? <>待入 <b>{plannedLoc}</b></>
                    : <span className="queue-flag">无合格空柜</span>}
              </footer>
            </div>
          );
        })}
      </div>
      <p className="hint">
        规划依据指纹 <code>{plan.basis.slice(0, 10)}</code>：箱/柜等级容量与装箱结果的哈希；依据一变，待入库登记即失效。
      </p>
    </section>
  );
}
