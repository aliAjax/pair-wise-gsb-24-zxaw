import type { HandoverState, Site } from "../domain/types";
import type { Action } from "../domain/store";
import { offlineCount, stats } from "../domain/view";
import { audit } from "../domain/invariants";

export function TopBar({ state, dispatch }: { state: HandoverState; dispatch: React.Dispatch<Action> }) {
  const st = stats(state);
  const violations = audit(state);
  const hard = violations.filter((v) => v.level === "danger");
  const warns = violations.filter((v) => v.level === "warn");

  return (
    <div className="topbar panel">
      <div className="audit-lamp">
        <span className={`lamp ${hard.length ? "lamp-danger" : warns.length ? "lamp-warn" : "lamp-ok"}`} />
        <div>
          <strong>双账稽核</strong>
          <small>
            {hard.length ? `${hard.length} 条危险违规` : warns.length ? `${warns.length} 条事后漂移（已入库保留依据）` : "一物一箱、一箱一位，账实一致"}
          </small>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="出土物" value={st.total} />
        <Kpi label="已入库" value={st.stored} tone="ok" />
        <Kpi label="待入库" value={st.planned} />
        <Kpi label="失效/排队" value={`${st.stale}/${st.queuedBoxes}`} tone="warn" />
        <Kpi label="待裁决" value={st.conflicts} tone={st.conflicts ? "danger" : "ok"} />
      </div>
      <div className="node-controls">
        <NodeNode state={state} dispatch={dispatch} node="site" name="现场" />
        <NodeNode state={state} dispatch={dispatch} node="vault" name="库房" />
      </div>
      <div className="failure-controls">
        <span>故障注入</span>
        {([
          ["none", "关闭"],
          ["writefail", "写入失败"],
          ["acklost", "回执丢失"],
        ] as const).map(([mode, label]) => (
          <button
            key={mode}
            className={state.failureMode === mode ? "chip-active" : ""}
            onClick={() => dispatch({ type: "SET_FAILURE", mode })}
          >
            {label}
          </button>
        ))}
        <button className="reset-btn" onClick={() => dispatch({ type: "RESET" })}>重置台账</button>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function NodeNode({ state, dispatch, node, name }: {
  state: HandoverState; dispatch: React.Dispatch<Action>; node: Site; name: string;
}) {
  const n = state.nodes[node];
  const pending = offlineCount(state, node);
  return (
    <div className={`node-node ${n.online ? "" : "node-off"}`}>
      <div className="node-head">
        <span className={`dot ${n.online ? "dot-on" : "dot-off"}`} />
        <strong>{name}</strong>
        <em>{n.online ? "在线" : "离线"}</em>
      </div>
      <div className="node-actions">
        <button onClick={() => dispatch({ type: "SET_ONLINE", node, online: !n.online })}>
          {n.online ? "断网" : "标记网络恢复"}
        </button>
        <button
          className="primary-action"
          disabled={pending === 0}
          onClick={() => dispatch({ type: "RECONNECT", node })}
          title={pending === 0 ? "无待合并的本地改动" : "回连并逐件合并到主台账"}
        >
          回连合并{pending ? `（${pending}件）` : ""}
        </button>
      </div>
    </div>
  );
}

export function Violations({ state }: { state: HandoverState }) {
  const violations = audit(state);
  if (violations.length === 0) return null;
  return (
    <section className="panel violations">
      <h2>稽核提示</h2>
      <ul>
        {violations.map((v, i) => (
          <li key={i} className={v.level === "danger" ? "v-danger" : "v-warn"}>
            <b>{v.code}</b> {v.msg}
          </li>
        ))}
      </ul>
    </section>
  );
}
