#!/usr/bin/env node
/**
 * Phase 0-6（docs/05_IMPLEMENTATION_PLAN.md）: 仮素材の生成スクリプト。
 *
 * ここで作るのは AI 生成の本番素材ではなく、単純な合成音（サイン波・ノイズ）による
 * プレースホルダー。目的はエンジンの配線・クロスフェード・ループ・確率的スケジューリングを
 * 実際の音で検証できるようにすること。ライセンス確認が不要で即座に用意できる（決定済み事項）。
 *
 * 本番のAI生成ステムに差し替える際は docs/04_SOUND_ENGINE.md §7 の手順に従い、
 * OGG Vorbis で書き出して docs/ASSET_LICENSES.md に記録すること。
 *
 * 出力は WAV（16bit PCM）。ffmpeg 等の外部エンコーダに依存しないための選択で、
 * decodeAudioData は WAV でも問題なく扱える。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../apps/web/public");
const SAMPLE_RATE = 44100;

// --- 決定的PRNG（packages/audio-engine/src/prng.ts と同じ mulberry32） ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- WAV書き出し ---
function writeWavBuffer(samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

async function saveWav(relativePath, samples, sampleRate = SAMPLE_RATE) {
  const fullPath = path.join(PUBLIC_DIR, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, writeWavBuffer(samples, sampleRate));
  console.log(`  wrote ${relativePath} (${(samples.length / sampleRate).toFixed(2)}s)`);
}

// --- DSPユーティリティ ---

/** 指定した長さ(秒)にちょうど整数周期おさまる周波数へスナップする。ループ境界のクリックを防ぐ。 */
function seamlessFreq(desiredHz, loopSeconds) {
  const cycles = Math.max(1, Math.round(desiredHz * loopSeconds));
  return cycles / loopSeconds;
}

function silence(seconds, sampleRate = SAMPLE_RATE) {
  return new Float32Array(Math.round(seconds * sampleRate));
}

function whiteNoise(rng, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Paul Kellet の経済版ピンクノイズフィルタ。 */
function pinkNoise(rng, n) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    out[i] = pink * 0.11;
  }
  return out;
}

/** 単純な一次ローパス(RC)フィルタ。room_hum / waves の質感づけに使う。 */
function onePoleLowpass(samples, sampleRate, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  const out = new Float32Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    prev = prev + alpha * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

function sine(freqHz, seconds, sampleRate = SAMPLE_RATE, phase = 0) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin(2 * Math.PI * freqHz * (i / sampleRate) + phase);
  }
  return out;
}

function multiply(a, b) {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
  return out;
}

function add(...arrays) {
  const n = Math.max(...arrays.map((a) => a.length));
  const out = new Float32Array(n);
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) out[i] += a[i];
  }
  return out;
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

function exponentialDecayEnvelope(seconds, sampleRate, decayRate) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.exp(-decayRate * (i / sampleRate));
  }
  return out;
}

/** 先頭・末尾を等パワーで馴染ませ、ノイズ系素材をループ境界のクリック無しで繋げるようにする。 */
function loopifyEqualPower(samples, sampleRate, crossfadeSec) {
  const crossN = Math.round(crossfadeSec * sampleRate);
  const out = samples.slice();
  for (let i = 0; i < crossN; i++) {
    const x = i / crossN;
    const fadeIn = Math.sin((x * Math.PI) / 2);
    const fadeOut = Math.cos((x * Math.PI) / 2);
    const tailIdx = samples.length - crossN + i;
    out[i] = samples[i] * fadeIn + samples[tailIdx] * fadeOut;
    out[tailIdx] = out[i]; // 境界の両側を同じ値にして継ぎ目を完全に一致させる
  }
  return out;
}

