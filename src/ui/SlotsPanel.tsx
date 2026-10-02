import { loadsOf } from "../domain/boxing";
import type { HandoffDesk, DeskState } from "../domain/desk";
import type { Level } from "../domain/types";
import { LevelBadge } from "./bits";

/** 库位与排队：占用 = 已入库 + 待入库登记；库位等级调整触发失效重算与排队补位。 */
export function SlotsPanel({ state, desk }: { state: DeskState; desk: HandoffDesk }) {
  const loads = loadsOf(state.baseView, state.artifacts);
  const activeRegs = state.registrations.filter((r) => r.status !== "invalidated");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>柜位分配 · 满柜排队</p>
          <h2>库位与排队</h2>
        </div>
        <span className="panel-hint">调整库位等级可演示“待入库失效重算 / 排队补位”</span>
      </div>
      <div className="slot-grid">
        {state.slots.map((slot) => {
          const occupants = activeRegs.filter((r) => r.slotId === slot.id);
          const weight = occupants.reduce((sum, r) => sum + (loads[r.boxId] ?? 0), 0);
          return (
            <article key={slot.id} className="slot-card">
              <header>
                <strong>库位 {slot.code}</strong>
                <LevelBadge level={slot.level} />
                <span className="level-adjust">
                  <button
                    className="mini"
                    disabled={slot.level <= 1}
                    title="下调库位等级"
                    onClick={() => desk.changeSlotLevel(slot.id, (slot.level - 1) as Level)}
                  >
                    −
                  </button>
                  <button
                    className="mini"
                    disabled={slot.level >= 5}
                    title="上调库位等级"
                    onClick={() => desk.changeSlotLevel(slot.id, (slot.level + 1) as Level)}
                  >
                    ＋
                  </button>
                </span>
              </header>
              <p className="slot-usage">
                {occupants.length}/{slot.capacityBoxes} 箱 · {weight}g / {slot.maxWeightGrams}g
              </p>
              <div className="occupants">
                {occupants.length === 0 && <span className="cell-sub">空闲</span>}
                {occupants.map((r) => (
                  <span key={r.id} className={`occupant occ-${r.status}`}>
                    {r.basis.boxCode}
                    {r.status === "pending" ? "（待入库）" : "（已入库）"}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
        <article className="slot-card queue-card">
          <header>
            <strong>排队队列</strong>
            <span className="cell-sub">满柜时按防护等级优先补位</span>
          </header>
          {state.queue.length === 0 ? (
            <p className="cell-sub">无排队箱</p>
          ) : (
            <ol className="queue-list">
              {state.queue.map((boxId) => {
                const box = state.boxes.find((b) => b.id === boxId);
                return (
                  <li key={boxId}>
                    {box?.code ?? boxId}
                    {box && <LevelBadge level={box.level} />}
                  </li>
                );
              })}
            </ol>
          )}
        </article>
      </div>
    </section>
  );
}
