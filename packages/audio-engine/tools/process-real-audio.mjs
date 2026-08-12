#!/usr/bin/env node
/**
 * 実音源(Wikimedia Commons等の公開音源)を加工し、Kairosの各テーマ用素材として書き出す。
 *
 * **これは「もう一度実行するための本番スクリプト」ではなく、rev.3で実際に行った加工の記録**。
 * 入力(RAW_DIR)は当時のセッションの scratchpad にダウンロードした OGG/WAV で、リポジトリには
 * 含まれていない。再実行したい場合は `KAIROS_RAW_AUDIO_DIR` 環境変数で入力ディレクトリを指定し、
 * 同名ファイルを docs/ASSET_LICENSES.md 記載の URL から取得し直すこと。
 * 出所・ライセンスは docs/ASSET_LICENSES.md に記録済み。
 * `node-web-audio-api` の decodeAudioData で実デコードし、Web Audio と同じ結果を得る。
 *
 * 処理内容:
 *  - texture(自然音): 任意区間を切り出し、モノラル化、等パワーでループ境界をなじませる
 *  - cell/cue(打楽器・ベル系): 簡易オンセット検出でアタックを見つけ、減衰を含めて切り出し、
 *    モノラル化・フェードアウト・ピーク正規化する
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../../apps/web/public");
const RAW_DIR =
  process.env.KAIROS_RAW_AUDIO_DIR ??
  "C:/Users/beco/AppData/Local/Temp/claude/c--Users-beco-code-workspace-Kairos/5a32ae1c-6125-4f49-8065-f52d1d3cbc47/scratchpad/raw-audio";
const SAMPLE_RATE = 44100;

// --- decode ---
const decodeCache = new Map();
async function decode(filename) {
  if (decodeCache.has(filename)) return decodeCache.get(filename);
  const buf = await readFile(path.join(RAW_DIR, filename));
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  const audioBuffer = await ctx.decodeAudioData(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  decodeCache.set(filename, audioBuffer);
  return audioBuffer;
}

/** ステレオ/モノを問わずモノラル Float32Array に落とす。Texture層はモノラル(メモリ制約、CLAUDE.md)。 */
function toMono(audioBuffer) {
  const n = audioBuffer.length;
  const out = new Float32Array(n);
  const chCount = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < chCount; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < n; i++) out[i] += data[i] / chCount;
  }
  return out;
}

function slice(samples, startSec, endSec, sampleRate = SAMPLE_RATE) {
  const start = Math.max(0, Math.round(startSec * sampleRate));
  const end = Math.min(samples.length, Math.round(endSec * sampleRate));
  return samples.slice(start, end);
}

function scale(samples, gain) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

function peakNormalize(samples, targetPeak) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return samples;
  return scale(samples, targetPeak / peak);
}

function fadeInOut(samples, sampleRate, fadeInSec, fadeOutSec) {
  const out = samples.slice();
  const nIn = Math.round(fadeInSec * sampleRate);
  const nOut = Math.round(fadeOutSec * sampleRate);
  for (let i = 0; i < nIn && i < out.length; i++) out[i] *= i / nIn;
  for (let i = 0; i < nOut && i < out.length; i++) {
    const idx = out.length - 1 - i;
    out[idx] *= i / nOut;
  }
  return out;
}

/** 先頭・末尾を等パワーで馴染ませ、ループ境界のクリック無しで繋げるようにする(generate-placeholder-audio.mjsと同じ手法)。 */
function loopifyEqualPower(samples, sampleRate, crossfadeSec) {
  const crossN = Math.round(crossfadeSec * sampleRate);
  const out = samples.slice();
  for (let i = 0; i < crossN; i++) {
    const x = i / crossN;
    const fadeIn = Math.sin((x * Math.PI) / 2);
    const fadeOut = Math.cos((x * Math.PI) / 2);
    const tailIdx = samples.length - crossN + i;
    out[i] = samples[i] * fadeIn + samples[tailIdx] * fadeOut;
    out[tailIdx] = out[i];
  }
  return out;
}

/**
 * RMS包絡線からしきい値を最初に超えた位置(サンプル)を返す。ワンショットのオンセット検出用の簡易実装。
 *
 * しきい値は `offset 直後の searchWindowSec 秒だけ` を見て決める。曲全体でピークを取ると、
 * 探索窓の外にある一番大きな一発（例: 曲中の別の打撃）に引っ張られて、どの offset から
 * 探しても同じ絶対位置に収束してしまう不具合があった（実際に発生: 複数 offset が同一の
 * オンセットに収束し、同一波形のファイルを複数生成してしまった）。
 */
