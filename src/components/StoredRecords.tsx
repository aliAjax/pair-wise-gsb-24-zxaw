import { useState } from "react";
import type { HandoverState } from "../domain/types";
import { gradeLabel } from "../domain/view";

/** 已入库登记：冻结入库当时的 catalog 版本、等级、槽位；主数据事后变更不追溯 */
export function StoredRecords({ state }: { state: HandoverState }) {
  const [open, setOpen] = useState(false);
  const rows = Object.values(state.assignments).filter((r) => r.state === "stored");
  if (rows.length === 0) return null;
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>库房入库登记</p>
          <h2>已入库记录（依据冻结，{rows.length} 件）</h2>
        </div>
        <button onClick={() => setOpen((v) => !v)}>{open ? "收起" : "展开明细"}</button>
      </div>
      {open && (
        <div className="table-wrap">
          <table className="ledger-table frozen-table">
            <thead>
              <tr>
                <th>出土号</th><th>周转箱</th><th>柜位/槽</th>
                <th>入库时箱等级</th><th>入库时柜等级</th><th>catalog 版本</th><th>依据指纹</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const f = r.frozen!;
                const nowLoc = state.locations.find((l) => l.id === f.locationId);
                const nowBox = state.boxes.find((b) => b.id === r.boxId);
                const drifted = nowLoc && nowLoc.grade !== f.locationGrade;
                return (
                  <tr key={r.artifactId}>
                    <td className="mono">{r.artifactId}</td>
                    <td className="mono">{r.boxId}</td>
                    <td className="mono">{f.locationId} · 槽{f.slot}/{f.boxSlots}</td>
                    <td>
                      {gradeLabel(f.boxGrade)}
                      {nowBox && nowBox.grade !== f.boxGrade && (
                        <small className="drift"> 现{gradeLabel(nowBox.grade)}</small>
                      )}
                    </td>
                    <td>
                      {gradeLabel(f.locationGrade)}
                      {drifted && <small className="drift"> 现{gradeLabel(nowLoc!.grade)}</small>}
                    </td>
                    <td>
                      v{f.catalogVersion}
                      {f.catalogVersion !== state.catalogVersion && <small className="drift"> 现v{state.catalogVersion}</small>}
                    </td>
                    <td className="mono">{r.basis.slice(0, 8)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint">灰色小字表示主数据事后已变；记录本身不回改，稽核以 warn 提示保管员决定是否挪柜。</p>
        </div>
      )}
    </section>
  );
}
