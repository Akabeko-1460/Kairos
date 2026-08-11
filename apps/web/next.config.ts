import type { NextConfig } from "next";

// Kairos は完全クライアントサイドのオフライン前提アプリ（docs/03_ARCHITECTURE.md ADR-002）。
// SSR / RSC / Server Actions / API Routes は使わないため静的書き出しにする。
const nextConfig: NextConfig = {
  output: "export",
  // packages/core・packages/audio-engine はビルド済みJSを持たない純粋TSパッケージなので、
  // Next のコンパイラでこのアプリと一緒にトランスパイルする。
  transpilePackages: ["@kairos/core", "@kairos/audio-engine"],
};

export default nextConfig;
