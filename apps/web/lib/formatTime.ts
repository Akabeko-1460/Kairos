/** mm:ss 表示。Pomodoro/Timer で使う（カウントダウンなので繰り上げ = 0になる直前まで00:01を見せる）。 */
export function formatMmSs(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** h:mm:ss 表示。Stopwatch は際限なく伸びるので、1時間を超えたら時の位も出す（カウントアップなので切り捨て）。 */
export function formatStopwatch(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