function findOnset(samples, sampleRate, thresholdRatio = 0.3, windowSec = 0.01, searchWindowSec = 1.5) {
  const searchLen = Math.min(samples.length, Math.round(searchWindowSec * sampleRate));
  const win = Math.max(1, Math.round(windowSec * sampleRate));
  let peak = 0;
  for (let i = 0; i < searchLen; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const threshold = peak * thresholdRatio;
  for (let i = 0; i < searchLen; i += win) {
    let sum = 0;
    const end = Math.min(searchLen, i + win);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / (end - i));
    if (rms >= threshold) return Math.max(0, i - win); // 少し手前から取り、アタックの立ち上がりを残す
  }
  return 0;
}

async function saveWav(relativePath, samples, sampleRate = SAMPLE_RATE) {
  const fullPath = path.join(PUBLIC_DIR, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  const buffer = writeWavBuffer(samples, sampleRate);
  await writeFile(fullPath, buffer);
  console.log(`  wrote ${relativePath} (${(samples.length / sampleRate).toFixed(2)}s)`);
}

function writeWavBuffer(samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

/** テクスチャ(自然音)を切り出してループ化する。 */
async function makeTexture(filename, startSec, durationSec, targetPeak = 0.35) {
  const audioBuffer = await decode(filename);
  const mono = toMono(audioBuffer);
  const cut = slice(mono, startSec, startSec + durationSec, audioBuffer.sampleRate);
  const normalized = peakNormalize(cut, targetPeak);
  return loopifyEqualPower(normalized, audioBuffer.sampleRate, Math.min(1.5, durationSec * 0.08));
}

/** ワンショット(ベル/打楽器)をオンセットから切り出す。thresholdRatio は減衰の緩やかな素材(鈴の余韻など)向けに下げられる。 */
async function makeOneShot(filename, offsetSec, durationSec, targetPeak = 0.7, thresholdRatio = 0.3) {
  const audioBuffer = await decode(filename);
  const mono = toMono(audioBuffer);
  const searchStart = slice(mono, offsetSec, mono.length / audioBuffer.sampleRate, audioBuffer.sampleRate);
  const onsetLocal = findOnset(searchStart, audioBuffer.sampleRate, thresholdRatio);
  const onsetGlobalSec = offsetSec + onsetLocal / audioBuffer.sampleRate;
  const cut = slice(mono, onsetGlobalSec, onsetGlobalSec + durationSec, audioBuffer.sampleRate);
  const faded = fadeInOut(cut, audioBuffer.sampleRate, 0.005, Math.min(0.3, durationSec * 0.15));
  return peakNormalize(faded, targetPeak);
}

/** 無音でないことを検証する(オンセット検出の失敗を検知するため)。 */
function assertNotSilent(label, samples, minPeak = 0.05) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < minPeak) {
    throw new Error(`${label}: ほぼ無音(peak=${peak.toFixed(4)})。オフセットが音の無い区間を指している可能性が高い。`);
  }
}

const seenDigests = new Map(); // 先頭200サンプルの単純なハッシュ -> ファイル名。誤って同一オンセットに収束していないか検出する。
function digestOf(samples) {
  let h = 0;
  for (let i = 0; i < Math.min(200, samples.length); i++) h = (h * 31 + Math.round(samples[i] * 1e6)) | 0;
  return h;
}

async function saveOneShot(relativePath, filename, offsetSec, durationSec, targetPeak = 0.7, thresholdRatio = 0.3) {
  const samples = await makeOneShot(filename, offsetSec, durationSec, targetPeak, thresholdRatio);
  assertNotSilent(relativePath, samples);
  const digest = digestOf(samples);
  const prior = seenDigests.get(digest);
  if (prior) {
    throw new Error(`${relativePath} が ${prior} と同一波形になった（オンセット検出が同じ位置に収束した疑い）。offsetSec を見直すこと。`);
  }
  seenDigests.set(digest, relativePath);
  await saveWav(relativePath, samples);
}

