export type ShortcutStatus = "idle" | "running" | "paused";
export type ShortcutAction = "start" | "pause" | "resume" | "skip";

export interface ShortcutInput {
  key: string;
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  targetTag: string;
  isContentEditable: boolean;
}

/** Map unmodified keys outside editing controls to timer commands. */
export function shortcutAction(input: ShortcutInput, status: ShortcutStatus): ShortcutAction | null {
  const targetTag = input.targetTag.toLowerCase();
  if (input.repeat || input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return null;
  if (input.isContentEditable || targetTag === "input" || targetTag === "textarea" || targetTag === "select") {
    return null;
  }

  if (input.code === "Space" || input.key === " ") {
    if (status === "idle") return "start";
    return status === "running" ? "pause" : "resume";
  }
  if (input.key.toLowerCase() === "n" && status !== "idle") return "skip";
  return null;
}
