/**
 * Web Audio API Notification Sound Synthesizer
 * Provides crystal-clear, zero-dependency, zero-latency notification chimes
 * with customizable presets for Agency and Admin users.
 */

export type NotificationSoundType =
  | "modern_chime"
  | "crisp_ding"
  | "subtle_pop"
  | "soft_bell"
  | "radar_pulse"
  | "gentle_swoosh"
  | "none";

export interface SoundPreset {
  id: NotificationSoundType;
  label: string;
  description: string;
}

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: "modern_chime",
    label: "Modern Chime",
    description: "Harmonic dual-tone chime (Recommended)",
  },
  {
    id: "crisp_ding",
    label: "Crisp Crystal Ding",
    description: "High-clarity bright alert ping",
  },
  {
    id: "soft_bell",
    label: "Soft Marimba Bell",
    description: "Warm three-note ambient triad",
  },
  {
    id: "subtle_pop",
    label: "Subtle Pop",
    description: "Quiet and non-intrusive bubble pop",
  },
  {
    id: "radar_pulse",
    label: "Radar Tech Pulse",
    description: "Futuristic double-pulse alert",
  },
  {
    id: "gentle_swoosh",
    label: "Gentle Swoosh",
    description: "Smooth resonant tone with soft attack",
  },
  {
    id: "none",
    label: "Mute / Silent",
    description: "Visual notifications only without sound",
  },
];

const STORAGE_KEY_SOUND = "avtr:notification_sound";
const STORAGE_KEY_ENABLED = "avtr:notification_sound_enabled";
const STORAGE_KEY_VOLUME = "avtr:notification_sound_volume";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!audioCtx && AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function getNotificationSoundSetting(): NotificationSoundType {
  if (typeof window === "undefined") return "modern_chime";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_SOUND);
    if (stored && SOUND_PRESETS.some((p) => p.id === stored)) {
      return stored as NotificationSoundType;
    }
  } catch {}
  return "modern_chime";
}

export function setNotificationSoundSetting(sound: NotificationSoundType): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_SOUND, sound);
    window.dispatchEvent(new CustomEvent("avtr:notification-sound-changed", { detail: sound }));
  } catch {}
}

export function isNotificationSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_ENABLED);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_ENABLED, String(enabled));
    window.dispatchEvent(new CustomEvent("avtr:notification-sound-enabled-changed", { detail: enabled }));
  } catch {}
}

export function getNotificationVolume(): number {
  if (typeof window === "undefined") return 0.8;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_VOLUME);
    return stored ? Math.max(0.1, Math.min(1, parseFloat(stored))) : 0.8;
  } catch {
    return 0.8;
  }
}

export function setNotificationVolume(volume: number): void {
  if (typeof window === "undefined") return;
  try {
    const clamped = Math.max(0.05, Math.min(1, volume));
    window.localStorage.setItem(STORAGE_KEY_VOLUME, String(clamped));
  } catch {}
}

/**
 * Synthesize and play notification sound based on selected preset
 */
export function playNotificationSound(soundOverride?: NotificationSoundType): void {
  if (typeof window === "undefined") return;

  const enabled = isNotificationSoundEnabled();
  if (!enabled && !soundOverride) return;

  const soundType = soundOverride || getNotificationSoundSetting();
  if (soundType === "none") return;

  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterVolume = getNotificationVolume();

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(masterVolume, now);
  masterGain.connect(ctx.destination);

  switch (soundType) {
    case "modern_chime": {
      // Warm modern dual-tone chime (F#5 -> B5 harmonic)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(739.99, now); // F#5
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc2.type = "sine";
      osc2.frequency.setValueAtTime(987.77, now + 0.08); // B5
      gain2.gain.setValueAtTime(0, now);
      gain2.gain.setValueAtTime(0.35, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc1.connect(gain1);
      gain1.connect(masterGain);
      osc2.connect(gain2);
      gain2.connect(masterGain);

      osc1.start(now);
      osc1.stop(now + 0.55);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.75);
      break;
    }

    case "crisp_ding": {
      // High-clarity crystal ping with harmonic shimmer
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(1046.5, now); // C6
      overtone.type = "triangle";
      overtone.frequency.setValueAtTime(2093, now); // C7

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      overtone.connect(gain);
      gain.connect(masterGain);

      osc.start(now);
      overtone.start(now);
      osc.stop(now + 0.65);
      overtone.stop(now + 0.65);
      break;
    }

    case "soft_bell": {
      // 3-note melodic triad (C5 - E5 - G5)
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noteStart = now + index * 0.06;

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, noteStart);

        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.25, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.6);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(noteStart);
        osc.stop(noteStart + 0.65);
      });
      break;
    }

    case "subtle_pop": {
      // Quick organic bubble pop
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now);
      osc.stop(now + 0.15);
      break;
    }

    case "radar_pulse": {
      // High-tech dual pulse alert
      [0, 0.12].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const pulseStart = now + offset;

        osc.type = "square";
        osc.frequency.setValueAtTime(880, pulseStart);

        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.12, pulseStart);
        gain.gain.exponentialRampToValueAtTime(0.001, pulseStart + 0.08);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(pulseStart);
        osc.stop(pulseStart + 0.09);
      });
      break;
    }

    case "gentle_swoosh": {
      // Ambient swept alert tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.18);
      osc.frequency.exponentialRampToValueAtTime(480, now + 0.4);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now);
      osc.stop(now + 0.55);
      break;
    }
  }
}
