/**
 * The receipt printer heard when an order is placed: a card machine's stepper
 * whine pulsing with each dot line over the thermal head's hiss, a paper rip
 * when the receipt tears off, and a soft brush when it opens or folds away.
 * Made with Web Audio, so there is no file to load. It plays as "ambient"
 * audio: quiet, mixed with the customer's music, and silent when the iPhone's
 * silent switch is on.
 */

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

type WithAudioSession = Navigator & { audioSession?: { type: string } };
type WithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const session = (navigator as WithAudioSession).audioSession;
      if (session) session.type = "ambient";
      const Ctor = window.AudioContext ?? (window as WithWebkitAudio).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** Browsers start sound only from a tap: call this from the tap that places the order. */
export function unlockPrinterSound(): void {
  audio();
}

/** One burst of printing, `ms` long: the motor spins up, holds its pitch and slows as it stops. */
export function printBurst(ms: number): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.005;
  const end = t + ms / 1000;
  const out = c.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.16, t + 0.03);
  out.gain.setValueAtTime(0.16, end - 0.04);
  out.gain.linearRampToValueAtTime(0, end);
  // Each dot line: the whine swells and dips about 16 times a second.
  const pulse = c.createGain();
  pulse.gain.value = 0.7;
  const lfo = c.createOscillator();
  lfo.frequency.value = 16;
  const depth = c.createGain();
  depth.gain.value = 0.3;
  lfo.connect(depth).connect(pulse.gain);
  const tone = c.createBiquadFilter();
  tone.type = "bandpass";
  tone.frequency.value = 2200;
  tone.Q.value = 0.8;
  const base = 1180 + Math.random() * 60;
  const voices: [OscillatorType, number, number][] = [
    ["sawtooth", 1, 0.55],
    ["square", 2.003, 0.18],
    ["triangle", 0.5, 0.35],
  ];
  for (const [type, mul, volume] of voices) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(base * mul * 0.6, t);
    o.frequency.exponentialRampToValueAtTime(base * mul, t + 0.07);
    o.frequency.setValueAtTime(base * mul, end - 0.05);
    o.frequency.exponentialRampToValueAtTime(base * mul * 0.75, end);
    const g = c.createGain();
    g.gain.value = volume;
    o.connect(g).connect(tone);
    o.start(t);
    o.stop(end + 0.02);
  }
  tone.connect(pulse);
  const head = c.createBufferSource();
  head.buffer = noise(c);
  const hiss = c.createBiquadFilter();
  hiss.type = "highpass";
  hiss.frequency.value = 4500;
  const hissLevel = c.createGain();
  hissLevel.gain.value = 0.35;
  head.connect(hiss).connect(hissLevel).connect(pulse);
  pulse.connect(out).connect(c.destination);
  head.start(t, Math.random(), ms / 1000 + 0.02);
  lfo.start(t);
  lfo.stop(end + 0.02);
}

/** The receipt tearing off: tiny crackles, loud first. */
export function tearSound(): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.005;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3200;
  band.Q.value = 0.6;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  for (let k = 0; k < 40; k++) g.gain.setValueAtTime(Math.random() * 0.4 * (1 - k / 40), t + k * 0.006);
  g.gain.setValueAtTime(0, t + 0.25);
  src.connect(band).connect(g).connect(c.destination);
  src.start(t, Math.random(), 0.26);
}

/** Paper sliding, when the receipt opens or folds away. */
export function paperSound(): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.005;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.5;
  band.frequency.setValueAtTime(1800, t);
  band.frequency.linearRampToValueAtTime(3400, t + 0.3);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.08);
  g.gain.linearRampToValueAtTime(0, t + 0.34);
  src.connect(band).connect(g).connect(c.destination);
  src.start(t, Math.random(), 0.36);
}
