import type { HandoffDesk, DeskState } from "../domain/desk";
import { LEVEL_NAMES, NODE_NAMES } from "../domain/types";

/** 库房台账：已入库记录，依据快照随记录永久保留，主数据再变也不回改。 */
export function LedgerPanel({ state }: { state: DeskState; desk: HandoffDesk }) {
  const stored = state.registrations.filter((r) => r.status === "stored");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>已入库记录 · 保留当时依据</p>
          <h2>库房台账</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>登记号</th>
              <th>箱 → 库位</th>
              <th>入库时间</th>
              <th>当时依据</th>
              <th>当前对照</th>
            </tr>
          </thead>
          <tbody>
            {stored.length === 0 && (
              <tr>
                <td colSpan={5} className="cell-sub">
                  暂无已入库记录
                </td>
              </tr>
            )}
            {stored.map((r) => {
              const slot = state.slots.find((s) => s.id === r.slotId);
              const box = state.boxes.find((b) => b.id === r.boxId);
              const slotDrifted = slot !== undefined && slot.level !== r.basis.slotLevel;
              const boxDrifted = box !== undefined && box.level !== r.basis.boxLevel;
              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.id}</strong>
                  </td>
                  <td>
                    {r.basis.boxCode} → {r.basis.slotCode}
                  </td>
                  <td className="cell-sub">{r.storedAt?.slice(11, 19) ?? "—"}</td>
                  <td className="cell-sub">
                    箱{LEVEL_NAMES[r.basis.boxLevel]} / 柜{LEVEL_NAMES[r.basis.slotLevel]} ·{" "}
                    {r.basis.ruleVersion}
                  </td>
                  <td>
                    {slotDrifted || boxDrifted ? (
                      <span className="tag-drift" title="主数据已变化，本记录保留当时依据，不回改">
                        依据已冻结{slotDrifted && `：柜现${LEVEL_NAMES[slot.level]}`}
                        {boxDrifted && `：箱现${LEVEL_NAMES[box.level]}`}
                      </span>
                    ) : (
                      <span className="cell-sub">与当前一致</span>
                    )}
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
