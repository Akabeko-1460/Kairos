import { STORY_PERIOD_SEC, storyBreath } from "../storyPeriods";
import { mulberry32, rgba, type VisualStyle } from "./shared";

// ============================================================================
// Chronos — Home画面の待機状態（テーマ未選択時）専用の背景。
//
// 「アルゴリズミック・フィロソフィー」（algorithmic-art skill の手法を、このプロジェクトの
// 素のCanvas2D設計に合わせて適用したもの）:
//
//   Kairos（καιρός）とは、測って刻む時間 Chronos（χρόνος）とは違う、「今がその時だ」という
//   質的な好機を指すギリシャ語である。このテーマ未選択の待機画面は、まだ何のフェーズにも
//   入っていない——Chronosだけが流れている状態そのものを表現する。だから色を持たない。
//   黒と白の2値だけが、まだ意味づけられる前の「測定」を表す。
//
//   中心の一点から放たれる複数の針（脱進機 escapement の歯車になぞらえた）は、互いに
//   通約不能に近い角速度比（1:2:3:5:7:11、ゆっくりとした素数寄りの比）で回り続ける。
//   このため厳密な整列はほとんど起こらず、起こる瞬間は毎回のシードで微妙に異なる、
//   予測しづらい巡り合わせになる——それこそが Kairos（好機）の視覚的な比喩である。
//   針の角度分布が揃うほど中心の光が強まる、というシンプルな数式（複素平均のノルム）だけで、
//   「ほとんどの時間は静かで、ごくまれに強く輝く」という物語が計算から自然に立ち上がる。
//   スクリプトされたイベントは一つもない。
//
//   外周の目盛りリングは動かない——それが Chronos の律動（不変の尺度）であり、
//   その中で針だけが Kairos を探して回り続ける。
// ============================================================================

interface Hand {
  lengthRatio: number; // 針の長さ（minDim比）
  speed: number; // 角速度（ラジアン/秒）。符号も含めて互いに素な比になるよう選ぶ
  angle0: number;
}
interface TickRing {
  radiusRatio: number;
  count: number;
  majorEvery: number;
}

interface ChronosState {
  hands: Hand[];
  rings: TickRing[];
}

// 角速度の比。1:2:3:5:7:11 に近い値にすることで、全ての針が同時に揃う周期を
// 天文学的に長くする（=厳密な整列がほぼ起こらない）。符号を混ぜて回転方向にも変化を持たせる。
const HAND_SPEED_RATIOS = [1, -2, 3, -5, 7, -11] as const;
const HAND_BASE_SPEED = 0.0065; // ラジアン/秒。最も遅い針が一周するのに約16分かかる程度の静けさ
const HAND_LENGTH_RATIOS = [0.15, 0.21, 0.27, 0.33, 0.39, 0.45] as const;

const RINGS: TickRing[] = [
  { radiusRatio: 0.46, count: 60, majorEvery: 5 }, // 秒の目盛り
  { radiusRatio: 0.34, count: 24, majorEvery: 2 }, // 時の目盛り
];

export const chronosStyle: VisualStyle<ChronosState> = {
  clearMode: "clear",
  createState(seed) {
    const rng = mulberry32(seed);
    const hands: Hand[] = HAND_SPEED_RATIOS.map((ratio, i) => ({
      lengthRatio: HAND_LENGTH_RATIOS[i]! * (0.94 + rng() * 0.12),
      speed: HAND_BASE_SPEED * ratio * (0.92 + rng() * 0.16),
      angle0: rng() * Math.PI * 2,
    }));
    return { hands, rings: RINGS };
  },
  draw(f, state) {
    const { ctx, cx, cy, minDim, t, amp, rgb } = f;
    const breath = storyBreath(t, STORY_PERIOD_SEC.chronos);

    // 目盛りリング: Chronos（不変の尺度）を表す、動かない外周の輪。厚みだけが静かに呼吸する。
    for (const ring of state.rings) {
      const baseR = ring.radiusRatio * minDim;
      for (let i = 0; i < ring.count; i++) {
        const a = (i / ring.count) * Math.PI * 2;
        const major = i % ring.majorEvery === 0;
        const len = (major ? 0.022 : 0.01) * minDim * (0.7 + breath * 0.3);
        const r0 = baseR;
        const r1 = baseR + len;
        ctx.strokeStyle = rgba(rgb, (major ? 0.55 : 0.22) * (0.6 + breath * 0.4));
        ctx.lineWidth = major ? Math.max(1.2, minDim * 0.0018) : Math.max(0.8, minDim * 0.0011);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(rgb, 0.14);
      ctx.lineWidth = Math.max(0.8, minDim * 0.001);
      ctx.stroke();
    }

    // Kairos（好機）の瞬間: 針の角度が複素平均でどれだけ揃っているかを1つの数式で測る。
    // 揃うほど resultant の絶対値が1に近づく——台本なしに、計算そのものから生まれる強調。
    let sumX = 0;
    let sumY = 0;
    const handAngles = state.hands.map((hand) => {
      const angle = hand.angle0 + t * hand.speed;
      sumX += Math.cos(angle);
      sumY += Math.sin(angle);
      return angle;
    });
    const alignment = Math.hypot(sumX, sumY) / state.hands.length; // 0=バラバラ 1=完全整列
    const kairos = Math.max(0, alignment - 0.35) / 0.65; // 緩やかな整列は無視し、強い整列だけを光らせる

    if (kairos > 0.02) {
      const glowR = minDim * (0.1 + kairos * 0.22);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0, rgba(rgb, kairos * 0.5));
      glow.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 針: 中心から放たれ、互いに素な角速度でそれぞれの時間を刻み続ける
    for (const [i, hand] of state.hands.entries()) {
      const angle = handAngles[i]!;
      const len = hand.lengthRatio * minDim;
      const x = cx + Math.cos(angle) * len;
      const y = cy + Math.sin(angle) * len;
      ctx.strokeStyle = rgba(rgb, (0.5 + amp * 0.15 + kairos * 0.3) * (0.85 + breath * 0.15));
      ctx.lineWidth = Math.max(1, minDim * (0.0016 - i * 0.00008));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2, minDim * 0.0022), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, 0.7 + kairos * 0.3);
      ctx.fill();
    }

    // 中心のピボット
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, minDim * 0.005), 0, Math.PI * 2);
    ctx.fillStyle = rgba(rgb, 0.9);
    ctx.fill();
  },
};
