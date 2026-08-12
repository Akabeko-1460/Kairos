#!/usr/bin/env node
/**
 * Phase 0-6（docs/05_IMPLEMENTATION_PLAN.md）: 仮素材の生成スクリプト。
 *
 * ここで作るのは AI 生成の本番素材ではなく、単純な合成音（サイン波・ノイズ）による
 * プレースホルダー。目的はエンジンの配線・クロスフェード・ループ・確率的スケジューリングを
 * 実際の音で検証できるようにすること。ライセンス確認が不要で即座に用意できる（決定済み事項）。
 *
 * rev.3: 5テーマ（Study/Work/Move/Relax/Sleep）を個別の音響定義として持つようになった
 * （docs/04_SOUND_ENGINE.md ADR-004）。このスクリプトもテーマごとにパラメータを分けて生成する。
 * 各テーマの設計根拠は `docs/deep-research-report_chatGPT.md` と
 * `集中力を高める音の文献調査_gemini.md` を参照（docs/04_SOUND_ENGINE.md §4 に要約を転記済み）。
 *
 * 本番のAI生成ステムに差し替える際は docs/04_SOUND_ENGINE.md §7 の手順に従い、
 * OGG Vorbis で書き出して docs/ASSET_LICENSES.md に記録すること。
 *
 * 出力は WAV（16bit PCM）。ffmpeg 等の外部エンコーダに依存しないための選択で、
 * decodeAudioData は WAV でも問題なく扱える。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
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

/** Paul Kellet の経済版ピンクノイズフィルタ（1/f、-3dB/オクターブ）。 */
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

/**
 * ブラウン(レッド)ノイズ（1/f²、-6dB/オクターブ）。白色雑音のリーキー積分で作る。
 * 集中力を高める音の文献調査_gemini.md §1.1: 「過覚醒の鎮静・深い分析的作業への没入」— Sleep テーマの主texture。
 */
function brownNoise(rng, n) {
  const out = new Float32Array(n);
  let acc = 0;
  const leak = 0.998; // 完全積分だと直流に張り付いてしまうため、わずかに漏らして中心へ戻す
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    acc = acc * leak + white * 0.02;
    out[i] = acc;
  }
  return out;
}

/** 単純な一次ローパス(RC)フィルタ。room_hum / waves / IR の質感づけに使う。 */
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

