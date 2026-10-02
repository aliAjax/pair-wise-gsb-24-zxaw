import { useState } from "react";
import type { HandoverState } from "../domain/types";
import type { Action } from "../domain/store";

/** 并发换箱冲突：保留两版，保管员裁决；未裁决件隔离不自动装箱 */
export function Conflicts({ state, dispatch }: { state: HandoverState; dispatch: React.Dispatch<Action> }) {
  const open = Object.values(state.conflicts).filter((c) => !c.resolved);
  const closed = Object.values(state.conflicts).filter((c) => c.resolved);
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>离线合并</p>
          <h2>保管员裁决台{open.length > 0 && <span className="batch-status status-interrupted">{open.length} 件待裁</span>}</h2>
        </div>
      </div>
      {open.length === 0 && closed.length === 0 && (
        <p className="hint">暂无冲突。让现场、库房分别断网，对同一件出土物各换一个箱，再依次回连即可复现。</p>
      )}
      <div className="conflict-list">
        {open.map((c) => (
          <ConflictCard key={c.artifactId} c={c} state={state} dispatch={dispatch} />
        ))}
        {closed.map((c) => {
          const art = state.artifacts.find((a) => a.id === c.artifactId);
          return (
            <article key={c.artifactId} className="conflict-card resolved">
              <header><strong>{c.artifactId}</strong>{art?.name}<span className="badge badge-stored">已裁决</span></header>
              <p>
                现场版 {c.siteBoxId ?? "未装箱"} / 库房版 {c.vaultBoxId ?? "未装箱"} →
                保管员采用 <b>{c.resolved!.boxId}</b>（{c.resolved!.note || "无备注"}）
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ConflictCard({ c, state, dispatch }: {
  c: HandoverState["conflicts"][string]; state: HandoverState; dispatch: React.Dispatch<Action>;
}) {
  const art = state.artifacts.find((a) => a.id === c.artifactId);
  const [pick, setPick] = useState(c.siteBoxId ?? "");
  const [note, setNote] = useState("");
  return (
    <article className="conflict-card open">
      <header>
        <strong>{c.artifactId}</strong>
        {art?.name}
        <span className="badge badge-danger">两版并存·隔离中</span>
      </header>
      <div className="conflict-versions">
        <label className={pick === c.siteBoxId ? "pick" : ""}>
          <input type="radio" name={`pick-${c.artifactId}`} checked={pick === c.siteBoxId} onChange={() => setPick(c.siteBoxId ?? "")} />
          现场版：<b>{c.siteBoxId ?? "未装箱"}</b>
          <small>{fmtVc(c.siteVc)}</small>
        </label>
        <label className={pick === c.vaultBoxId ? "pick" : ""}>
          <input type="radio" name={`pick-${c.artifactId}`} checked={pick === c.vaultBoxId} onChange={() => setPick(c.vaultBoxId ?? "")} />
          库房版：<b>{c.vaultBoxId ?? "未装箱"}</b>
          <small>{fmtVc(c.vaultVc)}</small>
        </label>
      </div>
      <div className="conflict-decide">
        <input placeholder="裁决备注（如：以库房实物清点为准）" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          className="primary-action"
          disabled={!pick}
          onClick={() => dispatch({ type: "ADJUDICATE", artifactId: c.artifactId, boxId: pick, note })}
        >
          保管员裁定
        </button>
      </div>
    </article>
  );
}

function fmtVc(vc: Record<string, number>) {
  const names: Record<string, string> = { site: "现场", vault: "库房", hub: "主台账" };
  return Object.entries(vc).map(([k, v]) => `${names[k] ?? k}${v}`).join("·");
}
