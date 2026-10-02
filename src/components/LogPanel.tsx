import type { HandoverState } from "../domain/types";
import type { Action } from "../domain/store";

const LEVEL_LABEL: Record<string, string> = {
  info: "信息", ok: "成功", warn: "警告", danger: "中断/冲突",
};

export function LogPanel({ state, dispatch }: { state: HandoverState; dispatch: React.Dispatch<Action> }) {
  return (
    <section className="panel log-panel">
      <div className="section-heading">
        <div>
          <p>交接流水</p>
          <h2>操作与中断日志</h2>
        </div>
        <button onClick={() => dispatch({ type: "CLEAR_LOG" })}>清空</button>
      </div>
      <ul className="log-list">
        {state.log.map((e) => (
          <li key={e.id} className={`log-${e.level}`}>
            <time>{new Date(e.t).toLocaleTimeString("zh-CN", { hour12: false })}</time>
            <span className={`log-tag tag-${e.level}`}>{LEVEL_LABEL[e.level]}</span>
            <span>{e.msg}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
