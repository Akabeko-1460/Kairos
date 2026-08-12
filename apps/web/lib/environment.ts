"use client";

/**
 * docs/03_ARCHITECTURE.md ADR-010: 天気の取得はブラウザの Geolocation API + Open-Meteo
 * （APIキー不要の無料天気API）で行う。`packages/audio-engine` は DOM に依存しないため、
 * この「実際に外部と通信する」部分は apps/web 側の責務として分離してある。
 *
 * 失敗の扱い方針: 位置情報の許可が得られない・オフライン・API障害など、理由を問わず
 * 例外を投げずに `null` を返す。呼び出し側（soundscapeRuntime.ts）は null を
 * 「天気は中立（cloudy相当）」として扱い、時間帯・経過時間だけによる調整に自然に
 * フォールバックする。
 */
import { weatherCategoryFromWmoCode, type WeatherCategory } from "@kairos/audio-engine";

const GEOLOCATION_TIMEOUT_MS = 8000;
const FETCH_TIMEOUT_MS = 8000;
/** 位置情報自体は数kmずれても天気カテゴリの判定にはほぼ影響しないため、30分はキャッシュを許容する。 */
const GEOLOCATION_MAX_AGE_MS = 30 * 60 * 1000;

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation API is not available in this environment"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: GEOLOCATION_TIMEOUT_MS,
      maximumAge: GEOLOCATION_MAX_AGE_MS,
    });
  });
}

async function fetchWmoWeatherCode(latitude: number, longitude: number): Promise<number> {
  // 緯度経度は小数点3桁（約100m精度）に丸める。天気判定にそれ以上の精度は不要で、
  // 送信するデータをできるだけ粗くする（プライバシーへの配慮）。
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}&current=weather_code&timezone=auto`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Open-Meteo request failed with status ${res.status}`);
    const json = (await res.json()) as { current?: { weather_code?: number } };
    const code = json.current?.weather_code;
    if (typeof code !== "number") throw new Error("Open-Meteo response is missing current.weather_code");
    return code;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 現在地の天気カテゴリを取得する。位置情報の許可ダイアログをブラウザが表示するのはこの関数が
 * 呼ばれた瞬間なので、呼び出し側はユーザー操作（Start/再生ボタン）を起点に呼ぶこと
 * （docs/CLAUDE.md の自動再生ポリシー対策と同じ配慮）。
 */
export async function fetchWeatherCategory(): Promise<WeatherCategory | null> {
  try {
    const position = await getCurrentPosition();
    const code = await fetchWmoWeatherCode(position.coords.latitude, position.coords.longitude);
    return weatherCategoryFromWmoCode(code);
  } catch (err) {
    // 許可拒否・オフライン・API障害のいずれも致命的ではないので、警告だけ出して null を返す。
    console.warn("[Kairos] 天気の取得に失敗しました。時間帯のみで音を調整します。", err);
    return null;
  }
}
