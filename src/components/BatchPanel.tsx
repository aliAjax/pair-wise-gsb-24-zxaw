import type { HandoverState } from "../domain/types";
import type { Action } from "../domain/store";
import { boxLoad } from "../domain/util";

const STATUS_TEXT: Record<string, string> = {
  running: "进行中",
  interrupted: "已中断可续作",
  done: "已完成",
  invalid: "依据失效",
};

export function BatchPanel({ state, dispatch }: { state: HandoverState; dispatch: React.Dispatch<Action> }) {
  const b = state.batch;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>记录三</p>
          <h2>库房入库交接批次{ b ? <span className={`batch-status status-${b.status}`}>{STATUS_TEXT[b.status]}</span> : null}</h2>
        </div>
        {b && (
          <div className="row-actions">
            <button
              className="primary-action"
              disabled={b.status === "done" || b.status === "invalid"}
              onClick={() => dispatch({ type: b.status === "interrupted" ? "RETRY_BATCH" : "RUN_BATCH" })}
            >
              {b.status === "interrupted" ? "续作（只重试未完成箱）" : b.status === "running" ? "继续执行" : "执行交接"}
            </button>
            {b.status === "invalid" && (
              <>
                <button onClick={() => dispatch({ type: "REPLAN", reason: "失效批次重算" })}>重新规划</button>
                <button className="primary-action" onClick={() => dispatch({ type: "BUILD_BATCH" })}>重建批次</button>
              </>
            )}
          </div>
        )}
      </div>

      {!b && <p className="hint">尚未建立批次。装箱方案确定后点击"建立交接批次"。</p>}

      {b && (
        <>
          <p className="hint">
            批次 {b.id} · 依据 {b.planBasis.slice(0, 10)} ·
            已完成 {b.ops.filter((o) => o.state === "done").length}/{b.ops.length} 箱
          </p>
          <div className="op-list">
            {b.ops.map((op) => {
              const load = boxLoad(state.artifacts, op.boxId, state.docs);
              return (
                <article key={op.id} className={`op-card op-${op.state}`}>
                  <header>
                    <strong>{op.boxId}</strong>
                    <span className="op-state">{op.outcome ?? opStateText(op.state, op.plannedLocationId)}</span>
                    <small>尝试 {op.attempts} 次</small>
                  </header>
                  <p>{op.artifactIds.join("、")}（{load.toFixed(1)}kg）</p>
                  <div className="stages">
                    <Stage on={op.stages.packed} label="装箱登记" />
                    <Stage on={op.stages.claimed} label="占柜位（幂等）" />
                    <Stage on={op.stages.confirmed} label="入库确认+冻结" />
                  </div>
                  {op.error && <p className="op-error">中断点：{op.error}（断点阶段：{phaseText(op.phase)}）</p>}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function Stage({ on, label }: { on: boolean; label: string }) {
  return <span className={`stage ${on ? "stage-on" : ""}`}>{on ? "✓" : "○"} {label}</span>;
}

function opStateText(state: string, loc: string | null) {
  if (state === "done") return "已入库";
  if (state === "failed") return "写入失败";
  return loc ? "待执行" : "满柜排队";
}
function phaseText(p: string) {
  return p === "pack" ? "装箱" : p === "claim" ? "占柜位" : "入库确认";
}