/** 単純な一次ハイパス(RC)フィルタ。air(そよ風)テクスチャの低域を軽く削って開放感を出す。 */
function onePoleHighpass(samples, sampleRate, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const out = new Float32Array(samples.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = alpha * (prevOut + samples[i] - prevIn);
    prevIn = samples[i];
    prevOut = value;
    out[i] = value;
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

/**
 * docs/03_ARCHITECTURE.md ADR-007: `bodyResonanceHz` を指定すると、その帯域を持ち上げて
 * 木質楽器/弦楽器のボディ共鳴を模した温かみを足す（Endel "Deep Work": "smooth synthesized
 * string, keyboard and wood notes" を参考に、Work テーマの Pad にのみ適用する）。
 *
 * ADR-009: `pumpBpm` を指定すると、ループ全体で1回のゆったりした「呼吸」の代わりに、
 * 拍ごとに短くダッキングして持ち上がる「サイドチェイン風」のエンベロープを使う
 * （Move テーマ専用。和音の土台そのものを運動のリズムに同調させ、他テーマの
 * 「ゆっくり漂う」Pad とは根本的に性格を変える）。`loopSeconds` は `pumpBpm` の拍の
 * 整数倍にすること（そうしないとループ境界でエンベロープが不連続になる）。
 *
 * @param {string} rootNote
 * @param {number[]} chordIntervals
 * @param {number} loopSeconds
 * @param {number} seed
 * @param {{bodyResonanceHz?: number, bodyResonanceGain?: number, pumpBpm?: number, pumpDecayK?: number, pumpFloor?: number}} [opts]
 */
function generatePad(rootNote, chordIntervals, loopSeconds, seed, opts = {}) {
  const { bodyResonanceHz = null, bodyResonanceGain = 0, pumpBpm = null, pumpDecayK = 7, pumpFloor = 0.4 } = opts;
  const rng = mulberry32(seed);
  const root = noteFreq(rootNote);
  const partials = chordIntervals.map((semi, idx) => {
    const freq = seamlessFreq(root * 2 ** (semi / 12), loopSeconds);
    const detune = 1 + (rng() - 0.5) * 0.003; // 微小デチューンで厚みを出す
    return scale(sine(freq * detune, loopSeconds), 1 / (idx + 1.4));
  });
  let breath;
  if (pumpBpm) {
    const beatSec = 60 / pumpBpm;
    const n = Math.round(loopSeconds * SAMPLE_RATE);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const tInBeat = (i / SAMPLE_RATE) % beatSec;
      env[i] = pumpFloor + (1 - pumpFloor) * Math.exp(-pumpDecayK * tInBeat);
    }
    breath = env;
  } else {
    const breathHz = 1 / loopSeconds; // ループ全体で1呼吸
    breath = add(scale(sine(breathHz, loopSeconds), 0.15), silence(loopSeconds).fill(0.85));
  }
  let out = multiply(add(...partials), breath);
  if (bodyResonanceHz && bodyResonanceGain > 0) {
    const band = onePoleLowpass(onePoleHighpass(out, SAMPLE_RATE, bodyResonanceHz * 0.6), SAMPLE_RATE, bodyResonanceHz * 1.8);
    out = add(out, scale(band, bodyResonanceGain));
  }
  out = peakNormalize(out, 0.5);
  // pumpBpm 使用時は数秒がかりの等パワークロスフェードをかけない: エンベロープはループ境界でも
  // 拍ごとの立ち上がりと同じ形で自然に繋がる（loopSeconds は拍の整数倍にしてあるため）一方、
  // 長いクロスフェードで頭と尾を混ぜると、ポンピングの位相がずれた状態で二重に聞こえてしまう。
  // 波形連続性のためのごく短いクロスフェードだけに留める。
  const crossfadeSec = pumpBpm ? 0.02 : Math.min(2, loopSeconds * 0.1);
  return loopifyEqualPower(out, SAMPLE_RATE, crossfadeSec);
}

/**
 * @param {string} kind
 * @param {number} loopSeconds
 * @param {number} seed
 * @param {{warmLowpassHz?: number}} [opts] warmLowpassHz: 生成後にさらにローパスして
 *   高域のシャリつきを削り、暖かい印象にする（Study のピンクノイズに使用）。
 */
function generateTexture(kind, loopSeconds, seed, opts = {}) {
  const { warmLowpassHz = null } = opts;
  const rng = mulberry32(seed);
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  let raw;
  if (kind === "pink") {
    raw = pinkNoise(rng, n);
  } else if (kind === "brown") {
    // Sleep テーマの主texture。ピンクよりさらに高域が落ちる(1/f²)ため、追加でローパスして深みを出す。
    raw = onePoleLowpass(brownNoise(rng, n), SAMPLE_RATE, 500);
  } else if (kind === "room") {
    // Work テーマの主texture（旧 hum を置き換え。ADR-007）。
    // オフィスの空調ハムというより「木質の部屋に包まれる」質感を狙い、
    // 白色雑音を250–2200Hzの帯域に絞って暖かさを出す（Endel "Deep Work": immersive background harmony）。
    raw = onePoleLowpass(onePoleHighpass(whiteNoise(rng, n), SAMPLE_RATE, 250), SAMPLE_RATE, 2200);
  } else if (kind === "air") {
    // Move テーマの軽いtexture。マスキングより開放感を優先し、ハイパスで低域を削る。
    const noise = onePoleLowpass(whiteNoise(rng, n), SAMPLE_RATE, 5000);
    raw = onePoleHighpass(noise, SAMPLE_RATE, 300);
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
  let normalized = peakNormalize(raw, 0.35);
  if (warmLowpassHz) normalized = onePoleLowpass(normalized, SAMPLE_RATE, warmLowpassHz);
  return loopifyEqualPower(normalized, SAMPLE_RATE, Math.min(1.5, loopSeconds * 0.1));
}

/**
 * docs/03_ARCHITECTURE.md ADR-006: 「ドラムのキック音で人の活動に合わせたリズムを作る」の実装。
 * キックはピッチが急速に下降する膜鳴楽器的な音（実際のキックドラムの物理特性に近い）にし、
 * 単なるクリック音より音楽的な質感を持たせる。ハイハットは拍の裏（オフビート）に薄く添えて
 * 活動のリズム感を強めるが、Study のような複雑思考向けテーマには使わない
 * （文献: "work flow" music は low rhythmic complexity が特徴、Georgetown大学の研究）。
 *
 * @param {number} bpm
 * @param {number} beats
 * @param {number} seed
 * @param {{
 *   toneStartHz?: number, toneEndHz?: number, pitchDropRate?: number,
 *   toneGain?: number, noiseGain?: number, decayK?: number, clickSec?: number,
 *   hatGain?: number, hatDecayK?: number, hatHighpassHz?: number, hatOffsetBeat?: number,
 * }} [opts]
 */
function generatePulse(bpm, beats, seed, opts = {}) {
  const {
    toneStartHz = 150,
    toneEndHz = 60,
    pitchDropRate = 32,
    toneGain = 0.8,
    noiseGain = 0.15,
    decayK = 42,
    clickSec = 0.05,
    hatGain = 0,
    hatDecayK = 100,
    hatHighpassHz = 7000,
    hatOffsetBeat = 0.5,
  } = opts;
  const rng = mulberry32(seed);
  const loopSeconds = (beats * 60) / bpm;
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const beatSamples = Math.round((60 / bpm) * SAMPLE_RATE);
  const clickLen = Math.round(clickSec * SAMPLE_RATE);

  // キック: 位相を毎サンプル積分し、周波数を toneStartHz から toneEndHz へ指数的に落とす
  // （固定周波数のサイン波よりも実際のキックドラムに近い「ドスン」という質感になる）。
  for (let beat = 0; beat < beats; beat++) {
    const start = beat * beatSamples;
    let phase = 0;
    for (let i = 0; i < clickLen && start + i < n; i++) {
      const t = i / SAMPLE_RATE;
      const freq = toneEndHz + (toneStartHz - toneEndHz) * Math.exp(-pitchDropRate * t);
      phase += (2 * Math.PI * freq) / SAMPLE_RATE;
      const env = Math.exp(-decayK * t);
      out[start + i] += env * (Math.sin(phase) * toneGain + (rng() * 2 - 1) * noiseGain);
    }
  }

  // ハイハット(オフビート)。Work/Move のみ hatGain > 0 を渡して有効化する。
  if (hatGain > 0) {
    const hatLen = Math.round(0.06 * SAMPLE_RATE);
    const hatRaw = new Float32Array(n);
    for (let beat = 0; beat < beats; beat++) {
      const start = Math.round((beat + hatOffsetBeat) * beatSamples);
      for (let i = 0; i < hatLen && start + i < n; i++) {
        const env = Math.exp(-hatDecayK * (i / SAMPLE_RATE));
        hatRaw[start + i] += env * (rng() * 2 - 1);
      }
    }
    const hatShaped = onePoleHighpass(hatRaw, SAMPLE_RATE, hatHighpassHz);
    for (let i = 0; i < n; i++) out[i] += hatShaped[i] * hatGain;
  }

  return peakNormalize(out, 0.6);
}

/**
 * docs/03_ARCHITECTURE.md ADR-009: Work テーマ専用。`generatePulse` のキック+ハイハットに、
 * 短い旋律動機（コンピングのような1〜3音のフレーズ）を重ねた「グルーヴ」を作る。
 * Endel "Deep Work" の "smooth ... string, keyboard and wood notes" を、リズムだけでなく
 * 旋律の断片としても表現するための拡張。Study（拍を持たない）・Move（実際のドラムパターン）
 * とはっきり性格を分けるための中間的な存在＝「拍はあるが、音楽的な一節も乗る」。
 *
 * @param {number} bpm
 * @param {number} beats
 * @param {number} seed
 * @param {{kickOpts?: object, melody?: {rootNote: string, semitonePattern: (number|null)[], noteSec?: number, decayRate?: number, partialGains?: number[], shimmerGain?: number, gain?: number}}} [opts]
 */
function generateGroovePulse(bpm, beats, seed, opts = {}) {
  const { kickOpts = {}, melody = null } = opts;
  const percussion = generatePulse(bpm, beats, seed, kickOpts);
  if (!melody) return percussion;

  const {
    rootNote,
    semitonePattern,
    noteSec = 0.5,
    decayRate = 3.2,
    partialGains = [1, 0.4, 0.15],
    shimmerGain = 0.008,
    gain = 0.22,
  } = melody;
  const rng = mulberry32(seed + 1);
  const root = noteFreq(rootNote);
  const loopSeconds = (beats * 60) / bpm;
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  const beatSamples = Math.round((60 / bpm) * SAMPLE_RATE);
  const melodyTrack = new Float32Array(n);
  for (let beat = 0; beat < beats; beat++) {
    const semi = semitonePattern[beat % semitonePattern.length];
    if (semi === null || semi === undefined) continue; // 休符
    const freq = root * 2 ** (semi / 12);
    const detune = 1 + (rng() - 0.5) * 0.006;
    const tone = add(...partialGains.map((g, idx) => scale(sine(freq * detune * (idx + 1), noteSec), g)));
    const shimmer = scale(whiteNoise(rng, Math.round(noteSec * SAMPLE_RATE)), shimmerGain);
    const env = exponentialDecayEnvelope(noteSec, SAMPLE_RATE, decayRate);
    const note = multiply(add(tone, shimmer), env);
    const start = beat * beatSamples;
    for (let i = 0; i < note.length && start + i < n; i++) melodyTrack[start + i] += note[i];
  }
  const mixed = add(percussion.slice(0, n), scale(peakNormalize(melodyTrack, 1), gain));
  return peakNormalize(mixed, 0.62);
}

/**
 * docs/03_ARCHITECTURE.md ADR-009: Move テーマ専用。キック+スネア(クラップ)+ハイハットの
 * 実際のドラムパターンを合成する。Study/Work の「装飾的なキック+ハイハット」より
 * 明確に「曲のビート」として聞こえることを狙い、運動のケイデンスに同調する用途に合わせた。
 *
 * @param {number} bpm
 * @param {number} beats loop 内の拍数（16分刻みではなく1拍=1ステップ単位）
 * @param {number} seed
 * @param {{
 *   kickOpts?: object,
 *   snareBeats?: number[], snareGain?: number, snareDecayK?: number, snareHighpassHz?: number,
 *   hatEvery?: number, hatGain?: number, hatDecayK?: number, hatHighpassHz?: number,
 * }} [opts]
 */
function generateWorkoutGroove(bpm, beats, seed, opts = {}) {
  const {
    kickOpts = {},
    snareBeats = [],
    snareGain = 0.5,
    snareDecayK = 55,
    snareHighpassHz = 900,
    hatEvery = 0.5,
    hatGain = 0.15,
    hatDecayK = 130,
    hatHighpassHz = 8500,
  } = opts;
  // ハイハットは generatePulse 側では作らず（拍単位の位置指定しかできないため）、
  // ここで独自に敷き詰める。
  const kick = generatePulse(bpm, beats, seed, { ...kickOpts, hatGain: 0 });
  const rng = mulberry32(seed + 1);
  const loopSeconds = (beats * 60) / bpm;
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  const beatSamples = Math.round((60 / bpm) * SAMPLE_RATE);
  const out = kick.slice(0, n);

  if (snareBeats.length > 0) {
    const snareLen = Math.round(0.12 * SAMPLE_RATE);
    const raw = new Float32Array(n);
    for (const beat of snareBeats) {
      const start = beat * beatSamples;
      for (let i = 0; i < snareLen && start + i < n; i++) {
        raw[start + i] += Math.exp(-snareDecayK * (i / SAMPLE_RATE)) * (rng() * 2 - 1);
      }
    }
    const shaped = onePoleHighpass(raw, SAMPLE_RATE, snareHighpassHz);
    for (let i = 0; i < n; i++) out[i] += shaped[i] * snareGain;
  }

  if (hatGain > 0) {
    const hatLen = Math.round(0.05 * SAMPLE_RATE);
    const raw = new Float32Array(n);
    const stepSamples = Math.max(1, Math.round(hatEvery * beatSamples));
    for (let start = 0; start < n; start += stepSamples) {
      for (let i = 0; i < hatLen && start + i < n; i++) {
        raw[start + i] += Math.exp(-hatDecayK * (i / SAMPLE_RATE)) * (rng() * 2 - 1);
      }
    }
    const shaped = onePoleHighpass(raw, SAMPLE_RATE, hatHighpassHz);
    for (let i = 0; i < n; i++) out[i] += shaped[i] * hatGain;
  }

  return peakNormalize(out, 0.65);
}

/**
 * @param {number} freqHz
 * @param {number} durationSec
 * @param {number} decayRate
 * @param {number} seed
 * @param {{partialGains?: number[], shimmerGain?: number}} [opts]
 */
function generateOneShot(freqHz, durationSec, decayRate, seed, opts = {}) {
  const { partialGains = [1, 0.3, 0.12], shimmerGain = 0.01 } = opts;
  const rng = mulberry32(seed);
  const partials = partialGains.map((gain, idx) => scale(sine(freqHz * (idx + 1), durationSec), gain));
  const tone = add(...partials);
  const shimmer = scale(whiteNoise(rng, Math.round(durationSec * SAMPLE_RATE)), shimmerGain);
  const env = exponentialDecayEnvelope(durationSec, SAMPLE_RATE, decayRate);
  const out = multiply(add(tone, shimmer), env);
  return peakNormalize(out, 0.7);
}

/**
 * docs/03_ARCHITECTURE.md ADR-008: Relax/Sleep に「音楽性」を持たせるための柔らかい旋律パルス。
 * Study/Work/Move の打楽器的なキック（generatePulse）とは異なり、スケール内の音程を辿る
 * 短いフレーズをフェルトピアノ/マレット的な音色（generateOneShot と同じ倍音構成）で
 * 繰り返しループする。文献（deep-research-report_relux_chatGPT.md）:
 * 「反復性や予測可能性が高いリズムが安定感を高める」「60–80BPM程度の柔らかく単純な旋律」。
 *
 * @param {string} rootNote
 * @param {(number|null)[]} semitonePattern 各拍のスケール度数（rootNoteからの半音オフセット）。
 *   beats より短ければ繰り返す。null はその拍を休符にする（Sleep のように余白を持たせたい場合）。
 * @param {number} bpm
 * @param {number} beats
 * @param {number} seed
 * @param {{noteSec?: number, decayRate?: number, partialGains?: number[], shimmerGain?: number, gain?: number}} [opts]
 */
function generateArpeggioPulse(rootNote, semitonePattern, bpm, beats, seed, opts = {}) {
  const {
    noteSec = 1.6,
    decayRate = 1.4,
    partialGains = [1, 0.35, 0.12],
    shimmerGain = 0.01,
    gain = 0.55,
  } = opts;
  const rng = mulberry32(seed);
  const root = noteFreq(rootNote);
  const loopSeconds = (beats * 60) / bpm;
  const n = Math.round(loopSeconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  const beatSamples = Math.round((60 / bpm) * SAMPLE_RATE);
  for (let beat = 0; beat < beats; beat++) {
    const semi = semitonePattern[beat % semitonePattern.length];
    if (semi === null || semi === undefined) continue; // 休符
    const freq = root * 2 ** (semi / 12);
    const detune = 1 + (rng() - 0.5) * 0.006;
    const tone = add(...partialGains.map((g, idx) => scale(sine(freq * detune * (idx + 1), noteSec), g)));
    const shimmer = scale(whiteNoise(rng, Math.round(noteSec * SAMPLE_RATE)), shimmerGain);
    const env = exponentialDecayEnvelope(noteSec, SAMPLE_RATE, decayRate);
    const note = multiply(add(tone, shimmer), env);
    const start = beat * beatSamples;
    for (let i = 0; i < note.length && start + i < n; i++) out[start + i] += note[i];
  }
  const normalized = peakNormalize(out, gain);
  // 音の減衰テールがループ境界をまたぐため、通常の合成音より少し長めにクロスフェードしてなじませる。
  return loopifyEqualPower(normalized, SAMPLE_RATE, Math.min(0.5, loopSeconds * 0.08));
}

function generateCue(freqHz, durationSec, seed) {
  return generateOneShot(freqHz, durationSec, 1.8, seed);
}

function generateIR(durationSec, decayRate, seed, cutoffHz = 6000) {
  const rng = mulberry32(seed);
  const n = Math.round(durationSec * SAMPLE_RATE);
  const noise = whiteNoise(rng, n);
  const env = exponentialDecayEnvelope(durationSec, SAMPLE_RATE, decayRate);
  const shaped = onePoleLowpass(multiply(noise, env), SAMPLE_RATE, cutoffHz);
  return peakNormalize(fadeInOut(shaped, SAMPLE_RATE, 0.01), 0.9);
}

// --- 実行 ---
async function main() {
  // 旧レイアウト(focus/break)の残骸を含め、audio/ir配下を作り直す。
  await rm(path.join(PUBLIC_DIR, "audio"), { recursive: true, force: true });
  await rm(path.join(PUBLIC_DIR, "ir"), { recursive: true, force: true });

  console.log("Study 層を生成中...（A aeolian, 68bpm — 拍を持たない没入型。Pad+ピンクノイズが主役）");
  // ADR-009: Study と Work の差別化を明確にするため、Study は3テイクとも和音を少しずつ
  // 変えて（暗め二重奏 / 明るい7th / 開離配置）ドリフト時の変化にわずかな表情を持たせつつ、
  // 全体としては「静かな一定和音」に留める（拍を持たせない代わりに和声の奥行きで補う）。
  await saveWav("audio/study/pad_01.wav", generatePad("a3", [0, 3, 7], 32, 1101));
  await saveWav("audio/study/pad_02.wav", generatePad("a3", [0, 3, 7, 10], 32, 1102));
  await saveWav("audio/study/pad_03.wav", generatePad("a3", [0, 3, 10], 32, 1103));
  // 「図書室で本を読む」体験を想定し、ピンクノイズをさらに軽くローパスして
  // 高域のシャリつきを削る（brightness = 覚醒/緊張、という音色心理学の知見に基づき、
  // Study は Work よりわずかに暗め＝低覚醒に寄せる）。
  const studyTextureOpts = { warmLowpassHz: 4600 };
  await saveWav("audio/study/texture_pink_a.wav", generateTexture("pink", 20, 1111, studyTextureOpts));
  await saveWav("audio/study/texture_pink_b.wav", generateTexture("pink", 20, 1112, studyTextureOpts));
  // ADR-009: Endel "Read" は規則的な拍を持たない。generatePulse のキックは廃止し、
  // 8拍に1音だけ鳴る極めて疎らな一音（生成器は generateArpeggioPulse を流用、ほぼ全休符）にした。
  // 「拍」ではなく、ページをめくるようなごくまれな残響として存在する。
  const studyEmberPattern = [0, null, null, null, 7, null, null, null];
  const studyEmberOpts = { noteSec: 2.4, decayRate: 0.75, partialGains: [1, 0.22, 0.06], shimmerGain: 0.004, gain: 0.32 };
  await saveWav("audio/study/pulse_01.wav", generateArpeggioPulse("a3", studyEmberPattern, 68, 8, 1121, studyEmberOpts));
  await saveWav("audio/study/pulse_02.wav", generateArpeggioPulse("a3", studyEmberPattern, 68, 8, 1122, studyEmberOpts));
  await saveWav("audio/study/cell_a3.wav", generateOneShot(noteFreq("a3"), 2.2, 1.1, 1131));
  await saveWav("audio/study/cell_c4.wav", generateOneShot(noteFreq("c4"), 2.2, 1.1, 1132));
  await saveWav("audio/study/cell_e4.wav", generateOneShot(noteFreq("e4"), 2.2, 1.1, 1133));
  await saveWav("audio/study/cell_g4.wav", generateOneShot(noteFreq("g4"), 2.2, 1.1, 1134));

  console.log("Work 層を生成中...（A dorian, 76bpm — 木質の部屋＋規則的な拍のグルーヴで前へ進む感覚を出す）");
  // ADR-007: Endel "Deep Work"（"smooth synthesized string, keyboard and wood notes,
  // immersive background harmony"）を参考に、木質楽器/弦楽器のボディ共鳴を模した帯域を
  // Pad に足して温かみを出す。PC作業だけでなく作曲・ライティングのような創造的作業も
  // 想定するテーマのため、Study よりも音色に厚みを持たせる。
  const workPadOpts = { bodyResonanceHz: 700, bodyResonanceGain: 0.35 };
  await saveWav("audio/work/pad_01.wav", generatePad("a3", [0, 3, 7, 9], 30, 1201, workPadOpts));
  await saveWav("audio/work/pad_02.wav", generatePad("a3", [0, 3, 7, 9], 30, 1202, workPadOpts));
  await saveWav("audio/work/pad_03.wav", generatePad("a3", [0, 3, 9], 30, 1203, workPadOpts));
  await saveWav("audio/work/texture_pink.wav", generateTexture("pink", 20, 1211));
  // 旧 texture_hum.wav（オフィスの空調ハム）を "room" に置き換え。
  await saveWav("audio/work/texture_room.wav", generateTexture("room", 20, 1212));
  const workKick = {
    toneStartHz: 150, toneEndHz: 62, pitchDropRate: 32, toneGain: 0.78, noiseGain: 0.13, decayK: 42, clickSec: 0.05,
    // ADR-007: ハイハットをさらに控えめに(旧 0.09 → 0.06)。作曲・ライティングのような
    // 言語/音楽処理そのものを行うタスクでは、リズムの主張が強すぎるとかえって干渉しうる
    // （集中力を高める音の文献調査_gemini.md §3.1、無関連発話効果の音楽家版）。
    hatGain: 0.06, hatDecayK: 110, hatHighpassHz: 7500,
  };
  // ADR-009: Endel "Deep Work" は規則的な拍を積極的に使う（endel.io/science:
  // 「規則的な拍は長時間の集中を助ける」）。キック+ハイハットのグルーヴに、Dorian の
  // 短い2音コンピング動機（トニック→減5度下＝V度）を重ね、Study にはない「音楽性」を足した。
  const workMelody = {
    rootNote: "a3", semitonePattern: [0, null, null, null, 5, null, null, null],
    noteSec: 0.7, decayRate: 2.6, partialGains: [1, 0.4, 0.15], shimmerGain: 0.008, gain: 0.2,
  };
  await saveWav("audio/work/pulse_01.wav", generateGroovePulse(76, 8, 1221, { kickOpts: workKick, melody: workMelody }));
  await saveWav("audio/work/pulse_02.wav", generateGroovePulse(76, 8, 1222, { kickOpts: workKick, melody: workMelody }));
  await saveWav("audio/work/cell_a3.wav", generateOneShot(noteFreq("a3"), 2.0, 1.2, 1231));
  await saveWav("audio/work/cell_b3.wav", generateOneShot(noteFreq("b3"), 2.0, 1.2, 1232));
  await saveWav("audio/work/cell_c4.wav", generateOneShot(noteFreq("c4"), 2.0, 1.2, 1233));
  await saveWav("audio/work/cell_e4.wav", generateOneShot(noteFreq("e4"), 2.0, 1.2, 1234));

  console.log("Move 層を生成中...（E major pentatonic, 128bpm — 筋トレ・運動用。実際のドラムパターン＋拍同期パッド）");
  // ADR-009: Study/Work とは「まったく異なる」構成にする。Pad はサイドチェイン風に拍ごと
  // ダッキングする「ポンピング」エンベロープにし、和音の土台自体をリズムに同調させた。
  // loopSeconds は 128bpm の拍にちょうど整数個(48拍=22.5秒)収まる値にして、
  // ループ境界でポンピングのエンベロープが不連続にならないようにした。
  const movePadOpts = { pumpBpm: 128, pumpDecayK: 7, pumpFloor: 0.42 };
  await saveWav("audio/move/pad_01.wav", generatePad("e4", [0, 4, 7, 9], 22.5, 1301, movePadOpts));
  await saveWav("audio/move/pad_02.wav", generatePad("e4", [0, 4, 9], 22.5, 1302, movePadOpts));
  await saveWav("audio/move/texture_air_a.wav", generateTexture("air", 16, 1311));
  await saveWav("audio/move/texture_air_b.wav", generateTexture("air", 16, 1312));
  // 実際のドラムパターン（キック+スネア/クラップ+ハイハット）。16拍=4拍子×4小節とみなし、
  // スネア/クラップを各小節の2拍目・4拍目（index 1,3,5,7,9,11,13,15）に置く定番のバックビート。
  const moveGroove = {
    kickOpts: { toneStartHz: 180, toneEndHz: 70, pitchDropRate: 46, toneGain: 0.85, noiseGain: 0.15, decayK: 55, clickSec: 0.045 },
    snareBeats: [1, 3, 5, 7, 9, 11, 13, 15],
    snareGain: 0.32, snareDecayK: 60, snareHighpassHz: 1200,
    hatEvery: 0.5, hatGain: 0.15, hatDecayK: 130, hatHighpassHz: 8500,
  };
  await saveWav("audio/move/pulse_01.wav", generateWorkoutGroove(128, 16, 1321, moveGroove));
  await saveWav("audio/move/pulse_02.wav", generateWorkoutGroove(128, 16, 1322, moveGroove));
  const movePluck = { partialGains: [1, 0.5, 0.25], shimmerGain: 0.05 };
  await saveWav("audio/move/cell_e4.wav", generateOneShot(noteFreq("e4"), 1.1, 3.2, 1331, movePluck));
  await saveWav("audio/move/cell_gs4.wav", generateOneShot(noteFreq("g#4"), 1.1, 3.2, 1332, movePluck));
  await saveWav("audio/move/cell_b4.wav", generateOneShot(noteFreq("b4"), 1.1, 3.2, 1333, movePluck));
  await saveWav("audio/move/cell_cs5.wav", generateOneShot(noteFreq("c#5"), 1.1, 3.2, 1334, movePluck));

  console.log("Relax 層を生成中...（D lydian, 64bpm — 自然音＋落ち着いたパッド＋控えめな旋律パルス。拍もリバーブの揺れも作らない）");
  await saveWav("audio/relax/pad_01.wav", generatePad("d4", [0, 4, 7, 11], 30, 1401));
  await saveWav("audio/relax/pad_02.wav", generatePad("d4", [0, 4, 11], 30, 1402));
  await saveWav("audio/relax/texture_rain.wav", generateTexture("rain", 24, 1411));
  await saveWav("audio/relax/texture_waves.wav", generateTexture("waves", 24, 1412));
  // ADR-008/ADR-009: 「音楽性をある程度」持たせるための柔らかいアルペジオ（D Lydian、
  // 7拍で緩やかに山なりに登り降りる）。ADR-009 でテンポを70→64bpmへ落とし、減衰も
  // さらに長く緩やかにして、endel.io/relax の "simple sound structures... easy to process"
  // に合わせ、より静かで主張の弱い存在にした（旧設計は reverb の大きな揺れと相まって
  // 「呼吸するように上下する」不快感の一因になっていたため、音量そのものも下げた）。
  const relaxArpeggioPattern = [0, 4, 7, 9, 7, 4, 2];
  const relaxArpeggioOpts = { noteSec: 2.0, decayRate: 1.0, partialGains: [1, 0.35, 0.12], shimmerGain: 0.01, gain: 0.42 };
  await saveWav("audio/relax/pulse_01.wav", generateArpeggioPulse("d4", relaxArpeggioPattern, 64, 7, 1431, relaxArpeggioOpts));
  await saveWav("audio/relax/pulse_02.wav", generateArpeggioPulse("d4", relaxArpeggioPattern, 64, 7, 1432, relaxArpeggioOpts));
  await saveWav("audio/relax/cell_d4.wav", generateOneShot(noteFreq("d4"), 2.6, 0.9, 1421));
  await saveWav("audio/relax/cell_fs4.wav", generateOneShot(noteFreq("f#4"), 2.6, 0.9, 1422));
  await saveWav("audio/relax/cell_a4.wav", generateOneShot(noteFreq("a4"), 2.6, 0.9, 1423));
  await saveWav("audio/relax/cell_cs5.wav", generateOneShot(noteFreq("c#5"), 2.6, 0.9, 1424));

  console.log("Sleep 層を生成中...（D aeolian・低い register, 60bpm — ブラウンノイズ＋入眠用の疎らな旋律パルス）");
  await saveWav("audio/sleep/pad_01.wav", generatePad("d3", [0, 3, 7], 30, 1501));
  await saveWav("audio/sleep/pad_02.wav", generatePad("d3", [0, 3, 10], 30, 1502));
  await saveWav("audio/sleep/texture_brown_a.wav", generateTexture("brown", 24, 1511));
  await saveWav("audio/sleep/texture_brown_b.wav", generateTexture("brown", 24, 1512));
  // ADR-008: 入眠フェーズ（最初40分）だけに存在させる柔らかい旋律パルス。8拍中3拍しか鳴らさず
  // 余白を持たせ（D Aeolian の短三和音 0,3,7）、Relax より低い register(d3)・長い減衰で
  // 「そっと弾かれるフェルトピアノ」のような質感にする。40分以降は automation 側で 0 まで消す。
  const sleepArpeggioPattern = [0, null, null, 3, null, null, 7, null];
  const sleepArpeggioOpts = { noteSec: 2.6, decayRate: 0.9, partialGains: [1, 0.25, 0.08], shimmerGain: 0.006, gain: 0.42 };
  await saveWav("audio/sleep/pulse_01.wav", generateArpeggioPulse("d3", sleepArpeggioPattern, 60, 8, 1531, sleepArpeggioOpts));
  await saveWav("audio/sleep/pulse_02.wav", generateArpeggioPulse("d3", sleepArpeggioPattern, 60, 8, 1532, sleepArpeggioOpts));
  const sleepTone = { partialGains: [1, 0.2], shimmerGain: 0.005 };
  await saveWav("audio/sleep/cell_d3.wav", generateOneShot(noteFreq("d3"), 3.6, 0.6, 1521, sleepTone));
  await saveWav("audio/sleep/cell_f3.wav", generateOneShot(noteFreq("f3"), 3.6, 0.6, 1522, sleepTone));
  await saveWav("audio/sleep/cell_a3.wav", generateOneShot(noteFreq("a3"), 3.6, 0.6, 1523, sleepTone));

  console.log("Cue を生成中...（全テーマ共通）");
  await saveWav("audio/cues/soft_chime.wav", generateCue(noteFreq("e5"), 1.8, 1601));
  await saveWav("audio/cues/resolve.wav", generateCue(noteFreq("a4"), 2.4, 1602));

  console.log("IR を生成中...");
  await saveWav("ir/room_small.wav", generateIR(1.4, 4.5, 1701)); // Study/Work: 小さめの部屋、明瞭
  await saveWav("ir/room_dry.wav", generateIR(0.6, 7.5, 1702)); // Move: タイトでドライ、推進力を殺さない
  await saveWav("ir/hall_large.wav", generateIR(3.2, 1.3, 1703)); // Relax: 大きなホール、開放感
  await saveWav("ir/hall_deep.wav", generateIR(4.5, 0.9, 1704, 2500)); // Sleep: さらに長く暗いホール

  console.log("\n仮素材の生成が完了しました（WAV, ffmpeg不要）。");
  console.log("本番差し替え時は docs/04_SOUND_ENGINE.md §7 を参照し、OGG Vorbis + docs/ASSET_LICENSES.md 記録を行うこと。");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
