/**
 * Scan / success feedback. Sound and vibration are progressive enhancements:
 * iOS Safari does not support navigator.vibrate, so the UI never depends on it.
 */
let audioCtx: AudioContext | null = null;
const audioListeners = new Set<() => void>();
const notifyAudio = () => audioListeners.forEach((fn) => fn());

function context(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      audioCtx.onstatechange = notifyAudio;
    }
    return audioCtx;
  } catch {
    audioCtx = null;
    return null;
  }
}

/**
 * Must be called from a user gesture once (iOS unlocks audio on interaction).
 * Also asks Safari to treat the page as media playback, so the alert still
 * plays with the iPad's silent switch on.
 */
export function primeAudio(): void {
  try {
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== "playback") session.type = "playback";
  } catch {
    // older Safari
  }
  const ctx = context();
  if (!ctx) return;
  if (ctx.state !== "running") void ctx.resume().then(notifyAudio, () => undefined);
  try {
    // A silent sound inside the gesture finishes the unlock on older iOS.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start();
  } catch {
    // audio unavailable
  }
}

let keepingAlive = false;
/**
 * Keeps the order sound on without a button. Where the device allows sound
 * without a tap it is on at once; otherwise the first tap anywhere unlocks
 * it, and any later tap brings it back after the iPad slept or the tab was
 * in the background. Safe to call many times.
 */
export function keepAudioAlive(): void {
  if (keepingAlive || typeof window === "undefined") return;
  keepingAlive = true;
  // Try right away: the iOS app (and Chrome once the site is installed) lets
  // sound play without a tap. Elsewhere it stays off until the first tap.
  primeAudio();
  const wake = () => {
    if (!isAudioReady()) primeAudio();
  };
  for (const type of ["pointerdown", "touchend", "keydown"]) window.addEventListener(type, wake, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && audioCtx && audioCtx.state !== "running") void audioCtx.resume().then(notifyAudio, () => undefined);
  });
}

/** Calls `fn` whenever the sound turns on or off; returns the unsubscribe. */
export function onAudioChange(fn: () => void): () => void {
  audioListeners.add(fn);
  return () => audioListeners.delete(fn);
}

export function beep(frequency = 1046, durationMs = 120): void {
  try {
    const ctx = context();
    if (!ctx) return;
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

let loudOut: AudioNode | null = null;
/** A compressor that keeps the chime close to full volume without crackling. */
function loudOutput(ctx: AudioContext): AudioNode {
  if (!loudOut) {
    const compressor = ctx.createDynamicsCompressor();
    // A limiter, then make-up gain: measured offline, the chime peaks just
    // under full scale (-0.7 dB) and averages about 21 dB above the old one.
    // More gain clips (crackles) instead of getting louder.
    compressor.threshold.value = -10;
    compressor.knee.value = 4;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    const gain = ctx.createGain();
    gain.gain.value = 1.3;
    compressor.connect(gain).connect(ctx.destination);
    loudOut = compressor;
  }
  return loudOut;
}

/** One loud note: a bright square wave plus the octave above, held at full level. */
function loudNote(ctx: AudioContext, frequency: number, at: number, seconds: number): void {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(0.9, at + 0.008);
  env.gain.setValueAtTime(0.9, at + seconds - 0.05);
  env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  env.connect(loudOutput(ctx));
  for (const [type, mult, level] of [["square", 1, 0.55], ["sine", 2, 0.45]] as const) {
    const osc = ctx.createOscillator();
    const mix = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency * mult;
    mix.gain.value = level;
    osc.connect(mix).connect(env);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }
}

/**
 * New-order alert, as loud as the device allows: high notes (small speakers
 * carry them best), three times over, about three seconds in all.
 */
export function orderChime(): void {
  vibrate([200, 100, 200, 100, 200]);
  const ctx = context();
  if (!ctx) return;
  if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
  try {
    const start = ctx.currentTime + 0.05;
    const notes = [1047, 1319, 1568, 2093];
    for (let round = 0; round < 3; round++) {
      notes.forEach((f, i) => loudNote(ctx, f, start + round * 1.05 + i * 0.19, 0.17));
    }
  } catch {
    // audio unavailable
  }
}

export function isAudioReady(): boolean {
  return audioCtx !== null && audioCtx.state === "running";
}
