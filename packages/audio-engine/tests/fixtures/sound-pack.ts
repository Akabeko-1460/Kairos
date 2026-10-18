import type { SoundPack, ThemeSoundDefinition } from "../../src/types";

function createTheme(): ThemeSoundDefinition {
  return {
    kind: "focus",
    key: "A",
    scale: "aeolian",
    bpm: null,
    ir: "/ir/test.wav",
    layers: [],
    automation: {
      pad: [[0, 0]],
      texture: [[0, 0]],
      pulse: [[0, 0]],
      cellDensity: [[0, 0]],
      reverbWet: [[0, 0]],
      lowPassHz: [[0, 1000]],
    },
  };
}

export function createSoundPack(): SoundPack {
  return {
    id: "test",
    name: "Test pack",
    tuning: 440,
    themes: {
      study: createTheme(),
      work: createTheme(),
      move: createTheme(),
      relax: { ...createTheme(), kind: "break" },
      sleep: { ...createTheme(), kind: "break" },
    },
    cues: { phaseEnd: "/cues/phase.wav", sessionEnd: "/cues/session.wav" },
  };
}
