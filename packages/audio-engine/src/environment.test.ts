import { describe, expect, it } from "vitest";
import {
  NEUTRAL_ENVIRONMENT,
  smoothEnvironment,
  targetEnvironmentModifier,
  timeOfDayFor,
  weatherCategoryFromWmoCode,
} from "./environment";

describe("weatherCategoryFromWmoCode", () => {
  it("maps clear-sky codes", () => {
    expect(weatherCategoryFromWmoCode(0)).toBe("clear");
    expect(weatherCategoryFromWmoCode(1)).toBe("clear");
  });

  it("maps cloudy/fog codes", () => {
    expect(weatherCategoryFromWmoCode(2)).toBe("cloudy");
    expect(weatherCategoryFromWmoCode(3)).toBe("cloudy");
    expect(weatherCategoryFromWmoCode(45)).toBe("cloudy");
  });

  it("maps rain-family codes (drizzle/rain/showers/thunderstorm)", () => {
    expect(weatherCategoryFromWmoCode(51)).toBe("rain");
    expect(weatherCategoryFromWmoCode(63)).toBe("rain");
    expect(weatherCategoryFromWmoCode(80)).toBe("rain");
    expect(weatherCategoryFromWmoCode(95)).toBe("rain");
  });

  it("maps snow-family codes", () => {
    expect(weatherCategoryFromWmoCode(71)).toBe("snow");
    expect(weatherCategoryFromWmoCode(77)).toBe("snow");
    expect(weatherCategoryFromWmoCode(85)).toBe("snow");
  });
});

describe("timeOfDayFor", () => {
  const at = (hour: number, minute = 0): Date => new Date(2026, 0, 1, hour, minute);

  it("classifies morning as [5:00, 11:00)", () => {
    expect(timeOfDayFor(at(5, 0))).toBe("morning");
    expect(timeOfDayFor(at(10, 59))).toBe("morning");
  });

  it("classifies noon as [11:00, 17:00)", () => {
    expect(timeOfDayFor(at(11, 0))).toBe("noon");
    expect(timeOfDayFor(at(16, 59))).toBe("noon");
  });

  it("classifies evening as [17:00, 5:00) wrapping past midnight", () => {
    expect(timeOfDayFor(at(17, 0))).toBe("evening");
    expect(timeOfDayFor(at(23, 30))).toBe("evening");
    expect(timeOfDayFor(at(0, 30))).toBe("evening");
    expect(timeOfDayFor(at(4, 59))).toBe("evening");
  });
});

describe("targetEnvironmentModifier", () => {
  it("is exactly neutral at noon, cloudy weather, zero elapsed time", () => {
    const modifier = targetEnvironmentModifier({ weather: "cloudy", timeOfDay: "noon", sessionElapsedSec: 0 });
    expect(modifier).toEqual(NEUTRAL_ENVIRONMENT);
  });

  it("treats missing weather (null) the same as cloudy", () => {
    const withNull = targetEnvironmentModifier({ weather: null, timeOfDay: "noon", sessionElapsedSec: 0 });
    const withCloudy = targetEnvironmentModifier({ weather: "cloudy", timeOfDay: "noon", sessionElapsedSec: 0 });
    expect(withNull).toEqual(withCloudy);
  });

  it("only activates the rain overlay layer for rain weather", () => {
    expect(targetEnvironmentModifier({ weather: "clear", timeOfDay: "noon", sessionElapsedSec: 0 }).rainOverlayGain).toBe(0);
    expect(targetEnvironmentModifier({ weather: "rain", timeOfDay: "noon", sessionElapsedSec: 0 }).rainOverlayGain).toBeGreaterThan(0);
  });

  it("darkens (lowers lowPassFactor) for snow more than for rain", () => {
    const rain = targetEnvironmentModifier({ weather: "rain", timeOfDay: "noon", sessionElapsedSec: 0 });
    const snow = targetEnvironmentModifier({ weather: "snow", timeOfDay: "noon", sessionElapsedSec: 0 });
    expect(snow.lowPassFactor).toBeLessThan(rain.lowPassFactor);
  });

  it("gradually reduces pulse/cellDensity as elapsed session time grows, never dropping below the clamp floor", () => {
    const early = targetEnvironmentModifier({ weather: "cloudy", timeOfDay: "noon", sessionElapsedSec: 0 });
    const mid = targetEnvironmentModifier({ weather: "cloudy", timeOfDay: "noon", sessionElapsedSec: 90 * 60 });
    const late = targetEnvironmentModifier({ weather: "cloudy", timeOfDay: "noon", sessionElapsedSec: 10 * 60 * 60 });
    expect(early.pulseGain).toBe(1);
    expect(mid.pulseGain).toBeLessThan(early.pulseGain);
    expect(late.pulseGain).toBeLessThan(mid.pulseGain);
    expect(late.pulseGain).toBeGreaterThanOrEqual(0.7); // clampModifier の下限
  });

  it("never pushes any factor outside the documented safety clamp, even in the worst-case combination", () => {
    const worst = targetEnvironmentModifier({ weather: "snow", timeOfDay: "evening", sessionElapsedSec: 100 * 60 * 60 });
    expect(worst.padGain).toBeGreaterThanOrEqual(0.85);
    expect(worst.padGain).toBeLessThanOrEqual(1.15);
    expect(worst.pulseGain).toBeGreaterThanOrEqual(0.75);
    expect(worst.cellDensityFactor).toBeGreaterThanOrEqual(0.7);
    expect(worst.lowPassFactor).toBeGreaterThanOrEqual(0.65);
    expect(worst.reverbWetDelta).toBeLessThanOrEqual(0.08);
    expect(worst.rainOverlayGain).toBeLessThanOrEqual(0.2);
  });
});

describe("smoothEnvironment", () => {
  const target = { ...NEUTRAL_ENVIRONMENT, lowPassFactor: 1.2, reverbWetDelta: 0.05 };

  it("does not move when dtSec is 0", () => {
    const result = smoothEnvironment(NEUTRAL_ENVIRONMENT, target, 0);
    expect(result).toEqual(NEUTRAL_ENVIRONMENT);
  });

  it("moves partway toward the target for a small dt, never overshooting", () => {
    const result = smoothEnvironment(NEUTRAL_ENVIRONMENT, target, 10, 90);
    expect(result.lowPassFactor).toBeGreaterThan(1);
    expect(result.lowPassFactor).toBeLessThan(1.2);
    expect(result.reverbWetDelta).toBeGreaterThan(0);
    expect(result.reverbWetDelta).toBeLessThan(0.05);
  });

  it("converges arbitrarily close to the target given enough elapsed time", () => {
    const result = smoothEnvironment(NEUTRAL_ENVIRONMENT, target, 10_000, 90);
    expect(result.lowPassFactor).toBeCloseTo(1.2, 5);
    expect(result.reverbWetDelta).toBeCloseTo(0.05, 5);
  });
});
