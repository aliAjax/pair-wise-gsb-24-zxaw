import { describe, expect, it } from "vitest";
import { allocateSlots, findInvalidated, occupancyFrom } from "../allocation";
import { planBoxing } from "../boxing";
import { HandoffDesk } from "../desk";
import { LedgerStore, placementKey, type PlacementOp } from "../ledger";
import { mergeNodeEdits } from "../merge";
import { seed } from "../seed";
import type { CabinetSlot, MoveOp, TurnoverBox } from "../types";

const tick = () => {
  let t = 0;
  return () => `2026-10-02T08:${String(++t).padStart(2, "0")}:00Z`;
};

function newDesk() {
  return new HandoffDesk(structuredClone(seed), tick());
}

/** 一路走到：装箱 → 登记，返回 desk 供各场景继续操作。 */
function deskWithRegistrations() {
  const desk = newDesk();
  desk.runBoxing();
  desk.sealAndRegister();
  return desk;
}

describe("装箱：按重量和易碎等级分箱", () => {
  it("易碎等级超过箱防护等级的器物不入该箱", () => {
    const result = planBoxing(
      [
        { id: "x", code: "X-1", name: "漆器", weightGrams: 100, fragility: 5, provenance: "" },
        { id: "y", code: "Y-1", name: "石块", weightGrams: 100, fragility: 1, provenance: "" },
      ],
      [
        { id: "b1", code: "B1", level: 2, maxWeightGrams: 1000 },
        { id: "b2", code: "B2", level: 5, maxWeightGrams: 1000 },
      ],
    );
    expect(result.placements).toContainEqual({ artifactId: "x", boxId: "b2" });
    expect(result.placements).toContainEqual({ artifactId: "y", boxId: "b1" });
  });

  it("超重不装：箱承重装满后剩余器物另找箱或报未装箱", () => {
    const result = planBoxing(
      [
        { id: "x", code: "X-1", name: "甲", weightGrams: 800, fragility: 1, provenance: "" },
        { id: "y", code: "Y-1", name: "乙", weightGrams: 500, fragility: 1, provenance: "" },
      ],
      [{ id: "b1", code: "B1", level: 5, maxWeightGrams: 1000 }],
    );
    expect(result.placements).toEqual([{ artifactId: "x", boxId: "b1" }]);
    expect(result.unassigned).toEqual(["y"]);
  });

  it("best-fit：优先填满剩余承重最小的合适箱", () => {
    const result = planBoxing(
      [{ id: "x", code: "X-1", name: "甲", weightGrams: 600, fragility: 1, provenance: "" }],
      [
        { id: "big", code: "BIG", level: 5, maxWeightGrams: 5000 },
        { id: "fit", code: "FIT", level: 5, maxWeightGrams: 1000 },
      ],
    );
    expect(result.placements).toEqual([{ artifactId: "x", boxId: "fit" }]);
  });

  it("种子数据装箱结果符合预期（含超重未装箱）", () => {
    const desk = newDesk();
    desk.runBoxing();
    const s = desk.getState();
    expect(s.baseView["a08"]).toBe("bx2"); // 漆耳杯只能进Ⅴ级箱
    expect(s.baseView["a07"]).toBe("bx1"); // 铜镜进“够用即可”的Ⅲ级箱
    expect(s.baseView["a06"]).toBe("bx5"); // 玉璧进Ⅳ级箱，Ⅴ级箱留给漆器
    expect(s.unassigned).toEqual(["a11"]); // 石柱础 8000g 无箱可装
  });
});

describe("柜位分配：满柜就排队", () => {
  const slots: CabinetSlot[] = [
    { id: "s1", code: "S1", level: 5, capacityBoxes: 1, maxWeightGrams: 5000 },
    { id: "s2", code: "S2", level: 2, capacityBoxes: 1, maxWeightGrams: 5000 },
  ];
  const boxes = new Map<string, TurnoverBox>([
    ["b1", { id: "b1", code: "B1", level: 4, maxWeightGrams: 1000 }],
    ["b2", { id: "b2", code: "B2", level: 2, maxWeightGrams: 1000 }],
    ["b3", { id: "b3", code: "B3", level: 1, maxWeightGrams: 1000 }],
  ]);

  it("高防护需求箱优先占位，满柜的箱排队", () => {
    let n = 0;
    const { registrations, queued } = allocateSlots({
      boxIds: ["b1", "b2", "b3"],
      boxes,
      boxLoads: { b1: 100, b2: 100, b3: 100 },
      slots,
      occupancy: new Map(),
      now: "t",
      nextRegId: () => `R${++n}`,
    });
    // b1(Ⅳ级) 只能进 S1；b2 进 S2；b3 满柜排队
    expect(registrations.map((r) => [r.boxId, r.slotId])).toEqual([
      ["b1", "s1"],
      ["b2", "s2"],
    ]);
    expect(queued).toEqual(["b3"]);
  });

  it("库位等级不足时不接纳高等级箱", () => {
    let n = 0;
    const { registrations, queued } = allocateSlots({
      boxIds: ["b1"],
      boxes,
      boxLoads: { b1: 100 },
      slots: [slots[1]], // 只有Ⅱ级库位
      occupancy: new Map(),
      now: "t",
      nextRegId: () => `R${++n}`,
    });
    expect(registrations).toEqual([]);
    expect(queued).toEqual(["b1"]);
  });
});

