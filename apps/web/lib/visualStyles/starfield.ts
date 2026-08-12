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
/**
 * 太陽系のイメージ: 画面中心を「太陽」として、月を表す円がいくつか同心円状の軌道を巡り、
 * さらに画面の端から端までかかるほど巨大な円弧（同じ中心を持つ、ずっと半径の大きい軌道の一部）
 * が別の周期でゆっくり掃過する。全員が同じ中心の周りを回る同心円軌道である点が「太陽系」らしさで、
 * 半径が大きい軌道ほど周期を長くしている（外側の惑星ほど公転が遅い、という実際の太陽系に寄せた）。
 */
interface MoonOrbit {
  orbitRadiusRatio: number; // 中心からの軌道半径（minDim比）
  moonRadiusRatio: number; // 月自体の半径（minDim比）
  angle0: number;
  speed: number;
}
interface ArcOrbit {
  arcRadiusRatio: number; // 弧が乗る円の半径（maxDim比）。巨大にして画面を横断させる
  arcSpan: number; // 弧の角度幅（ラジアン）
  angle0: number;
  speed: number;
}
interface ConstellationGroup {
  shapeIndex: number;
  centerNx: number;
  centerNy: number;
  scale: number; // 星座の見た目の大きさ（minDim比）
  baseRotation: number; // 配置時の固定回転（同じ星座ばかりに見えないための変化）
  rotSpeed: number;
}
interface StarfieldState {
  stars: Star[];
  nebulae: Nebula[];
  moons: MoonOrbit[];
  arcs: ArcOrbit[];
  constellations: ConstellationGroup[];
  seedBase: number;
}

/**
 * 実在の星座（の簡略化した形）。0..1 に正規化した頂点座標と、それを結ぶ辺。
 * ランダムな星をランダムな順で結ぶのではなく、実際の星座の形をなぞることで
 * 「星座らしさ」を出す（北斗七星＝おおぐま座の柄杓、カシオペア座のW字、オリオン座の砂時計形）。
 */
const CONSTELLATION_SHAPES: ReadonlyArray<{
  points: ReadonlyArray<readonly [number, number]>;
  edges: ReadonlyArray<readonly [number, number]>;
}> = [
  {
    // 北斗七星（おおぐま座の一部）: 柄の3星 + 柄杓の4星
    points: [
      [0.05, 0.1],
      [0.28, 0.22],
      [0.5, 0.3],
      [0.68, 0.46],
      [0.95, 0.4],
      [0.88, 0.72],
      [0.55, 0.78],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 3],
    ],
  },
  {
    // カシオペア座: W字のジグザグ
    points: [
      [0.0, 0.55],
      [0.22, 0.05],
      [0.48, 0.62],
      [0.75, 0.0],
      [1.0, 0.5],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  },
  {
    // オリオン座: 両肩・三ツ星・両足の砂時計形
    points: [
      [0.1, 0.05],
      [0.9, 0.1],
      [0.38, 0.48],
      [0.5, 0.52],
      [0.62, 0.56],
      [0.15, 0.95],
      [0.85, 0.9],
    ],
    edges: [
      [0, 2],
      [2, 3],
      [3, 4],
      [4, 1],
      [2, 5],
      [4, 6],
    ],
  },
];

