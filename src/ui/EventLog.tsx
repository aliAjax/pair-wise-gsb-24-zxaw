import type { DeskState } from "../domain/desk";
import { KindPill } from "./bits";

/** 交接日志：交接台自身的第三套记录——每次装箱、登记、合并、失效、裁决都留痕。 */
export function EventLog({ state }: { state: DeskState }) {
  const events = [...state.events].reverse();
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>交接记录 · 流水留痕</p>
          <h2>交接日志</h2>
        </div>
      </div>
      <ol className="event-log">
        {events.map((e) => (
          <li key={e.seq}>
            <span className="event-seq">#{e.seq}</span>
            <KindPill kind={e.kind} />
            <span className="event-msg">{e.message}</span>
            <time>{e.at.slice(11, 19)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
