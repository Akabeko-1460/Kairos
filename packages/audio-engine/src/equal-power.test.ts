import { describe, expect, it } from "vitest";
import { combinedPowerAt, equalPowerCurve, equalPowerGainAt } from "./equal-power";

describe("equalPowerCurve", () => {
  it("fade-out starts at 1 and ends at 0", () => {
    const curve = equalPowerCurve(false, 128);
    expect(curve[0]).toBeCloseTo(1, 10);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 10);
  });

  it("fade-in starts at 0 and ends at 1", () => {
    const curve = equalPowerCurve(true, 128);
    expect(curve[0]).toBeCloseTo(0, 10);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 10);
  });

  it("fade-out is monotonically non-increasing", () => {
    const curve = equalPowerCurve(false, 64);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeLessThanOrEqual(curve[i - 1]!);
    }
  });

  it("fade-in is monotonically non-decreasing", () => {
    const curve = equalPowerCurve(true, 64);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    }
  });
});

describe("Phase 0 スパイクA: 等パワークロスフェードは中間で音圧が落ちない", () => {
  // 線形クロスフェードだと x=0.5 で合成ゲインが 0.5+0.5=1.0（振幅ベース）にしかならず、
  // パワー（振幅の2乗）で見ると 0.5^2+0.5^2=0.5 まで落ち込む。これが「谷」の正体。
  // 等パワーカーブは sin^2(x)+cos^2(x)=1 の恒等式により、パワーが区間全体で厳密に一定になる。
  it("combined power (sin^2 + cos^2) stays at 1.0 across the whole crossfade, including the midpoint", () => {
    for (let i = 0; i <= 20; i++) {
      const x = i / 20;
      expect(combinedPowerAt(x)).toBeCloseTo(1, 12);
    }
  });

  it("regression check: a naive linear crossfade WOULD dip in the middle (documents why we don't use it)", () => {
    const linearPowerAt = (x: number) => {
      const out = 1 - x;
      const inn = x;
      return out * out + inn * inn;
    };
    expect(linearPowerAt(0.5)).toBeCloseTo(0.5, 10); // 谷: 1.0 に対して -3dB 相当落ち込む
    expect(linearPowerAt(0)).toBeCloseTo(1, 10);
    expect(linearPowerAt(1)).toBeCloseTo(1, 10);
  });

  it("neither fade-out nor fade-in gain ever exceeds [0, 1] (no clipping headroom issue)", () => {
    for (let i = 0; i <= 50; i++) {
      const x = i / 50;
      expect(equalPowerGainAt(x, true)).toBeGreaterThanOrEqual(0);
      expect(equalPowerGainAt(x, true)).toBeLessThanOrEqual(1);
      expect(equalPowerGainAt(x, false)).toBeGreaterThanOrEqual(0);
      expect(equalPowerGainAt(x, false)).toBeLessThanOrEqual(1);
    }
  });
});
