"use client";

import { useTimerStore } from "@/hooks/useTimer";
import { useSettingsStore } from "@/lib/settingsStore";
import type { ReactNode } from "react";

const buttonClass =
  "rounded-full border border-border px-4 py-2 text-sm text-muted transition-colors " +
  "hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus-accent";
const selectedClass = "border-focus-accent bg-focus-accent/10 text-foreground";
const themes = [["dark", "ダーク"], ["light", "ライト"]] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-[10px] tracking-widest text-muted/60">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ label, enabled, onChange }: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`${buttonClass} min-w-16 ${enabled ? selectedClass : ""}`}
      >
        {enabled ? "ON" : "OFF"}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const timer = useTimerStore((store) => store.state);
  const setTotalRounds = useTimerStore((store) => store.setTotalRounds);
  const setAutoContinue = useTimerStore((store) => store.setAutoContinue);
  const settings = useSettingsStore();
  const roundsLocked = timer.phase !== "idle" && timer.phase !== "completed";

  return (
    <div className="relative z-10 mx-auto w-full max-w-lg px-5 py-10 sm:px-8 sm:py-12">
      <h1 className="mb-10 text-xl font-medium text-foreground">Settings</h1>
      <div className="flex flex-col gap-10">
        <Section title="POMODORO">
          <div>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="total-rounds" className="text-sm text-foreground">ラウンド数</label>
              <select
                id="total-rounds"
                value={timer.totalRounds}
                disabled={roundsLocked}
                aria-describedby={roundsLocked ? "rounds-locked" : undefined}
                onChange={(event) => setTotalRounds(Number(event.target.value))}
                className={`${buttonClass} bg-background disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((rounds) => (
                  <option key={rounds} value={rounds}>{rounds}</option>
                ))}
              </select>
            </div>
            {roundsLocked && (
              <p id="rounds-locked" className="mt-2 text-xs text-muted">実行中は変更できません（一時停止中を含む）。</p>
            )}
          </div>
          <Toggle label="自動継続" enabled={timer.autoContinue} onChange={setAutoContinue} />
        </Section>
        <Section title="SOUND">
          <Toggle label="合図音" enabled={settings.cueEnabled} onChange={settings.setCueEnabled} />
        </Section>
        <Section title="GENERAL">
          <Toggle label="通知" enabled={settings.notificationsEnabled} onChange={settings.setNotificationsEnabled} />
          <Toggle label="画面スリープ防止" enabled={settings.wakeLockEnabled} onChange={settings.setWakeLockEnabled} />
          <Toggle
            label="キーボードショートカット"
            enabled={settings.keyboardShortcutsEnabled}
            onChange={settings.setKeyboardShortcutsEnabled}
          />
        </Section>
        <Section title="THEME">
          <div role="group" aria-label="テーマ" className="flex gap-2">
            {themes.map(([theme, label]) => (
              <button
                key={theme}
                type="button"
                aria-pressed={settings.theme === theme}
                onClick={() => settings.setTheme(theme)}
                className={`${buttonClass} ${settings.theme === theme ? selectedClass : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