describe("断点续作：写入失败只重试未完成的箱", () => {
  it("批次中断后重试，只补未完成的箱，不重复占库位", () => {
    const desk = deskWithRegistrations();
    const total = desk.getState().registrations.filter((r) => r.status === "pending").length;
    expect(total).toBe(3); // ZX-02→A-01, ZX-05→A-02, ZX-03→B-01；ZX-01 排队

    desk.executePending({ failAfter: 1 });
    let s = desk.getState();
    expect(s.lastBatch).toEqual({ total: 3, done: 1, interrupted: true });
    expect(s.registrations.filter((r) => r.status === "stored")).toHaveLength(1);
    expect(s.registrations.filter((r) => r.status === "pending")).toHaveLength(2);

    desk.retryIncomplete();
    s = desk.getState();
    expect(s.registrations.filter((r) => r.status === "stored")).toHaveLength(3);
    expect(s.lastBatch?.interrupted).toBe(false);
  });

  it("应答丢失后重放整批：幂等键跳过，库位不被重复占用", () => {
    const desk = deskWithRegistrations();
    desk.executePending({ loseResponseAfter: 1 }); // 全部落账，但只确认 1 项
    let s = desk.getState();
    expect(s.lastBatch?.interrupted).toBe(true);
    expect(s.registrations.filter((r) => r.status === "stored")).toHaveLength(1);

    desk.retryIncomplete(); // 重放剩余 2 项，台账里其实已落账
    s = desk.getState();
    expect(s.registrations.filter((r) => r.status === "stored")).toHaveLength(3);
    // 每个库位里每个箱只出现一次
    const ledger = (desk as unknown as { ledger: LedgerStore }).ledger;
    expect(ledger.boxesAt("s1")).toEqual(["bx2"]);
    expect(ledger.boxesAt("s2")).toEqual(["bx5"]);
    expect(ledger.boxesAt("s3")).toEqual(["bx3"]);
    const replayEvents = s.events.filter((e) => e.message.includes("幂等键"));
    expect(replayEvents.length).toBe(2);
  });

  it("台账层面对同一幂等键的重放直接跳过", () => {
    const store = new LedgerStore(
      new Map<string, CabinetSlot>([
        ["s1", { id: "s1", code: "S1", level: 5, capacityBoxes: 1, maxWeightGrams: 1000 }],
      ]),
      { b1: 100 },
    );
    const op: PlacementOp = { key: placementKey("b1", "s1"), registrationId: "R1", boxId: "b1", slotId: "s1" };
    const first = store.applyBatch([op]);
    const second = store.applyBatch([{ ...op, registrationId: "R2" }]); // 另一批重放同一放置
    expect(first.results[0].outcome).toBe("applied");
    expect(second.results[0].outcome).toBe("duplicate");
    expect(store.boxesAt("s1")).toEqual(["b1"]);
  });
});

