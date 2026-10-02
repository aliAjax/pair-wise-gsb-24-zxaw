import { useState, useSyncExternalStore } from "react";
import { HandoffDesk } from "./domain/desk";
import { RULE_VERSION } from "./domain/allocation";
import { seed } from "./domain/seed";
import { NODE_NAMES, type NodeId } from "./domain/types";
import { BoxingPanel } from "./ui/BoxingPanel";
import { ConflictsPanel } from "./ui/ConflictsPanel";
import { EventLog } from "./ui/EventLog";
import { LedgerPanel } from "./ui/LedgerPanel";
import { RegistrationsPanel } from "./ui/RegistrationsPanel";
import { SlotsPanel } from "./ui/SlotsPanel";
import { TriViewPanel } from "./ui/TriViewPanel";
import "./styles.css";

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={tone} />
    </article>
  );
}

function App() {
  const [desk] = useState(() => new HandoffDesk(structuredClone(seed)));
  const state = useSyncExternalStore(desk.subscribe, desk.getState);

  const offline = state.connection === "offline";
  const boxed = Object.values(state.baseView).filter((v) => v !== null).length;
  const pendingCount = state.registrations.filter((r) => r.status === "pending").length;
  const storedCount = state.registrations.filter((r) => r.status === "stored").length;
  const awaitingCount = state.conflicts.filter((c) => c.status === "awaiting").length;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 出土物交接台 · {RULE_VERSION}</p>
          <h1>装箱入库交接台</h1>
          <p className="subtitle">
            现场端、库房端各记一套，交接台把三类记录接成可续作的流水：
            按重量与易碎等级装箱分柜、满柜排队；离线改动回连逐件合并、双版待裁决；
            写入中断只重试未完成的箱、重放不占重位；等级一变待入库失效重算、已入库保留当时依据。
          </p>
        </div>
        <div className="stack-card">
          <span>连接状态</span>
          <strong className={offline ? "conn-off" : "conn-on"}>
            {offline ? "离线（改动暂存本端）" : "在线（三端同步）"}
          </strong>
          <div className="button-row">
            <button
              className={offline ? "primary-action" : ""}
              onClick={() => desk.setConnection(offline ? "online" : "offline")}
            >
              {offline ? "回连合并" : "断网离线"}
            </button>
          </div>
          <span>当前操作端（离线时改动记入该端）</span>
          <div className="chips">
            {(Object.keys(NODE_NAMES) as NodeId[]).map((node) => (
              <button
                key={node}
                className={state.activeNode === node ? "node-active" : ""}
                onClick={() => desk.setActiveNode(node)}
              >
                {NODE_NAMES[node]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="出土物" value={state.artifacts.length} tone="status-ok" />
        <MetricCard label="已装箱" value={boxed} tone="status-ok" />
        <MetricCard label="待入库" value={pendingCount} tone="status-watch" />
        <MetricCard label="已入库" value={storedCount} tone="status-ok" />
        <MetricCard label="排队箱" value={state.queue.length} tone="status-watch" />
        <MetricCard label="待裁决冲突" value={awaitingCount} tone="status-danger" />
      </section>

      <TriViewPanel state={state} desk={desk} />
      <div className="two-col">
        <BoxingPanel state={state} desk={desk} />
        <SlotsPanel state={state} desk={desk} />
      </div>
      <RegistrationsPanel state={state} desk={desk} />
      <div className="two-col">
        <ConflictsPanel state={state} desk={desk} />
        <LedgerPanel state={state} desk={desk} />
      </div>
      <EventLog state={state} />
    </main>
  );
}

export default App;
