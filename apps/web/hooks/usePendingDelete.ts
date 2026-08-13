"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 「右クリックでゴミ箱アイコンを出し、確定するまで保持する」削除UIの状態。
 *
 * 出しっぱなしにならないよう、**画面のどこかがクリックされたら必ず引っ込める**
 * （Escape でも閉じる）。リスナーは bubble 段階で document に張る。React のイベントは
 * ルートコンテナで処理されてから document まで上がってくるので、ゴミ箱自体のクリックは
 * 「削除の実行 → その後にここで解除」という順に流れ、取りこぼしが起きない。
 * pointerdown で閉じるとゴミ箱が click 前に消えてしまうため、あくまで click を見る。
 */
export function usePendingDelete<Id extends string | number>() {
  const [pendingId, setPendingId] = useState<Id | null>(null);

  const clear = useCallback(() => setPendingId(null), []);
  const request = useCallback((id: Id) => setPendingId(id), []);

  useEffect(() => {
    if (pendingId === null) return;
    const onClick = () => setPendingId(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingId(null);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pendingId]);

  return { pendingId, request, clear };
}