describe("失效重算：等级一变，待入库失效、已入库留据", () => {
  it("库位等级下调使待入库登记失效并重算，已入库记录保留当时依据", () => {
    const desk = deskWithRegistrations();
    // 先让两张登记入库，其余保持待入库
    desk.executePending({ failAfter: 2 });
    let s = desk.getState();
    expect(s.registrations.filter((r) => r.status === "stored")).toHaveLength(2);

    // A-01 由Ⅴ级降为Ⅳ级：ZX-02 的待入库登记（若还在）应失效
    // 当前 ZX-02 已入库，应保留依据快照不动
    desk.changeSlotLevel("s1", 4);
    s = desk.getState();
    const stored = s.registrations.find((r) => r.boxId === "bx2" && r.status === "stored");
    expect(stored?.basis.slotLevel).toBe(5); // 当时依据保留
    expect(s.slots.find((x) => x.id === "s1")?.level).toBe(4); // 当前值已变
  });

  it("待入库登记随库位等级变化失效，并以新依据重算", () => {
    const desk = deskWithRegistrations();
    // 全部待入库时调整 A-02 等级：Ⅳ→Ⅲ，ZX-05(Ⅳ级箱) 不再能进 A-02
    desk.changeSlotLevel("s2", 3);
    const s = desk.getState();
    const oldReg = s.registrations.find((r) => r.boxId === "bx5" && r.status === "invalidated");
    expect(oldReg).toBeTruthy();
    expect(oldReg?.invalidReason).toContain("A-02");
    // ZX-05 无其他Ⅳ级以上空位 → 排队
    expect(s.queue).toContain("bx5");
  });

  it("箱等级变化同样触发失效重算", () => {
    const desk = deskWithRegistrations();
    desk.changeBoxLevel("bx5", 5); // ZX-05 升为Ⅴ级箱，A-02(Ⅳ级) 容不下
    const s = desk.getState();
    const reg = s.registrations.find((r) => r.boxId === "bx5");
    expect(reg?.status).toBe("invalidated");
    expect(s.queue).toContain("bx5");
  });

  it("库位升级后排队的箱自动补位", () => {
    const desk = deskWithRegistrations();
    expect(desk.getState().queue).toEqual(["bx1"]); // ZX-01 满柜排队
    desk.changeSlotLevel("s3", 3); // B-01 升为Ⅲ级，可接纳 ZX-01
    const s = desk.getState();
    expect(s.queue).toEqual([]);
    const reg = s.registrations.find((r) => r.boxId === "bx1" && r.status === "pending");
    expect(reg?.slotId).toBe("s3");
    expect(reg?.basis.slotLevel).toBe(3); // 新依据
  });
});

describe("离线合并：逐件合并，双版待裁决", () => {
  function op(seq: number, node: "field" | "warehouse", artifactId: string, toBoxId: string | null): MoveOp {
    return { seq, node, artifactId, toBoxId, at: "t" };
  }

  it("单边改动直接采用，双边同目标一致则去重", () => {
    let n = 0;
    const result = mergeNodeEdits({
      base: { a: "b1", b: "b1", c: "b1" },
      fieldOps: [op(1, "field", "a", "b2"), op(3, "field", "c", "b3")],
      warehouseOps: [op(2, "warehouse", "b", "b3"), op(4, "warehouse", "c", "b3")],
      now: "t",
      conflictId: () => `C${++n}`,
    });
    expect(result.merged).toEqual({ a: "b2", b: "b3", c: "b3" });
    expect(result.conflicts).toEqual([]);
    expect(result.autoMerged).toHaveLength(3);
  });

  it("同一出土物两边换不同箱 → 两版保留待裁决", () => {
    let n = 0;
    const result = mergeNodeEdits({
      base: { a: "b1" },
      fieldOps: [op(1, "field", "a", "b2")],
      warehouseOps: [op(2, "warehouse", "a", "b3")],
      now: "t",
      conflictId: () => `C${++n}`,
    });
    expect(result.merged.a).toBe("b1"); // 裁决前保持基线，不暗占两箱
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      fieldBoxId: "b2",
      warehouseBoxId: "b3",
      baseBoxId: "b1",
      status: "awaiting",
    });
  });

  it("交接台全流程：离线两端改动 → 回连合并 → 保管员裁决", () => {
    const desk = deskWithRegistrations();
    desk.setConnection("offline");
    desk.setActiveNode("field");
    desk.moveArtifact("a06", "bx4"); // 玉璧：现场端换到空箱 ZX-04
    desk.setActiveNode("warehouse");
    desk.moveArtifact("a06", "bx2"); // 玉璧：库房端换到 ZX-02
    desk.moveArtifact("a03", "bx4"); // 陶片组：只有库房端动 → 自动合并

    desk.setConnection("online");
    let s = desk.getState();
    expect(s.conflicts).toHaveLength(1);
    expect(s.conflicts[0].artifactId).toBe("a06");
    expect(s.baseView["a06"]).toBe("bx5"); // 裁决前保持原箱
    expect(s.baseView["a03"]).toBe("bx4"); // 单边改动已合并

    desk.resolveConflict(s.conflicts[0].id, "field");
    s = desk.getState();
    expect(s.baseView["a06"]).toBe("bx4"); // 采用现场版
    expect(s.conflicts[0].status).toBe("resolved");
    expect(s.conflicts[0].resolution?.chosen).toBe("field");
  });

  it("放不进目标箱的离线改动被拒并留痕", () => {
    const desk = deskWithRegistrations();
    desk.setConnection("offline");
    desk.setActiveNode("field");
    desk.moveArtifact("a08", "bx3"); // 漆耳杯Ⅴ级 → ZX-03 只有Ⅱ级防护
    const s = desk.getState();
    expect(s.nodeViews.field["a08"]).toBe("bx2"); // 保持原箱
    expect(s.pendingOps.field).toHaveLength(0);
    expect(s.events.some((e) => e.message.includes("移箱被拒"))).toBe(true);
  });
});
