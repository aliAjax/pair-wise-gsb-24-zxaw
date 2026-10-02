import type { HandoffDesk, DeskState } from "../domain/desk";
import { LEVEL_NAMES } from "../domain/types";
import { StatusPill } from "./bits";

/**
 * 待入库登记：封箱登记 → 批量写入台账。
 * 写入中断后只重试未完成的箱；重放靠幂等键，不重复占库位。
 */
export function RegistrationsPanel({ state, desk }: { state: DeskState; desk: HandoffDesk }) {
  const pending = state.registrations.filter((r) => r.status === "pending");
  const invalidated = state.registrations.filter((r) => r.status === "invalidated");
  const batch = state.lastBatch;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>登记 → 写入 → 断点续作</p>
          <h2>待入库登记</h2>
        </div>
        <div className="button-row">
          <button onClick={() => desk.sealAndRegister()}>封箱登记</button>
          <button className="primary-action" onClick={() => desk.executePending()}>
            执行入库
          </button>
          <button onClick={() => desk.executePending({ failAfter: 1 })}>模拟写入中断</button>
          <button onClick={() => desk.executePending({ loseResponseAfter: 1 })}>
            模拟应答丢失
          </button>
          <button
            className={batch?.interrupted ? "primary-action" : ""}
            onClick={() => desk.retryIncomplete()}
          >
            断点续作·只重试未完成箱
          </button>
        </div>
      </div>

      {batch && (
        <p className={batch.interrupted ? "batch-line interrupted" : "batch-line"}>
          上一批次：{batch.total} 项完成 {batch.done} 项
          {batch.interrupted ? " · 已中断，剩余箱保持待入库" : " · 已完成"}
        </p>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>登记号</th>
              <th>箱 → 库位</th>
              <th>登记依据（生成时快照）</th>
              <th>状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 && invalidated.length === 0 && (
              <tr>
                <td colSpan={5} className="cell-sub">
                  暂无登记：先「封箱登记」生成待入库单
                </td>
              </tr>
            )}
            {[...pending, ...invalidated].map((r) => (
              <tr key={r.id} className={r.status === "invalidated" ? "row-muted" : ""}>
                <td>
                  <strong>{r.id}</strong>
                </td>
                <td>
                  {r.basis.boxCode} → {r.basis.slotCode}
                </td>
                <td className="cell-sub">
                  箱{LEVEL_NAMES[r.basis.boxLevel]} / 柜{LEVEL_NAMES[r.basis.slotLevel]} ·{" "}
                  {r.basis.boxLoadGrams}g · {r.basis.ruleVersion}
                </td>
                <td>
                  <StatusPill status={r.status} />
                </td>
                <td className="cell-sub">
                  {r.invalidReason}
                  {r.supersededBy && ` · 由 ${r.supersededBy} 接替`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
