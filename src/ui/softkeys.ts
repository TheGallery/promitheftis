import type { CueArg, Moment } from './cues';

/** What a sound is made with: the audio context, where it goes, and a buffer of white noise. */
export interface Voice {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

const jitter = (x: number, pct: number) => x * (1 + (Math.random() * 2 - 1) * pct);

interface BurstOptions {
  f?: number;
  f2?: number;
  q?: number;
  type?: BiquadFilterType;
  dur?: number;
  gain?: number;
  attack?: number;
}

/** A short puff of filtered noise: the "click" part of a key. */
function burst({ ctx, out, noise }: Voice, t: number, o: BurstOptions): void {
  const { f = 2000, f2, q = 1, type = 'bandpass', dur = 0.03, gain = 0.3, attack = 0.002 } = o;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(f, t);
  if (f2) filt.frequency.exponentialRampToValueAtTime(f2, t + attack + dur);
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  src.connect(filt).connect(g).connect(out);
  src.start(t, Math.random() * 0.5, attack + dur + 0.02);
}

interface ToneOptions {
  f?: number;
  f2?: number;
  dur?: number;
  gain?: number;
  attack?: number;
}

/** A pitched sound: a soft attack, then a fade. */
function tone({ ctx, out }: Voice, t: number, o: ToneOptions): void {
  const { f = 440, f2, dur = 0.1, gain = 0.2, attack = 0.004 } = o;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f, t);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + attack + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + attack + dur + 0.03);
}

/**
 * The Soft keys set: gentle keyboard clicks, a filtered-noise click over a low
 * "thock". ENTER is deeper, an order finishing is two thocks and a faint high ting.
 */
const SOFT_KEYS: Record<Moment, (v: Voice, t: number, arg: CueArg) => void> = {
  move(v, t) {
    burst(v, t, { f: jitter(2500, 0.08), q: 0.9, dur: 0.028, gain: 0.3 });
    tone(v, t, { f: jitter(190, 0.05), f2: 120, dur: 0.045, gain: 0.16 });
  },
  tab(v, t) {
    burst(v, t, { f: 1500, q: 0.8, dur: 0.045, gain: 0.38 });
    tone(v, t, { f: 130, f2: 80, dur: 0.07, gain: 0.3 });
    burst(v, t + 0.055, { f: 2400, q: 1, dur: 0.02, gain: 0.14 });
  },
  digit(v, t) {
    burst(v, t, { f: jitter(3200, 0.07), q: 1, dur: 0.022, gain: 0.24 });
    tone(v, t, { f: 240, f2: 160, dur: 0.03, gain: 0.08 });
  },
  nudge(v, t, arg) {
    const up = (arg.dir ?? 1) > 0;
    burst(v, t, { f: up ? 2900 : 2100, q: 0.9, dur: 0.026, gain: 0.26 });
    tone(v, t, { f: up ? 220 : 165, f2: up ? 150 : 110, dur: 0.04, gain: 0.12 });
  },
  confirm(v, t) {
    tone(v, t, { f: 130, f2: 70, dur: 0.09, gain: 0.42 });
    burst(v, t, { f: 1200, q: 0.7, dur: 0.06, gain: 0.4 });
    burst(v, t + 0.07, { f: 2200, q: 1, dur: 0.02, gain: 0.14 });
  },
  truck(v, t) {
    burst(v, t, { f: 1700, q: 0.8, dur: 0.04, gain: 0.32 });
    tone(v, t, { f: 150, f2: 100, dur: 0.06, gain: 0.3 });
    burst(v, t + 0.075, { f: 2600, q: 0.9, dur: 0.035, gain: 0.3 });
    tone(v, t + 0.075, { f: 210, f2: 140, dur: 0.05, gain: 0.22 });
  },
  finish(v, t) {
    burst(v, t, { f: 1300, q: 0.7, dur: 0.05, gain: 0.36 });
    tone(v, t, { f: 125, f2: 70, dur: 0.08, gain: 0.38 });
    burst(v, t + 0.09, { f: 1900, q: 0.8, dur: 0.05, gain: 0.34 });
    tone(v, t + 0.09, { f: 160, f2: 90, dur: 0.08, gain: 0.34 });
    tone(v, t + 0.12, { f: 1175, dur: 0.3, gain: 0.05, attack: 0.012 });
  },
  warn(v, t) {
    for (const dt of [0, 0.13]) {
      tone(v, t + dt, { f: dt ? 125 : 150, f2: dt ? 95 : 120, dur: 0.11, gain: 0.34, attack: 0.008 });
      burst(v, t + dt, { type: 'lowpass', f: 700, q: 0.7, dur: 0.05, gain: 0.14, attack: 0.006 });
    }
  },
  sheetOpen(v, t) {
    burst(v, t, { f: 700, f2: 2200, q: 0.6, dur: 0.14, gain: 0.16, attack: 0.03 });
    tone(v, t + 0.13, { f: 150, f2: 100, dur: 0.06, gain: 0.26 });
    burst(v, t + 0.13, { f: 1400, q: 0.8, dur: 0.035, gain: 0.24 });
  },
  sheetClose(v, t) {
    tone(v, t, { f: 140, f2: 95, dur: 0.06, gain: 0.24 });
    burst(v, t, { f: 1500, q: 0.8, dur: 0.035, gain: 0.22 });
    burst(v, t + 0.05, { f: 2200, f2: 700, q: 0.6, dur: 0.12, gain: 0.14, attack: 0.025 });
  },
};

/** Schedules one moment of the Soft keys set to start at time `t`. */
export function playSoftKey(moment: Moment, voice: Voice, t: number, arg: CueArg = {}): void {
  SOFT_KEYS[moment](voice, t, arg);
}
