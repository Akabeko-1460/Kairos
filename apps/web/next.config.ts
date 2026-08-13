import type { NextConfig } from "next";
import createBundleAnalyzer from "@next/bundle-analyzer";

// Kairos は完全クライアントサイドのオフライン前提アプリ（docs/03_ARCHITECTURE.md ADR-002）。
// SSR / RSC / Server Actions / API Routes は使わないため静的書き出しにする。
const nextConfig: NextConfig = {
  output: "export",
  // packages/core・packages/audio-engine はビルド済みJSを持たない純粋TSパッケージなので、
  // Next のコンパイラでこのアプリと一緒にトランスパイルする。
  transpilePackages: ["@kairos/core", "@kairos/audio-engine"],
};

// JSチャンクの内訳を可視化する計測用ラッパー。ANALYZE=true のときだけ有効になり、
// 通常の `next build`/配布物には一切影響しない（`pnpm analyze` から使う想定）。
const withBundleAnalyzer = createBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

export default withBundleAnalyzer(nextConfig);