function fadeInOut(samples, sampleRate, fadeSec) {
  const n = Math.round(fadeSec * sampleRate);
  const out = samples.slice();
  for (let i = 0; i < n && i < out.length; i++) {
    const g = i / n;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

// --- 音名 -> 周波数 (A4=440Hz, 12平均律) ---
const SEMITONE_FROM_A = { c: -9, "c#": -8, d: -7, "d#": -6, e: -5, f: -4, "f#": -3, g: -2, "g#": -1, a: 0, "a#": 1, b: 2 };
function noteFreq(name) {
  const m = /^([a-g]#?)(\d)$/i.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  const [, letter, octaveStr] = m;
  const octave = Number(octaveStr);
  const semitone = SEMITONE_FROM_A[letter.toLowerCase()];
  return 440 * 2 ** ((semitone + (octave - 4) * 12) / 12);
}

// --- 素材生成 ---

function generatePad(rootNote, chordIntervals, loopSeconds, seed) {
  const rng = mulberry32(seed);
  const root = noteFreq(rootNote);
  const partials = chordIntervals.map((semi, idx) => {
    const freq = seamlessFreq(root * 2 ** (semi / 12), loopSeconds);
    const detune = 1 + (rng() - 0.5) * 0.003; // 微小デチューンで厚みを出す
    return scale(sine(freq * detune, loopSeconds), 1 / (idx + 1.4));
  });
  const breathHz = 1 / loopSeconds; // ループ全体で1呼吸
  const breath = add(scale(sine(breathHz, loopSeconds), 0.15), silence(loopSeconds).fill(0.85));
  let out = multiply(add(...partials), breath);
  out = peakNormalize(out, 0.5);
  return loopifyEqualPower(out, SAMPLE_RATE, Math.min(2, loopSeconds * 0.1));
}

function generateTexture(kind, loopSeconds, seed) {
  const rng = mulberry32(seed);
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  let raw;
  if (kind === "pink") {
    raw = pinkNoise(rng, n);
  } else if (kind === "hum") {
    raw = onePoleLowpass(whiteNoise(rng, n), SAMPLE_RATE, 400);
  } else if (kind === "rain") {
    const base = pinkNoise(rng, n);
    // ランダムな微小クリック（葉に当たる粒立ち）を薄く重ねる
    const drops = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (rng() < 0.002) drops[i] = (rng() * 2 - 1) * 0.6;
    }
    raw = add(scale(base, 0.6), onePoleLowpass(drops, SAMPLE_RATE, 3000));
  } else {
    // waves: ゆっくりしたAM変調をかけたローパスノイズ
    const noise = onePoleLowpass(whiteNoise(rng, n), SAMPLE_RATE, 800);
    const lfo = add(scale(sine(seamlessFreq(0.1, loopSeconds), loopSeconds), 0.5), silence(loopSeconds).fill(0.5));
    raw = multiply(noise, lfo);
  }
  const normalized = peakNormalize(raw, 0.35);
  return loopifyEqualPower(normalized, SAMPLE_RATE, Math.min(1.5, loopSeconds * 0.1));
}

function generatePulse(bpm, beats, seed) {
  const rng = mulberry32(seed);
  const loopSeconds = (beats * 60) / bpm;
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const beatSamples = Math.round((60 / bpm) * SAMPLE_RATE);
  const clickLen = Math.round(0.03 * SAMPLE_RATE);
  for (let beat = 0; beat < beats; beat++) {
    const start = beat * beatSamples;
    for (let i = 0; i < clickLen && start + i < n; i++) {
      const env = Math.exp(-40 * (i / SAMPLE_RATE));
      // 低めのサイン + わずかなノイズで「ミュートされたキック」を模す
      out[start + i] += env * (Math.sin(2 * Math.PI * 80 * (i / SAMPLE_RATE)) * 0.8 + (rng() * 2 - 1) * 0.15);
    }
  }
  return peakNormalize(out, 0.6);
}

function generateOneShot(freqHz, durationSec, decayRate, seed) {
  const rng = mulberry32(seed);
  const tone = add(
    sine(freqHz, durationSec),
    scale(sine(freqHz * 2, durationSec), 0.3),
    scale(sine(freqHz * 3, durationSec), 0.12),
  );
  const shimmer = scale(whiteNoise(rng, Math.round(durationSec * SAMPLE_RATE)), 0.01);
  const env = exponentialDecayEnvelope(durationSec, SAMPLE_RATE, decayRate);
  const out = multiply(add(tone, shimmer), env);
  return peakNormalize(out, 0.7);
}

function generateCue(freqHz, durationSec, seed) {
  return generateOneShot(freqHz, durationSec, 1.8, seed);
}

function generateIR(durationSec, decayRate, seed) {
  const rng = mulberry32(seed);
  const n = Math.round(durationSec * SAMPLE_RATE);
  const noise = whiteNoise(rng, n);
  const env = exponentialDecayEnvelope(durationSec, SAMPLE_RATE, decayRate);
  const shaped = onePoleLowpass(multiply(noise, env), SAMPLE_RATE, 6000);
  return peakNormalize(fadeInOut(shaped, SAMPLE_RATE, 0.01), 0.9);
}

// --- 実行 ---
async function main() {
  console.log("Focus 層を生成中...");
  await saveWav("audio/focus/pad_a_01.wav", generatePad("a3", [0, 3, 7], 32, 101));
  await saveWav("audio/focus/pad_a_02.wav", generatePad("a3", [0, 3, 7], 32, 102));
  await saveWav("audio/focus/pad_a_03.wav", generatePad("a3", [0, 3, 10], 32, 103));
  await saveWav("audio/focus/pink_air.wav", generateTexture("pink", 20, 111));
  await saveWav("audio/focus/room_hum.wav", generateTexture("hum", 20, 112));
  await saveWav("audio/focus/pulse_66_01.wav", generatePulse(66, 8, 121));
  await saveWav("audio/focus/pulse_66_02.wav", generatePulse(66, 8, 122));
  await saveWav("audio/focus/bell_a3.wav", generateOneShot(noteFreq("a3"), 2.2, 1.1, 131));
  await saveWav("audio/focus/bell_c4.wav", generateOneShot(noteFreq("c4"), 2.2, 1.1, 132));
  await saveWav("audio/focus/bell_e4.wav", generateOneShot(noteFreq("e4"), 2.2, 1.1, 133));
  await saveWav("audio/focus/bell_g4.wav", generateOneShot(noteFreq("g4"), 2.2, 1.1, 134));

  console.log("Break 層を生成中...");
  await saveWav("audio/break/air_d_01.wav", generatePad("d4", [0, 4, 7], 30, 201));
  await saveWav("audio/break/air_d_02.wav", generatePad("d4", [0, 4, 11], 30, 202));
  await saveWav("audio/break/rain_leaves.wav", generateTexture("rain", 24, 211));
  await saveWav("audio/break/waves.wav", generateTexture("waves", 24, 212));
  await saveWav("audio/break/drop_d4.wav", generateOneShot(noteFreq("d4"), 2.6, 0.9, 221));
  await saveWav("audio/break/drop_f4.wav", generateOneShot(noteFreq("f4"), 2.6, 0.9, 222));
  await saveWav("audio/break/drop_a4.wav", generateOneShot(noteFreq("a4"), 2.6, 0.9, 223));

  console.log("Cue を生成中...");
  await saveWav("audio/cues/soft_chime.wav", generateCue(noteFreq("e5"), 1.8, 301));
  await saveWav("audio/cues/resolve.wav", generateCue(noteFreq("a4"), 2.4, 302));

  console.log("IR を生成中...");
  await saveWav("ir/room_small.wav", generateIR(1.4, 4.5, 401));
  await saveWav("ir/hall_large.wav", generateIR(3.2, 1.3, 402));

  console.log("\n仮素材の生成が完了しました（WAV, ffmpeg不要）。");
  console.log("本番差し替え時は docs/04_SOUND_ENGINE.md §7 を参照し、OGG Vorbis + docs/ASSET_LICENSES.md 記録を行うこと。");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
