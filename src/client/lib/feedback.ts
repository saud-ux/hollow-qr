/**
 * Scan / success feedback. Sound and vibration are progressive enhancements:
 * iOS Safari does not support navigator.vibrate, so the UI never depends on it.
 */
let audioCtx: AudioContext | null = null;

/** Must be called from a user gesture once (iOS unlocks audio on interaction). */
export function primeAudio(): void {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

export function beep(frequency = 1046, durationMs = 120): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
  } catch {
    // audio unavailable
  }
}

export function vibrate(pattern: number | number[] = 60): void {
  try {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    // unsupported
  }
}

export function successFeedback(): void {
  beep(1046, 110);
  setTimeout(() => beep(1318, 140), 120);
  vibrate([40, 30, 40]);
}

export function errorFeedback(): void {
  beep(330, 220);
  vibrate(200);
}
