"use client";

import { usePathname } from "next/navigation";

/**
 * タブ切替時に、画面が奥からふっと浮き出るように現れるトランジション。
 * pathname を key にして中身を強制的に再マウントし、CSS アニメーションを毎回再生する。
 * AudioContext / SoundscapeEngine はページ跨ぎのシングルトン（lib/soundscapeRuntime.ts）なので、
 * ここで画面を再マウントしても音は途切れない。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="page-rise flex flex-1 flex-col">
      {children}
    </div>
  );
}
