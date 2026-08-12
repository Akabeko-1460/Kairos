import { STORY_PERIOD_SEC, storyBreath } from "../storyPeriods";
import { cyclePhase, easeOutCubic, mulberry32, rgba, type VisualStyle } from "./shared";

// ============================================================================
// Sleep — 「近くの星がゆっくり遠ざかり、深く沈んでいく」視差の物語 + 時折流れる星。
// ============================================================================

interface Star {
  nx: number;
  ny: number;
  size: number;
  phase: number;
  speed: number;
  depthPhase: number;
  depthSpeed: number;
}
interface Nebula {
  angle: number;
  orbitR: number;
  speed: number;
  sizeRatio: number;
}
interface Crater {
  ox: number; // 月の半径に対する相対オフセット
  oy: number;
  radiusRatio: number;
}
interface Moon {
  nx: number; // 画面に対する正規化位置（0..1）。空の上寄りに固定し、わずかにだけ漂う
  ny: number;
  driftAngle: number;
  driftR: number;
  shadowAngle: number; // 欠け際の向き。セッションごとに固定
  phaseSeed: number;
  craters: Crater[];
}
interface ConstellationGroup {
  starIndices: number[];
  rotSpeed: number;
  centerNx: number;
  centerNy: number;
}
interface StarfieldState {
  stars: Star[];
  nebulae: Nebula[];
  moon: Moon;
  constellations: ConstellationGroup[];
  seedBase: number;
}

const SLEEP_SHOOT_PERIOD = 8.5;
const MOON_PHASE_PERIOD_SEC = STORY_PERIOD_SEC.starfield * 5.2; // 満ち欠け。1サイクルがとても長く、ほとんど気づかないくらいゆっくり進む

