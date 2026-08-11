"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

/**
 * タブ切替時に、画面が奥からふっと浮き出るように現れるトランジション。
 * AudioContext / SoundscapeEngine はページ跨ぎのシングルトン（lib/soundscapeRuntime.ts）なので、
 * ここで画面を再マウントしても音は途切れない。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className="flex flex-1 flex-col">{children}</div>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="flex flex-1 flex-col"
        initial={{ opacity: 0, y: 14, scale: 0.975, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -8, scale: 1.008, filter: "blur(3px)" }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
