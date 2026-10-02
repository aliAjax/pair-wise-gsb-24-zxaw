import type { HandoffDesk, DeskState } from "../domain/desk";
import { NODE_NAMES } from "../domain/types";
import { LevelBadge } from "./bits";

function boxCode(state: DeskState, boxId: string | null | undefined): string {
  if (boxId == null) return "待装箱";
  return state.boxes.find((b) => b.id === boxId)?.code ?? boxId;
}

/**
 * 三类记录对照：现场端 / 交接台 / 库房端各一套器物→箱记录。
 * 离线时当前操作端的改动只落在本端，与基线的差异即时高亮；
 * 回连后逐件合并，差异消失或转为冲突单。
 */
export function TriViewPanel({ state, desk }: { state: DeskState; desk: HandoffDesk }) {
  const offline = state.connection === "offline";
  const activeView = offline ? state.nodeViews[state.activeNode] : state.baseView;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>三类记录 · 可续作交接</p>
          <h2>器物 — 箱记录对照</h2>
        </div>
        <span className="panel-hint">
          {offline
            ? `离线中：改动只记入${NODE_NAMES[state.activeNode]}，回连后逐件合并`
            : "在线：移箱即时同步三端"}
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>出土物</th>
              <th>重量</th>
              <th>易碎</th>
              <th className={offline && state.activeNode === "field" ? "col-active" : ""}>
                现场端记录
              </th>
              <th>交接台记录</th>
              <th className={offline && state.activeNode === "warehouse" ? "col-active" : ""}>
                库房端记录
              </th>
              <th>移箱</th>
            </tr>
          </thead>
          <tbody>
            {state.artifacts.map((a) => {
              const field = state.nodeViews.field[a.id] ?? null;
              const base = state.baseView[a.id] ?? null;
              const warehouse = state.nodeViews.warehouse[a.id] ?? null;
              const unassigned = state.unassigned.includes(a.id);
              return (
                <tr key={a.id}>
                  <td>
                    <strong>{a.code}</strong>
                    <span className="cell-sub">
                      {a.name} · {a.provenance}
                    </span>
                  </td>
                  <td>{a.weightGrams}g</td>
                  <td>
                    <LevelBadge level={a.fragility} />
                  </td>
                  <td className={field !== base ? "cell-diff" : ""}>{boxCode(state, field)}</td>
                  <td>
                    {boxCode(state, base)}
                    {unassigned && <span className="tag-warn">无箱可装</span>}
                  </td>
                  <td className={warehouse !== base ? "cell-diff" : ""}>
                    {boxCode(state, warehouse)}
                  </td>
                  <td>
                    <select
                      value={activeView[a.id] ?? ""}
                      onChange={(e) => desk.moveArtifact(a.id, e.target.value || null)}
                    >
                      <option value="">待装箱</option>
                      {state.boxes.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code}（{b.level}级）
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
