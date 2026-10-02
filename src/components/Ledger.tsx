import { useState } from "react";
import type { HandoverState, Site } from "../domain/types";
import type { Action } from "../domain/store";
import { GRADE_LABEL } from "../domain/types";
import { STATE_BADGE, artifactStateLabel, gradeClass, gradeLabel } from "../domain/view";

/** ① 出土物总台账：现场/库房各持副本，换箱操作按节点在线状态决定直写或本地暂存 */
export function Ledger({ state, dispatch }: { state: HandoverState; dispatch: React.Dispatch<Action> }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>记录一</p>
          <h2>出土物总台账（现场 × 库房 双副本）</h2>
        </div>
        <p className="hint">换箱操作：节点在线直写主台账；离线只记本地账，回连后逐件合并</p>
      </div>
      <div className="table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>出土号</th>
              <th>名称</th>
              <th>重量</th>
              <th>易碎等级</th>
              <th>主台账归属</th>
              <th>状态</th>
              <th>现场端换箱</th>
              <th>库房端换箱</th>
            </tr>
          </thead>
          <tbody>
            {state.artifacts.map((a) => {
              const doc = state.docs[a.id];
              const label = artifactStateLabel(state, a);
              const row = state.assignments[a.id];
              const siteEdit = state.nodes.site.edits[a.id];
              const vaultEdit = state.nodes.vault.edits[a.id];
              return (
                <tr key={a.id} className={doc.quarantine ? "row-quarantine" : ""}>
                  <td className="mono">{a.id}</td>
                  <td>{a.name}</td>
                  <td>{a.weightKg.toFixed(1)} kg</td>
                  <td><span className={`grade-tag ${gradeClass(a.fragility)}`}>{gradeLabel(a.fragility)}（{a.fragility}级）</span></td>
                  <td className="mono">
                    {doc.quarantine ? <span className="quar">⛔ 隔离中</span> : doc.boxId ?? "—"}
                  </td>
                  <td>
                    <span className={`badge ${STATE_BADGE[label]}`}>{label}</span>
                    {row?.staleReason && <small className="stale-reason">{row.staleReason}</small>}
                  </td>
                  <td>
                    <MoveSelect
                      state={state}
                      node="site"
                      artifactId={a.id}
                      pending={siteEdit?.toBoxId}
                      disabled={!!doc.quarantine}
                      dispatch={dispatch}
                    />
                  </td>
                  <td>
                    <MoveSelect
                      state={state}
                      node="vault"
                      artifactId={a.id}
                      pending={vaultEdit?.toBoxId}
                      disabled={!!doc.quarantine}
                      dispatch={dispatch}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        等级标尺：{[1, 2, 3].map((g) => `${g}=${GRADE_LABEL[g as 1 | 2 | 3]}`).join(" / ")}；箱子防护等级、柜位安保等级须 ≥ 物件易碎等级。
      </p>
    </section>
  );
}

function MoveSelect({ state, node, artifactId, pending, disabled, dispatch }: {
  state: HandoverState;
  node: Site;
  artifactId: string;
  pending?: string;
  disabled: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  const [val, setVal] = useState("");
  const online = state.nodes[node].online;
  return (
    <div className="move-cell">
      <select value={val} onChange={(e) => setVal(e.target.value)} disabled={disabled}>
        <option value="">选择箱…</option>
        {state.boxes.map((b) => (
          <option key={b.id} value={b.id}>{b.id}（{gradeLabel(b.grade)}级/{b.maxLoadKg}kg）</option>
        ))}
      </select>
      <button
        disabled={disabled || !val}
        onClick={() => { dispatch({ type: "MOVE", node, artifactId, toBoxId: val }); setVal(""); }}
      >
        {online ? "登记" : "离线记"}
      </button>
      {pending && <small className="pending-tag">本地待合: {pending}</small>}
    </div>
  );
}