export const starfieldStyle: VisualStyle<StarfieldState> = {
  clearMode: "clear",
  createState(seed) {
    const rng = mulberry32(seed);
    const stars: Star[] = Array.from({ length: 190 }, () => ({
      nx: rng(),
      ny: rng(),
      size: 0.6 + rng() * 1.8,
      phase: rng() * Math.PI * 2,
      speed: 0.3 + rng() * 0.7,
      depthPhase: rng() * Math.PI * 2,
      depthSpeed: 0.015 + rng() * 0.02,
    }));
    const nebulae: Nebula[] = Array.from({ length: 2 }, (_, i) => ({
      angle: rng() * Math.PI * 2,
      orbitR: 0.05 + rng() * 0.1,
      speed: (0.01 + rng() * 0.015) * (i % 2 === 0 ? 1 : -1),
      sizeRatio: 0.2 + rng() * 0.16,
    }));
    const craters: Crater[] = Array.from({ length: 5 }, () => {
      const a = rng() * Math.PI * 2;
      const r = rng() * 0.55; // 中心寄りに集める（rejectionせず単純な半径分布で十分自然）
      return { ox: Math.cos(a) * r, oy: Math.sin(a) * r, radiusRatio: 0.08 + rng() * 0.1 };
    });
    const moon: Moon = {
      nx: 0.74 + rng() * 0.12,
      ny: 0.15 + rng() * 0.1,
      driftAngle: rng() * Math.PI * 2,
      driftR: 0.012 + rng() * 0.008,
      shadowAngle: rng() * Math.PI * 2,
      phaseSeed: rng() * Math.PI * 2,
      craters,
    };
    // 星座: 実際の星座のように、数個の群れをそれぞれ独立にゆっくり回転させる
    // （単一の線画ではなく「夜空のあちこちに星座がある」という物語にする）。
    const constellations: ConstellationGroup[] = Array.from({ length: 2 }, (_, i) => {
      const starIndices = Array.from({ length: 5 + Math.floor(rng() * 2) }, () => Math.floor(rng() * stars.length));
      return {
        starIndices,
        rotSpeed: (0.004 + rng() * 0.006) * (i % 2 === 0 ? 1 : -1),
        centerNx: 0.2 + rng() * 0.6,
        centerNy: 0.2 + rng() * 0.5,
      };
    });
    return { stars, nebulae, moon, constellations, seedBase: seed * 97 + 13 };
  },
  draw(f, state) {
    const { ctx, w, h, cx, cy, minDim, t, amp, rgb } = f;
    const breath = storyBreath(t, STORY_PERIOD_SEC.starfield);

    for (const neb of state.nebulae) {
      const angle = neb.angle + t * neb.speed;
      const x = cx + Math.cos(angle) * minDim * neb.orbitR;
      const y = cy + Math.sin(angle) * minDim * neb.orbitR * 0.6;
      const r = minDim * neb.sizeRatio * (0.9 + amp * 0.2);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(rgb, (0.1 + amp * 0.05) * breath));
      grad.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 月: 遠くでゆっくり満ち欠けしながら、空の一角に留まって静かに漂う
    const moon = state.moon;
    const driftX = Math.cos(t * 0.008 + moon.driftAngle) * moon.driftR;
    const driftY = Math.sin(t * 0.006 + moon.driftAngle) * moon.driftR * 0.7;
    const mx = (moon.nx + driftX) * w;
    const my = (moon.ny + driftY) * h;
    const moonR = minDim * 0.075 * (0.96 + amp * 0.06);
    const moonPhase = 0.5 + 0.5 * Math.sin(t * ((2 * Math.PI) / MOON_PHASE_PERIOD_SEC) + moon.phaseSeed); // 0=新月 1=満月

    const moonGlow = ctx.createRadialGradient(mx, my, 0, mx, my, moonR * 2.6);
    moonGlow.addColorStop(0, rgba(rgb, (0.14 + amp * 0.04) * breath));
    moonGlow.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = moonGlow;
    ctx.beginPath();
    ctx.arc(mx, my, moonR * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(mx, my, moonR, 0, Math.PI * 2);
    ctx.fillStyle = rgba(rgb, 0.58 + amp * 0.08);
    ctx.fill();

    // 満ち欠け: 同じ半径の円を欠け際の方向へずらして destination-out で削り取る古典的な三日月トリック
    const shadowDist = moonPhase * moonR * 2.05;
    const shadowX = mx + Math.cos(moon.shadowAngle) * shadowDist;
    const shadowY = my + Math.sin(moon.shadowAngle) * shadowDist;
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(shadowX, shadowY, moonR * 1.02, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    ctx.fill();
    // クレーター: 完全な球体に見えすぎないための、ごく薄い質感
    for (const crater of moon.craters) {
      ctx.beginPath();
      ctx.arc(mx + crater.ox * moonR, my + crater.oy * moonR, crater.radiusRatio * moonR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // 星座: 夜空のあちこちに、数個の星座がそれぞれ独立にゆっくり回転しながら浮かぶ
    for (const group of state.constellations) {
      const gx = group.centerNx * w;
      const gy = group.centerNy * h;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(t * group.rotSpeed);
      ctx.translate(-gx, -gy);
      ctx.strokeStyle = rgba(rgb, 0.22 + amp * 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [i, idx] of group.starIndices.entries()) {
        const s = state.stars[idx]!;
        const x = s.nx * w;
        const y = s.ny * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // 星座を成す星は、その場所に本当に星座があると分かるよう小さな輪でマークする
      for (const idx of group.starIndices) {
        const s = state.stars[idx]!;
        ctx.beginPath();
        ctx.arc(s.nx * w, s.ny * h, s.size * 2.2, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(rgb, 0.3 + amp * 0.12);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // 星: 個々にゆっくり「近づいたり遠ざかったり」する視差の呼吸（深く沈んでいく物語）
    for (const s of state.stars) {
      const depth = 0.5 + 0.5 * Math.sin(t * s.depthSpeed + s.depthPhase); // 1=近い/大きい 0=遠い/小さい
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(t * s.speed + s.phase));
      const x = s.nx * w;
      const y = s.ny * h;
      const scale = 0.35 + depth * 0.85;
      const alphaDepth = 0.2 + depth * 0.65;
      ctx.beginPath();
      ctx.arc(x, y, s.size * scale * (0.7 + twinkle * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, (0.12 + twinkle * 0.5) * alphaDepth);
      ctx.fill();
    }

    // 副軌道リング: 主となる星々・星座と同格の大きさを持つ、もう1つの軌道パターン。
    // 画面の大部分を占める大きなリング状に並んだ点を、独立した周期でゆっくり逆回転させる。
    // 中心付近だけの小さな星雲ではなく、土星の環のように画面全体を横切る規模で
    // 「深く沈んでいく」物語に呼応する、もう1つの静かな時間軸を作る（モアレ干渉技法を参照）。
    const haloPeriod = STORY_PERIOD_SEC.starfield * 1.35;
    const haloBreath = storyBreath(t, haloPeriod);
    const haloCount = 22;
    const haloR = minDim * 0.46;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.01);
    ctx.scale(1, 0.55);
    ctx.strokeStyle = rgba(rgb, 0.08 * haloBreath);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < haloCount; i++) {
      const a = (i / haloCount) * Math.PI * 2;
      const x = Math.cos(a) * haloR;
      const y = Math.sin(a) * haloR;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, minDim * 0.0016), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, (0.12 + 0.14 * Math.abs(Math.sin(a * 4 + t * 0.08))) * haloBreath);
      ctx.fill();
    }
    ctx.restore();

    // 時折流れる星（物語のアクセント）
    const shootCycleIdx = Math.floor(t / SLEEP_SHOOT_PERIOD);
    const shootPhase = cyclePhase(t, SLEEP_SHOOT_PERIOD);
    if (shootPhase < 0.16) {
      const rngShoot = mulberry32(state.seedBase + shootCycleIdx * 733);
      const sx = rngShoot() * w * 0.7 + w * 0.15;
      const sy = rngShoot() * h * 0.3;
      const ex = sx - w * (0.18 + rngShoot() * 0.12);
      const ey = sy + h * (0.22 + rngShoot() * 0.1);
      const p = easeOutCubic(shootPhase / 0.16);
      const hx = sx + (ex - sx) * p;
      const hy = sy + (ey - sy) * p;
      const tailLen = 0.18;
      const tx = sx + (ex - sx) * Math.max(0, p - tailLen);
      const ty = sy + (ey - sy) * Math.max(0, p - tailLen);
      const grad = ctx.createLinearGradient(tx, ty, hx, hy);
      grad.addColorStop(0, rgba(rgb, 0));
      grad.addColorStop(1, rgba(rgb, 0.7));
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
  },
};
