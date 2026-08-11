"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

/**
 * タブ切替時に、新しい画面が奥からふっと浮き出るように現れるトランジション。
 * AudioContext / SoundscapeEngine はページ跨ぎのシングルトン（lib/soundscapeRuntime.ts）なので、
 * ここで画面を再マウントしても音は途切れない。
 *
 * 退出アニメーションは持たせない（AnimatePresence の exit 待ちにしない）。GeometricVisualizer が
 * 複数ページ分同時に稼働する重い canvas 描画と exit のタイミング調整が競合し、
 * 遷移が数秒詰まって見えることがあったため、確実性を優先して入場のみをアニメーションする。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className="flex flex-1 flex-col">{children}</div>;
  }

  return (
    <motion.div
      key={pathname}
      className="flex flex-1 flex-col"
      initial={{ opacity: 0, y: 14, scale: 0.975, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