const SLEEP_SHOOT_PERIOD = 6.0;

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
    // 月: 3つの同心円軌道を巡る。外側の軌道ほど公転周期を長くする（太陽系らしさ）
    const moons: MoonOrbit[] = Array.from({ length: 3 }, (_, i) => {
      const orbitRadiusRatio = 0.17 + i * 0.09 + rng() * 0.04;
      const baseSpeed = 0.052 / (1 + i * 0.9); // 外側ほど遅い
      return {
        orbitRadiusRatio,
        moonRadiusRatio: 0.11 + rng() * 0.05,
        angle0: rng() * Math.PI * 2,
        speed: baseSpeed * (0.75 + rng() * 0.5) * (rng() < 0.5 ? 1 : -1),
      };
    });
    // 円弧: 画面を横断するほど巨大な同心円の一部だけを描き、ゆっくり掃過させる。
    // 月よりさらに外側の軌道という位置づけなので、さらに周期を長くする。
    const arcs: ArcOrbit[] = Array.from({ length: 2 }, (_, i) => ({
      arcRadiusRatio: 0.75 + i * 0.28 + rng() * 0.12,
      arcSpan: 0.55 + rng() * 0.35,
      angle0: rng() * Math.PI * 2,
      speed: ((0.0035 + rng() * 0.003) / (1 + i * 0.6)) * (rng() < 0.5 ? 1 : -1),
    }));
    // 星座: 実在の星座の形（CONSTELLATION_SHAPES）を、夜空のあちこちに違う大きさ・向きで配置する。
    // 形の種類は3つしかないが、数を増やす分は配置・向き・大きさを変えて巡回させる
    // （全く同じ見た目の星座が2つ現れることはない）。
    const shapeOrder = [0, 1, 2].sort(() => rng() - 0.5);
    const constellations: ConstellationGroup[] = Array.from({ length: 4 }, (_, i) => ({
      shapeIndex: shapeOrder[i % shapeOrder.length]!,
      centerNx: 0.18 + rng() * 0.64,
      centerNy: 0.14 + rng() * 0.5,
      scale: 0.1 + rng() * 0.05,
      baseRotation: rng() * Math.PI * 2,
      rotSpeed: (0.004 + rng() * 0.006) * (i % 2 === 0 ? 1 : -1),
    }));
    return { stars, nebulae, moons, arcs, constellations, seedBase: seed * 97 + 13 };
  },
  draw(f, state) {
    const { ctx, w, h, cx, cy, minDim, maxDim, t, amp, rgb } = f;
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

    // 月: 画面中心という共通の「太陽」の周りを、3つの同心円軌道を公転する。
    // 満ちた円盤ではなく、周りの線だけの円（軌道のような佇まい）にする。
    for (const moon of state.moons) {
      const angle = moon.angle0 + t * moon.speed;
      const x = cx + Math.cos(angle) * minDim * moon.orbitRadiusRatio;
      const y = cy + Math.sin(angle) * minDim * moon.orbitRadiusRatio * 0.6;
      const r = minDim * moon.moonRadiusRatio * (0.96 + amp * 0.05);

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(rgb, (0.5 + amp * 0.1) * breath);
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.stroke();
    }

    // 円弧: 同じ中心を持つ、画面を横断するほど巨大な軌道の一部だけを描き、掃過させる。
    // 月よりさらに外側の同心円という位置づけ（太陽系のイメージ）。
    for (const arc of state.arcs) {
      const r = maxDim * arc.arcRadiusRatio;
      const start = arc.angle0 + t * arc.speed;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + arc.arcSpan);
      ctx.strokeStyle = rgba(rgb, (0.22 + amp * 0.08) * breath);
      ctx.lineWidth = Math.max(1.2, minDim * 0.002);
      ctx.stroke();
    }

    // 星座: 実在の星座の形（CONSTELLATION_SHAPES）を、夜空のあちこちに配置してゆっくり回転させる
    for (const group of state.constellations) {
      const shape = CONSTELLATION_SHAPES[group.shapeIndex]!;
      const gx = group.centerNx * w;
      const gy = group.centerNy * h;
      const size = minDim * group.scale;
      const rotation = group.baseRotation + t * group.rotSpeed;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);

      const screenPoints = shape.points.map(([px, py]) => {
        // 形状の中心 (0.5, 0.5) を基準に回転させてから配置する
        const lx = (px - 0.5) * size;
        const ly = (py - 0.5) * size;
        return [gx + lx * cos - ly * sin, gy + lx * sin + ly * cos] as const;
      });

      ctx.strokeStyle = rgba(rgb, 0.24 + amp * 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of shape.edges) {
        const [x1, y1] = screenPoints[a]!;
        const [x2, y2] = screenPoints[b]!;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      // 星座を成す星は、その場所に本当に星座があると分かるよう小さな輪でマークする
      for (const [x, y] of screenPoints) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.4, minDim * 0.003), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(rgb, 0.32 + amp * 0.12);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
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
