"use client";

import { WeeklyFocusChart } from "@/components/WeeklyFocusChart";
import { loadRecordsSince } from "@/lib/sessionRecordStore";
import { buildStatsView, type StatsView } from "@/lib/statsView";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function StatsPage() {
  const [view, setView] = useState<StatsView | null>(null);

  useEffect(() => {
    let active = true;
    // All history is needed for the lifetime count and streak, including sessions crossing midnight.
    void loadRecordsSince(-Number.MAX_VALUE).then((records) => {
      if (active) {
        setView(buildStatsView(records, Date.now(), (ms) => -new Date(ms).getTimezoneOffset()));
      }
    });
    return () => { active = false; };
  }, []);

  return (
    <div className="relative z-10 mx-auto w-full max-w-lg px-5 py-10 sm:px-8 sm:py-12">
      <h1 className="mb-10 text-xl font-medium text-foreground">Stats</h1>
      {view === null ? <p role="status" className="text-sm text-muted">記録を読み込んでいます…</p> : (
        <div className="flex flex-col gap-10">
          {view.isEmpty && (
            <p className="text-sm leading-relaxed text-muted">
              まだ記録がありません。
              <Link href="/pomodoro" className="underline underline-offset-4">ポモドーロを始めて</Link>
              集中時間を記録しましょう。
            </p>
          )}
          <section aria-labelledby="today-heading">
            <h2 id="today-heading" className="mb-4 text-xs tracking-widest text-muted">今日</h2>
            <dl className="grid grid-cols-2 gap-6">
              <div>
                <dt className="text-sm text-muted">集中時間</dt>
                <dd className="mt-2 text-2xl tabular-nums">{view.today.focusTime}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">完了ポモドーロ</dt>
                <dd className="mt-2 text-2xl tabular-nums">{view.today.completedPomodoros}回</dd>
              </div>
            </dl>
          </section>
          <section aria-labelledby="week-heading">
            <h2 id="week-heading" className="mb-4 text-xs tracking-widest text-muted">直近7日の集中時間</h2>
            <WeeklyFocusChart days={view.week} />
          </section>
          <dl className="grid grid-cols-2 gap-6">
            <div>
              <dt className="text-sm text-muted">連続日数</dt>
              <dd className="mt-2 text-2xl tabular-nums">{view.streakDays}日</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">累計ポモドーロ</dt>
              <dd className="mt-2 text-2xl tabular-nums">{view.totalPomodoros}回</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
