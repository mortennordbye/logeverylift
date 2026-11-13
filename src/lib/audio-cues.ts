/**
 * Sound cues for the guided player (docs/plans/endurance-app.md, 3.5).
 *
 * iOS ignores the Vibration API, so the cue is sound plus the screen. Web
 * Audio beeps from an oscillator, no audio files. iOS plays Web Audio only
 * after a user gesture, so `unlockAudio` must run inside the Start (or
 * Resume) tap. Where the browser has `navigator.audioSession`, the type is
 * "transient": a cue lowers the user's music briefly instead of stopping it.
 * Whether a cue plays with the ring switch on silent depends on the device.
 *
 * Client only.
 */

export type CueKind = "count" | "change" | "work";

let ctx: AudioContext | null = null;

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** Make and resume the audio context. Call inside a tap. Returns false when the browser has no Web Audio. */
export function unlockAudio(): boolean {
  if (typeof window === "undefined") return false;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return false;
  try {
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session) session.type = "transient";
  } catch {
    // Older Safari: no audio session API. The default still plays.
  }
  try {
    ctx ??= new Ctor();
    void ctx.resume();
    // A silent buffer in the gesture finishes the unlock on iOS.
    const buffer = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
    return true;
  } catch {
    return false;
  }
}

/** True when a cue can play now. iOS suspends the context on an app switch or a call. */
export function audioReady(): boolean {
  return ctx !== null && ctx.state === "running";
}

const TONES: Record<CueKind, { hz: number[]; ms: number }> = {
  count: { hz: [880], ms: 90 },
  change: { hz: [1320], ms: 320 },
  work: { hz: [990, 1320], ms: 180 },
};

/** Play one cue. Returns false when sound is not available, so the screen can say so. */
export function playCue(kind: CueKind): boolean {
  if (!ctx || ctx.state !== "running") return false;
  try {
    const t0 = ctx.currentTime;
    const { hz, ms } = TONES[kind];
    hz.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const start = t0 + (i * ms) / 1000;
      const end = start + ms / 1000;
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    });
    return true;
  } catch {
    return false;
  }
}
