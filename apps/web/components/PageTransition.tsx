"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { clearInstantNavigationPending, isInstantNavigationPending, isNativeTransitionInFlight } from "@/lib/viewTransition";

/**
 * タブ切替時に新しい画面が奥からふっと浮き出るように現れるトランジション。
 * AudioContext / SoundscapeEngine はページ跨ぎのシングルトン（lib/soundscapeRuntime.ts）なので、
 * ここで画面を再マウントしても音は途切れない。
 *
 * 退出アニメーションはここでは持たせない。以前 AnimatePresence で退出も含めた
 * クロスフェードを試みたが、Next.js App Router の `children` 解決の仕組み上うまく
 * 機能しないことが実機検証で判明した（詳細は lib/viewTransition.ts の説明を参照）。
 *
 * Home や Timers メニュー（Pomodoro/Timer/Stopwatch への切替）はブラウザ標準の
 * View Transitions API（TopNav.tsx が `navigateWithViewTransition` でナビゲーションを包む）
 * で旧画面→新画面を本当に滑らかにクロスフェードさせている。`isNativeTransitionInFlight()` で
 * 「今まさに View Transition 経由のナビゲーション中か」を見て、その間はここでの
 * 二重アニメーションを避ける。
 *
 * さらに、Pomodoro/Timer/Stopwatch 同士の切り替えのように追加のロードを伴わない遷移は
 * `navigateInstantly()`（`isInstantNavigationPending()`）でアニメーション自体を使わず
 * 即座に切り替える。Home 等から Timers 系へ最初に入るときだけ、これまで通りの
 * View Transition アニメーションを使う（TopNav.tsx の分岐を参照）。
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const skipForInstantNavigation = isInstantNavigationPending();

  // navigateInstantly() が立てたフラグは、この pathname 変化を反映したレンダーが実際に
  // コミットされた後（＝このeffectが走るタイミング）で下ろす。固定時間のタイマーだけに
  // 頼ると、レンダーがそれより遅れた場合にフラグが早く消えてしまい、下の framer-motion
  // フェードが漏れて発動してしまう（実機検証で確認済み）。
  useEffect(() => {
    if (skipForInstantNavigation) clearInstantNavigationPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (reduceMotion || isNativeTransitionInFlight() || skipForInstantNavigation) {
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
