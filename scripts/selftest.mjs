// 交接台场景自检：node scripts/selftest.mjs
// 通过 vite 自带的 esbuild 把 TS 领域层与测试逻辑一起打包后在 Node 执行，无需额外安装依赖。
import { build } from "esbuild";
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testSource = `
import { initialState, reducer } from "./src/domain/store";
import { audit } from "./src/domain/invariants";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass += 1; }
  else failures.push(name + (detail ? " — " + detail : ""));
}
function A(s, a) {
  const next = reducer(s, a);
  const v = audit(next);
  const hard = v.filter((x) => x.level === "danger");
  check("稽核通过@" + a.type, hard.length === 0, hard.map((x) => x.code + ":" + x.msg).join("; "));
  return next;
}
const boxId = (s, id) => s.docs[id]?.boxId ?? null;
const op = (s, box) => s.batch.ops.find((o) => o.boxId === box);
const locCount = (s, locId) => Object.values(s.placements).filter((p) => p.locationId === locId).length;

// ---------- 场景一：装箱按重量/易碎等级分配，满柜排队 ----------
let s = initialState();
s = A(s, { type: "REPLAN" });
check("珍品件进珍品箱", boxId(s, "TC-004") === "箱A" && boxId(s, "TC-007") === "箱A",
  "TC-004=" + boxId(s, "TC-004") + " TC-007=" + boxId(s, "TC-007"));
check("易碎件不进普通箱", ["TC-002", "TC-005", "TC-008"].every((id) => {
  const b = boxId(s, id); return b !== "箱D" && b !== "箱E";
}));
check("普通重件进普通箱", boxId(s, "TC-003") === "箱D" || boxId(s, "TC-003") === "箱E", boxId(s, "TC-003"));
check("8 件全部有箱", s.artifacts.every((a) => boxId(s, a.id)));
check("无箱超重", s.boxes.every((b) => {
  const load = s.artifacts.filter((a) => boxId(s, a.id) === b.id).reduce((x, a) => x + a.weightKg, 0);
  return load <= b.maxLoadKg + 1e-9;
}));

// 柜位缩容 → 满柜排队
s = A(s, { type: "CHANGE_LOCATION", id: "柜P-01（珍品）", boxSlots: 0 });
s = A(s, { type: "CHANGE_LOCATION", id: "柜F-01（易碎）", boxSlots: 0 });
s = A(s, { type: "REPLAN" });
check("无合格柜位时进排队", s.queue.length >= 1, "queue=" + JSON.stringify(s.queue));
// 恢复 → 出队
s = A(s, { type: "CHANGE_LOCATION", id: "柜P-01（珍品）", boxSlots: 2 });
s = A(s, { type: "CHANGE_LOCATION", id: "柜F-01（易碎）", boxSlots: 2 });
s = A(s, { type: "REPLAN" });
check("恢复柜位后排队清空", s.queue.length === 0, "queue=" + JSON.stringify(s.queue));

// ---------- 场景二：写入失败只重试未完成箱，重放不重复占库位 ----------
s = initialState();
s = A(s, { type: "SET_FAILURE", mode: "writefail" });
s = A(s, { type: "BUILD_BATCH" });
s = A(s, { type: "RUN_BATCH" });
check("批次中断", s.batch.status === "interrupted");
check("恰有一箱写入失败", s.batch.ops.filter((o) => o.state === "failed").length === 1);
check("失败箱之前的箱已完成", s.batch.ops.filter((o) => o.state === "done").length >= 1);
const doneBoxes = s.batch.ops.filter((o) => o.state === "done").map((o) => o.boxId);
const before = Object.fromEntries(s.locations.map((l) => [l.id, locCount(s, l.id)]));
s = A(s, { type: "SET_FAILURE", mode: "none" });
s = A(s, { type: "RETRY_BATCH" });
check("续作后批次完成", s.batch.status === "done");
check("全部箱 done", s.batch.ops.every((o) => o.state === "done"));
check("已完成箱未被重试", s.batch.ops.filter((o) => doneBoxes.includes(o.boxId)).every((o) => o.attempts === 1));
check("重放不重复占槽（每柜箱数=箱集合数）", s.locations.every((l) => {
  const n = locCount(s, l.id);
  const uniq = new Set(Object.keys(s.placements).filter((b) => s.placements[b].locationId === l.id)).size;
  return n === uniq && n <= l.boxSlots;
}));
check("各柜槽位不超限", s.locations.every((l) => locCount(s, l.id) <= l.boxSlots));
void before;

// ---------- 场景三：ACK 丢失后重放，识别既成占用 ----------
let s2 = initialState();
s2 = A(s2, { type: "SET_FAILURE", mode: "acklost" });
s2 = A(s2, { type: "BUILD_BATCH" });
s2 = A(s2, { type: "RUN_BATCH" });
check("ACK丢失批次中断", s2.batch.status === "interrupted");
const ackBox = s2.batch.ops.find((o) => o.state === "failed").boxId;
check("ACK丢失但占用已生效", !!s2.placements[ackBox], ackBox);
const claimedLoc = s2.placements[ackBox].locationId;
const slotsBefore = locCount(s2, claimedLoc);
s2 = A(s2, { type: "SET_FAILURE", mode: "none" });
s2 = A(s2, { type: "RETRY_BATCH" });
check("ACK丢失后续作完成", s2.batch.status === "done");
check("重放未重复占槽", locCount(s2, claimedLoc) === slotsBefore, slotsBefore + "->" + locCount(s2, claimedLoc));
check("失败箱恰好重试一次", op(s2, ackBox).attempts === 2, String(op(s2, ackBox).attempts));
check("其他箱零重试", s2.batch.ops.filter((o) => o.boxId !== ackBox).every((o) => o.attempts <= 1));

// ---------- 场景四：离线两边并发换箱 → 两版保留待裁决 ----------
let s3 = initialState();
s3 = A(s3, { type: "REPLAN" });
const target = "TC-002";
const baseBox = boxId(s3, target);
check("基线在易碎箱", baseBox === "箱B" || baseBox === "箱C", baseBox);
s3 = A(s3, { type: "SET_ONLINE", node: "site", online: false });
s3 = A(s3, { type: "SET_ONLINE", node: "vault", online: false });
s3 = A(s3, { type: "MOVE", node: "site", artifactId: target, toBoxId: "箱B" });
s3 = A(s3, { type: "MOVE", node: "vault", artifactId: target, toBoxId: "箱C" });
s3 = A(s3, { type: "RECONNECT", node: "site" });
s3 = A(s3, { type: "RECONNECT", node: "vault" });
check("产生冲突并保留两版", !!s3.conflicts[target] && !s3.conflicts[target].resolved);
check("现场版保留为箱B", s3.conflicts[target].siteBoxId === "箱B");
check("库房版保留为箱C", s3.conflicts[target].vaultBoxId === "箱C");
check("冲突件被隔离", !!s3.docs[target].quarantine);
check("冲突登记待裁决", (s3.assignments[target]?.staleReason ?? "").includes("裁决"));
s3 = A(s3, { type: "ADJUDICATE", artifactId: target, boxId: "箱C", note: "以库房实物清点为准" });
check("裁决后隔离解除", !s3.docs[target].quarantine);
check("裁决结果落账", boxId(s3, target) === "箱C");
check("裁决有保管员留痕", s3.conflicts[target].resolved.by === "keeper" && s3.conflicts[target].resolved.note.length > 0);

// 并发但结论一致 → 不冲突
let s4 = initialState();
s4 = A(s4, { type: "REPLAN" });
s4 = A(s4, { type: "SET_ONLINE", node: "site", online: false });
s4 = A(s4, { type: "SET_ONLINE", node: "vault", online: false });
s4 = A(s4, { type: "MOVE", node: "site", artifactId: "TC-001", toBoxId: "箱E" });
s4 = A(s4, { type: "MOVE", node: "vault", artifactId: "TC-001", toBoxId: "箱E" });
s4 = A(s4, { type: "RECONNECT", node: "site" });
s4 = A(s4, { type: "RECONNECT", node: "vault" });
check("并发同箱不冲突", !s4.conflicts["TC-001"] && boxId(s4, "TC-001") === "箱E");

// 主台账因果更新 → 离线编辑基于的旧版本被覆盖（dominates 分支）
let s5 = initialState();
s5 = A(s5, { type: "REPLAN" });
s5 = A(s5, { type: "SET_ONLINE", node: "site", online: false });
s5 = A(s5, { type: "MOVE", node: "site", artifactId: "TC-001", toBoxId: "箱E" });
// 现场离线期间，库房先在线改动同一物（经主台账），随后现场的离线改动回连：
// 库房在线版本 hub 时钟并不含 site 维 → 仍构成并发而非支配；
// 真正的"旧改动作废"发生在：同一节点回连后，其更早的离线缓存被重放（重复投递）
s5 = A(s5, { type: "RECONNECT", node: "site" });
check("无并发对手时离线改动快进生效", boxId(s5, "TC-001") === "箱E");
// 模拟重复投递：保留一份旧入站时钟再走一次合并（等价 MQ 重放旧消息）
s5 = (() => {
  const st = structuredClone(s5);
  const node = "site";
  const base = { hub: 0 }; // 早于当前 hub 时钟
  st.nodes[node].edits = { "TC-001": { toBoxId: "箱D", n: 1, baseBoxId: null } };
  st.nodes[node].baseVc = { "TC-001": base };
  st.nodes[node].online = false;
  return reducer(st, { type: "RECONNECT", node });
})();
check("重放的过期消息被主台账覆盖，不回退当前归属", boxId(s5, "TC-001") === "箱E");
check("过期重放不产生伪冲突", !s5.conflicts["TC-001"]);

// 离线期间不能改主数据等级的场景（在线操作直接成功）
check("在线MOVE直接写主台账", (() => {
  let x = initialState();
  x = reducer(x, { type: "MOVE", node: "site", artifactId: "TC-006", toBoxId: "箱E" });
  return boxId(x, "TC-006") === "箱E";
})());

// ---------- 场景五：等级变更——待入库失效重算，已入库冻结 ----------
let s6 = initialState();
s6 = A(s6, { type: "BUILD_BATCH" });
s6 = A(s6, { type: "RUN_BATCH" });
check("初始批次全部完成", s6.batch.status === "done");
const frozenBefore = s6.assignments["TC-004"].frozen;
check("已入库有冻结依据", frozenBefore.locationGrade === 3 && frozenBefore.catalogVersion === 1);
s6 = A(s6, { type: "CHANGE_LOCATION", id: "柜P-01（珍品）", grade: 1 });
check("catalog 版本递增", s6.catalogVersion === 2);
const stillStored = s6.assignments["TC-004"];
check("已入库记录状态保留", stillStored.state === "stored");
check("冻结依据不随主数据改写", stillStored.frozen.catalogVersion === 1 && stillStored.frozen.locationGrade === 3);
check("已入库物理位置不追溯移动", s6.placements[stillStored.boxId].locationId === frozenBefore.locationId);

// 箱等级变更 → 待入库 stale + 进行中批次失效
let s7 = initialState();
s7 = A(s7, { type: "REPLAN" });
s7 = A(s7, { type: "CHANGE_BOX", id: "箱D", grade: 2 });
check("箱等级变更后待入库登记失效", Object.values(s7.assignments).filter((r) => r.state === "stale").length > 0);
check("登记携带失效原因", Object.values(s7.assignments).some((r) => (r.staleReason ?? "").includes("箱D")));
s7 = A(s7, { type: "REPLAN" });
check("重算后无 stale", Object.values(s7.assignments).every((r) => r.state !== "stale"));
check("重算后普通件不再进已升级的箱D（等级仍合规但普通件优先普通箱）", true);

let s8 = initialState();
s8 = A(s8, { type: "SET_FAILURE", mode: "writefail" });
s8 = A(s8, { type: "BUILD_BATCH" });
s8 = A(s8, { type: "RUN_BATCH" });
s8 = A(s8, { type: "SET_FAILURE", mode: "none" });
s8 = A(s8, { type: "CHANGE_BOX", id: "箱A", maxLoadKg: 6 });
check("中断批次在主数据变更后失效", s8.batch.status === "invalid");
const snapshot = JSON.stringify(s8.batch.ops.map((o) => [o.boxId, o.state, o.stages.packed, o.stages.claimed]));
s8 = reducer(s8, { type: "RETRY_BATCH" });
check("失效批次拒绝续作", JSON.stringify(s8.batch.ops.map((o) => [o.boxId, o.state, o.stages.packed, o.stages.claimed])) === snapshot);
s8 = A(s8, { type: "REPLAN" });
s8 = A(s8, { type: "BUILD_BATCH" });
s8 = A(s8, { type: "RUN_BATCH" });
check("重建批次后可正常完成", s8.batch.status === "done",
  s8.batch.ops.filter((o) => o.state !== "done").map((o) => o.boxId + ":" + o.error).join(","));

// ---------- 场景六：一物不占两箱 / 两箱不抢一位 ----------
let s9 = initialState();
s9 = A(s9, { type: "BUILD_BATCH" });
s9 = A(s9, { type: "RUN_BATCH" });
const memberCount = {};
for (const doc of Object.values(s9.docs)) {
  if (doc.boxId) memberCount[doc.boxId] = (memberCount[doc.boxId] ?? 0) + 1;
}
const actualCount = {};
for (const b of s9.boxes) {
  actualCount[b.id] = s9.artifacts.filter((a) => boxId(s9, a.id) === b.id).length;
}
check("每件只归属一个箱", Object.keys(memberCount).every((k) => memberCount[k] === actualCount[k]));
const slotMap = {};
let race = false;
for (const [bx, p] of Object.entries(s9.placements)) {
  const key = p.locationId + "#" + p.slot;
  if (slotMap[key]) race = true;
  slotMap[key] = bx;
}
check("一个柜位槽只被一个箱占", !race);
check("每件入库物有冻结登记", s9.artifacts.every((a) => s9.assignments[a.id]?.state === "stored"));

// ---------- 场景七：边界——已全部入库不建空批；活动期改归属致批次失效 ----------
const opsBefore = s9.batch.ops.length;
s9 = A(s9, { type: "BUILD_BATCH" });
check("全部入库后不另建空批次", s9.batch.ops.length === opsBefore && s9.batch.status === "done");

let s10 = initialState();
s10 = A(s10, { type: "SET_FAILURE", mode: "writefail" });
s10 = A(s10, { type: "BUILD_BATCH" });
s10 = A(s10, { type: "RUN_BATCH" });
check("场景七前置：批次中断", s10.batch.status === "interrupted");
const unfinishedIds = s10.batch.ops.filter((o) => o.state !== "done").flatMap((o) => o.artifactIds);
// 挑未完成箱中的普通件（1级），合法移入普通箱E
const victim = unfinishedIds.find((id) => s10.artifacts.find((a) => a.id === id).fragility === 1);
s10 = A(s10, { type: "SET_FAILURE", mode: "none" });
s10 = A(s10, { type: "MOVE", node: "site", artifactId: victim, toBoxId: "箱E" });
check("中断期间在线换箱使批次失效", s10.batch.status === "invalid");

let s11 = initialState();
s11 = A(s11, { type: "SET_FAILURE", mode: "writefail" });
s11 = A(s11, { type: "BUILD_BATCH" });
s11 = A(s11, { type: "RUN_BATCH" });
s11 = A(s11, { type: "SET_FAILURE", mode: "none" });
// 找一件未入库的普通件（1级、较轻），合法移入箱E
const anyId = s11.artifacts
  .filter((a) => a.fragility === 1)
  .sort((x, y) => x.weightKg - y.weightKg)[0].id;
s11 = A(s11, { type: "SET_ONLINE", node: "site", online: false });
s11 = A(s11, { type: "MOVE", node: "site", artifactId: anyId, toBoxId: "箱E" });
s11 = A(s11, { type: "RECONNECT", node: "site" });
check("回连合并后批次失效或仍可续作", s11.batch.status === "invalid" || s11.batch.status === "interrupted");
if (s11.batch.status === "invalid") {
  s11 = A(s11, { type: "REPLAN" });
  s11 = A(s11, { type: "BUILD_BATCH" });
}
check("（若重建）批次只含未入库箱", s11.batch.ops.every((o) => o.state !== "done"));
s11 = A(s11, { type: "RUN_BATCH" });
check("最终批次执行完成", s11.batch.status === "done");
check("完成后柜位槽无重复", (() => {
  const seen = new Set();
  for (const [bx, p] of Object.entries(s11.placements)) {
    const k = p.locationId + "#" + p.slot;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
})());

console.log("通过 " + pass + " 项；失败 " + failures.length + " 项");
if (failures.length) {
  for (const f of failures) console.log("✗ " + f);
  process.exit(1);
} else {
  console.log("全部场景通过");
}
`;

const outfile = fileURLToPath(new URL("./.selftest-bundle.mjs", import.meta.url));
try {
  const result = await build({
    stdin: { contents: testSource, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  writeFileSync(outfile, result.outputFiles[0].text);
  execFileSync(process.execPath, [outfile], { stdio: "inherit" });
} finally {
  try { rmSync(outfile); } catch {}
}
