import { allowCue, type CueArg, type Moment } from './cues';
import { playSoftKey } from './softkeys';

/** The loudness the key sounds start at: a volume of 0.40 on the curve gain = volume^1.6. */
const KEY_VOLUME = Math.pow(0.4, 1.6);

/**
 * Soft key clicks and the dot-matrix printer, made in code with Web Audio so
 * there are no sound files to license. The audio context is created on the
 * first key press, as browsers require.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private readonly lastCue = new Map<Moment, number>();
  enabled = true;

  private context(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      // The key sounds go through a master volume and a gentle limiter.
      this.master = this.ctx.createGain();
      this.master.gain.value = KEY_VOLUME;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -20;
      limiter.knee.value = 12;
      limiter.ratio.value = 4;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      this.master.connect(limiter).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /** The sound of one moment of play, in the Soft keys set. A quick repeat of the same moment is dropped. */
  cue(moment: Moment, arg: CueArg = {}): void {
    const ctx = this.context();
    if (!ctx || !this.noise || !this.master) return;
    if (!allowCue(this.lastCue, moment, performance.now() / 1000)) return;
    playSoftKey(moment, { ctx, out: this.master, noise: this.noise }, ctx.currentTime, arg);
  }

  /**
   * A dot-matrix printer working through `lines` lines: each line is a buzzing
   * pass of the head, a thud as it swings back, and a tick of the paper feed.
   * Returns how long it runs, in milliseconds.
   */
  print(lines: number): number {
    const perLine = 0.34;
    const total = lines * perLine;
    const ctx = this.context();
    if (!ctx || !this.noise) return total * 1000;
    const start = ctx.currentTime + 0.05;
    for (let i = 0; i < lines; i++) {
      const t = start + i * perLine;
      const pass = perLine * 0.72;

      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(2300, t);
      band.frequency.linearRampToValueAtTime(3100, t + pass);
      band.Q.value = 1.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.01);
      gain.gain.setValueAtTime(0.16, t + pass - 0.015);
      gain.gain.linearRampToValueAtTime(0, t + pass);
      // The pins firing: the noise is chopped at about 90 times a second.
      const chop = ctx.createOscillator();
      chop.type = 'square';
      chop.frequency.value = 88;
      const chopDepth = ctx.createGain();
      chopDepth.gain.value = 0.08;
      chop.connect(chopDepth).connect(gain.gain);
      src.connect(band).connect(gain).connect(ctx.destination);
      src.start(t);
      src.stop(t + pass);
      chop.start(t);
      chop.stop(t + pass);

      const buzz = ctx.createOscillator();
      buzz.type = 'sawtooth';
      buzz.frequency.setValueAtTime(190, t);
      buzz.frequency.linearRampToValueAtTime(240, t + pass);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.03, t);
      bg.gain.linearRampToValueAtTime(0, t + pass);
      buzz.connect(bg).connect(ctx.destination);
      buzz.start(t);
      buzz.stop(t + pass);

      const thud = ctx.createOscillator();
      const tg = ctx.createGain();
      thud.frequency.setValueAtTime(140, t + pass);
      thud.frequency.exponentialRampToValueAtTime(60, t + pass + 0.07);
      tg.gain.setValueAtTime(0.2, t + pass);
      tg.gain.exponentialRampToValueAtTime(0.0005, t + pass + 0.08);
      thud.connect(tg).connect(ctx.destination);
      thud.start(t + pass);
      thud.stop(t + pass + 0.09);
    }
    return total * 1000;
  }
}
