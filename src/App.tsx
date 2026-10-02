import { useEffect, useReducer } from "react";
import "./styles.css";
import { initialState, reducer } from "./domain/store";
import type { HandoverState } from "./domain/types";
import { TopBar, Violations } from "./components/TopBar";
import { Ledger } from "./components/Ledger";
import { PackingPanel } from "./components/PackingPanel";
import { BatchPanel } from "./components/BatchPanel";
import { Conflicts } from "./components/Conflicts";
import { MasterData } from "./components/MasterData";
import { StoredRecords } from "./components/StoredRecords";
import { LogPanel } from "./components/LogPanel";

const STORAGE_KEY = "hxwl-handover-state-v1";

function init(): HandoverState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as HandoverState;
  } catch { /* 忽略损坏存档 */ }
  return initialState();
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* 存储满等情况忽略 */ }
  }, [state]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 出土物交接台</p>
          <h1>现场 × 库房 可续作交接台</h1>
          <p className="subtitle">
            三类记录一账贯通：出土物总台账（双副本）、现场装箱登记、库房入库登记。
            装箱按重量与易碎等级分配柜位，满柜排队；交接中断可续作，重试幂等不重复占库位；
            离线改动回连逐件合并，两边换箱保留两版待保管员裁决；等级变更只作废旧登记，已入库保留当时依据。
          </p>
        </div>
        <div className="stack-card">
          <span>一致性保证（实时稽核）</span>
          <strong>一件出土物不占两个箱 · 一个周转箱不抢两个柜位</strong>
          <span>纯逻辑层：React 与 Node 自测共用同一套引擎</span>
        </div>
      </section>

      <TopBar state={state} dispatch={dispatch} />
      <Violations state={state} />

      <Ledger state={state} dispatch={dispatch} />
      <Conflicts state={state} dispatch={dispatch} />
      <PackingPanel state={state} dispatch={dispatch} />
      <BatchPanel state={state} dispatch={dispatch} />
      <StoredRecords state={state} />
      <MasterData state={state} dispatch={dispatch} />
      <LogPanel state={state} dispatch={dispatch} />
    </main>
  );
}

export default App;
