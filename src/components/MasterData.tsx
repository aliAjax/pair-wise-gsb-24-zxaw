import type { Box, Grade, HandoverState, Location } from "../domain/types";
import type { Action } from "../domain/store";
import { boxArtifactIds, boxLoad } from "../domain/util";
import { gradeClass, gradeLabel, locViews } from "../domain/view";

export function MasterData({ state, dispatch }: { state: HandoverState; dispatch: React.Dispatch<Action> }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>主数据</p>
          <h2>箱 / 柜 等级与容量 <span className="catalog-tag">catalog v{state.catalogVersion}</span></h2>
        </div>
        <p className="hint">等级或容量一变：待入库登记全部失效重算，进行中批次失效；已入库记录保留当时依据</p>
      </div>

      <h3 className="sub-h">周转箱</h3>
      <div className="master-grid">
        {state.boxes.map((b) => (
          <MasterBox key={b.id} box={b} state={state} dispatch={dispatch} />
        ))}
      </div>

      <h3 className="sub-h">库位柜</h3>
      <div className="master-grid">
        {state.locations.map((l) => (
          <MasterLoc key={l.id} loc={l} state={state} dispatch={dispatch} />
        ))}
      </div>
    </section>
  );
}

function GradeButtons({ current, onPick }: { current: Grade; onPick: (g: Grade) => void }) {
  return (
    <div className="grade-buttons">
      {([1, 2, 3] as Grade[]).map((g) => (
        <button key={g} className={current === g ? `chip-active ${gradeClass(g)}` : gradeClass(g)} onClick={() => onPick(g)}>
          {gradeLabel(g)}
        </button>
      ))}
    </div>
  );
}

function MasterBox({ box, state, dispatch }: { box: Box; state: HandoverState; dispatch: React.Dispatch<Action> }) {
  const ids = boxArtifactIds(state.artifacts, box.id, state.docs);
  const load = boxLoad(state.artifacts, box.id, state.docs);
  const storedHere = ids.filter((id) => state.assignments[id]?.state === "stored");
  return (
    <article className="master-card">
      <header>
        <strong>{box.id}</strong>
        <GradeButtons current={box.grade} onPick={(g) => dispatch({ type: "CHANGE_BOX", id: box.id, grade: g })} />
      </header>
      <div className="master-row">
        <label>承重 kg
          <input
            type="number" min={1} defaultValue={box.maxLoadKg} key={box.maxLoadKg}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v > 0 && v !== box.maxLoadKg) dispatch({ type: "CHANGE_BOX", id: box.id, maxLoadKg: v });
            }}
          />
        </label>
        <span>现载 {load.toFixed(1)}kg</span>
      </div>
      {storedHere.length > 0 && <small className="frozen-note">{storedHere.length} 件已入库，按冻结快照保留</small>}
    </article>
  );
}

function MasterLoc({ loc, state, dispatch }: { loc: Location; state: HandoverState; dispatch: React.Dispatch<Action> }) {
  const view = locViews(state).find((l) => l.id === loc.id)!;
  const storedHere = state.boxes
    .filter((b) => state.placements[b.id]?.locationId === loc.id)
    .flatMap((b) => boxArtifactIds(state.artifacts, b.id, state.docs)
      .filter((id) => state.assignments[id]?.state === "stored"));
  return (
    <article className="master-card">
      <header>
        <strong>{loc.id}</strong>
        <GradeButtons current={loc.grade} onPick={(g) => dispatch({ type: "CHANGE_LOCATION", id: loc.id, grade: g })} />
      </header>
      <div className="master-row">
        <label>箱槽
          <input
            type="number" min={0} defaultValue={loc.boxSlots} key={loc.boxSlots}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v >= 0 && v !== loc.boxSlots) dispatch({ type: "CHANGE_LOCATION", id: loc.id, boxSlots: v });
            }}
          />
        </label>
        <label>承重 kg
          <input
            type="number" min={1} defaultValue={loc.maxLoadKg} key={loc.maxLoadKg}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v > 0 && v !== loc.maxLoadKg) dispatch({ type: "CHANGE_LOCATION", id: loc.id, maxLoadKg: v });
            }}
          />
        </label>
        <span>占用 {view.usedSlots}/{view.boxSlots} · {view.load.toFixed(1)}kg</span>
      </div>
      {storedHere.length > 0 && <small className="frozen-note">{storedHere.length} 件已入库，降级/缩容后保留入库时依据并告警</small>}
    </article>
  );
}
