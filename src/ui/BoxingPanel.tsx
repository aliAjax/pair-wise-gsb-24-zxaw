import { loadsOf } from "../domain/boxing";
import type { HandoffDesk, DeskState } from "../domain/desk";
import type { Level } from "../domain/types";
import { LevelBadge, LoadBar } from "./bits";

/** 装箱台：按重量与易碎等级分箱；箱等级调整会触发待入库登记失效重算。 */
export function BoxingPanel({ state, desk }: { state: DeskState; desk: HandoffDesk }) {
  const loads = loadsOf(state.baseView, state.artifacts);
  const offline = state.connection === "offline";

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>按重量 + 易碎等级分箱</p>
          <h2>装箱台</h2>
        </div>
        <button
          className="primary-action"
          disabled={offline}
          title={offline ? "离线期间不能重排装箱" : "按重量与易碎等级重新分箱"}
          onClick={() => desk.runBoxing()}
        >
          自动装箱
        </button>
      </div>
      <div className="box-grid">
        {state.boxes.map((box) => {
          const load = loads[box.id] ?? 0;
          const contents = state.artifacts.filter((a) => state.baseView[a.id] === box.id);
          return (
            <article key={box.id} className="box-card">
              <header>
                <strong>{box.code}</strong>
                <LevelBadge level={box.level} />
                <span className="level-adjust">
                  <button
                    className="mini"
                    disabled={box.level <= 1}
                    title="下调箱防护等级（触发失效重算）"
                    onClick={() => desk.changeBoxLevel(box.id, (box.level - 1) as Level)}
                  >
                    −
                  </button>
                  <button
                    className="mini"
                    disabled={box.level >= 5}
                    title="上调箱防护等级（触发失效重算）"
                    onClick={() => desk.changeBoxLevel(box.id, (box.level + 1) as Level)}
                  >
                    ＋
                  </button>
                </span>
              </header>
              <LoadBar value={load} max={box.maxWeightGrams} />
              <p className="box-contents">
                {contents.length === 0
                  ? "空箱"
                  : contents.map((a) => a.code.split("-").pop()).join("、")}
              </p>
            </article>
          );
        })}
      </div>
      {state.unassigned.length > 0 && (
        <p className="queue-note">
          未装箱：{state.unassigned
            .map((id) => state.artifacts.find((a) => a.id === id)?.code ?? id)
            .join("、")}
          （超重或等级不符，待定制囊匣）
        </p>
      )}
    </section>
  );
}
