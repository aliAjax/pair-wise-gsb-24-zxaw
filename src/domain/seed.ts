import type { DeskSeed } from "./desk";

/**
 * 示例数据： hxwl-10 遗址一批出土物、五个周转箱、三个库位。
 * 容量故意留紧：装箱后 ZX-01 会因满柜排队；ZX-04 空箱备用，
 * 便于演示离线两端换箱冲突与库位等级调整后的补位。
 */
export const seed: DeskSeed = {
  artifacts: [
    { id: "a01", code: "HXW-T0203-001", name: "陶釜", weightGrams: 1800, fragility: 2, provenance: "T0203·③层" },
    { id: "a02", code: "HXW-T0203-002", name: "陶罐", weightGrams: 1200, fragility: 2, provenance: "T0203·③层" },
    { id: "a03", code: "HXW-T0203-003", name: "陶片组", weightGrams: 400, fragility: 3, provenance: "T0203·③层" },
    { id: "a04", code: "HXW-T0203-004", name: "铁锛", weightGrams: 1500, fragility: 2, provenance: "T0203·③层" },
    { id: "a05", code: "HXW-T0204-001", name: "骨簪", weightGrams: 60, fragility: 4, provenance: "T0204·H12" },
    { id: "a06", code: "HXW-T0204-002", name: "玉璧", weightGrams: 350, fragility: 4, provenance: "T0204·H12" },
    { id: "a07", code: "HXW-T0204-003", name: "铜镜", weightGrams: 900, fragility: 3, provenance: "T0204·H12" },
    { id: "a08", code: "HXW-T0301-001", name: "漆耳杯", weightGrams: 120, fragility: 5, provenance: "T0301·F2" },
    { id: "a09", code: "HXW-T0301-002", name: "石磨盘", weightGrams: 2400, fragility: 1, provenance: "T0301·F2" },
    { id: "a10", code: "HXW-T0301-003", name: "蚌饰", weightGrams: 30, fragility: 4, provenance: "T0301·F2" },
    { id: "a11", code: "HXW-T0301-004", name: "石柱础", weightGrams: 8000, fragility: 1, provenance: "T0301·F2" },
  ],
  boxes: [
    { id: "bx1", code: "ZX-01", level: 3, maxWeightGrams: 4000 },
    { id: "bx2", code: "ZX-02", level: 5, maxWeightGrams: 1500 },
    { id: "bx3", code: "ZX-03", level: 2, maxWeightGrams: 6000 },
    { id: "bx4", code: "ZX-04", level: 4, maxWeightGrams: 2000 },
    { id: "bx5", code: "ZX-05", level: 4, maxWeightGrams: 1800 },
  ],
  slots: [
    { id: "s1", code: "A-01", level: 5, capacityBoxes: 1, maxWeightGrams: 2000 },
    { id: "s2", code: "A-02", level: 4, capacityBoxes: 1, maxWeightGrams: 2500 },
    { id: "s3", code: "B-01", level: 2, capacityBoxes: 2, maxWeightGrams: 9000 },
  ],
};