// --- 実行 ---
// 各実音源の実際の音がある区間(packages/audio-engine/tools/inspect-envelope.mjs で確認済み)。
// 6種の実音源から21個すべてに重複なくオンセットを割り当てる(在庫と割り当ての対応):
//   bienenkorbglocke.ogg   (単発, ~0.6sのみ有効)         -> cue soft_chime                    (1個)
//   japanese_rin.ogg       (単発, 3.2s〜7.5sの減衰を分割) -> Study×2, Sleep×3                  (5個)
//   old_school_bell_1.ogg  (連続打撃, 0.3〜15s)           -> cue resolve, Study×2, Work×3       (6個)
//   spielwiese_glocken.ogg (連続演奏, 0〜6s)              -> Work×1, Relax×3                    (4個)
//   kalimba.ogg            (複数音符, 2.2〜9s)            -> Move×4                             (4個)
//   bristol_chimes.ogg     (単発, 0sのみ有効)             -> Relax×1                            (1個)
async function main() {
  console.log("=== Texture (自然音) ===");
  await saveWav("audio/relax/texture_rain.wav", await makeTexture("rain_against_window.ogg", 8, 24));
  await saveWav("audio/relax/texture_waves.wav", await makeTexture("waves_lake_ontario.ogg", 30, 24));

  console.log("=== Cue (全テーマ共通) ===");
  await saveOneShot("audio/cues/soft_chime.wav", "bienenkorbglocke.ogg", 0.6, 2.0, 0.7);
  await saveOneShot("audio/cues/resolve.wav", "old_school_bell_1.ogg", 0.3, 2.6, 0.7);

  console.log("=== Study cell (aeolian, 落ち着いたベル/鈴) ===");
  await saveOneShot("audio/study/cell_a3.wav", "old_school_bell_1.ogg", 3, 2.2);
  await saveOneShot("audio/study/cell_c4.wav", "japanese_rin.ogg", 3.2, 2.3);
  await saveOneShot("audio/study/cell_e4.wav", "japanese_rin.ogg", 4.5, 2.3, 0.7, 0.15);
  await saveOneShot("audio/study/cell_g4.wav", "old_school_bell_1.ogg", 6, 2.0);

  console.log("=== Work cell (dorian, 学校鐘+グロッケン) ===");
  await saveOneShot("audio/work/cell_a3.wav", "old_school_bell_1.ogg", 9, 2);
  await saveOneShot("audio/work/cell_b3.wav", "old_school_bell_1.ogg", 12, 2);
  await saveOneShot("audio/work/cell_c4.wav", "old_school_bell_1.ogg", 15, 2);
  await saveOneShot("audio/work/cell_e4.wav", "spielwiese_glocken.ogg", 0, 1.5);

  console.log("=== Move cell (major pentatonic, カリンバ) ===");
  await saveOneShot("audio/move/cell_e4.wav", "kalimba.ogg", 2.2, 1.1, 0.75);
  await saveOneShot("audio/move/cell_gs4.wav", "kalimba.ogg", 4, 1.1, 0.75);
  await saveOneShot("audio/move/cell_b4.wav", "kalimba.ogg", 7, 1.1, 0.75);
  await saveOneShot("audio/move/cell_cs5.wav", "kalimba.ogg", 9, 1.1, 0.75);

  console.log("=== Relax cell (lydian, グロッケン/チャイム) ===");
  await saveOneShot("audio/relax/cell_d4.wav", "spielwiese_glocken.ogg", 2, 1.5);
  await saveOneShot("audio/relax/cell_fs4.wav", "spielwiese_glocken.ogg", 4, 1.5);
  await saveOneShot("audio/relax/cell_a4.wav", "spielwiese_glocken.ogg", 6, 1.5);
  await saveOneShot("audio/relax/cell_cs5.wav", "bristol_chimes.ogg", 0, 1.8);

  console.log("=== Sleep cell (aeolian低音域, 深く柔らかい余韻) ===");
  await saveOneShot("audio/sleep/cell_d3.wav", "japanese_rin.ogg", 5.5, 3.0, 0.7, 0.15);
  await saveOneShot("audio/sleep/cell_f3.wav", "japanese_rin.ogg", 6.5, 3.0, 0.7, 0.15);
  await saveOneShot("audio/sleep/cell_a3.wav", "japanese_rin.ogg", 7.5, 2.4, 0.7, 0.15);

  console.log("\n実音源からの素材書き出しが完了しました。docs/ASSET_LICENSES.md の記録を確認すること。");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
