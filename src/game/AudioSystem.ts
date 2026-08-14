import type { MaterialId } from './types';

export type AudioCue =
  | 'ui'
  | 'uiClick'
  | 'wood'
  | 'woodImpact'
  | 'metal'
  | 'metalImpact'
  | 'concrete'
  | 'concreteImpact'
  | 'glass'
  | 'glassBreak'
  | 'crack'
  | 'explosion'
  | 'spring'
  | 'cannon'
  | 'character'
  | 'characterImpact'
  | 'juice'
  | 'juiceSplat'
  | 'victory'
  | 'failure';

type ContextConstructor = new (options?: AudioContextOptions) => AudioContext;
type UnlockTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

function contextConstructor(): ContextConstructor | null {
  const browser = globalThis as typeof globalThis & {
    webkitAudioContext?: ContextConstructor;
  };
  return typeof AudioContext !== 'undefined'
    ? AudioContext
    : browser.webkitAudioContext ?? null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

/**
 * Tiny procedural sound engine. Every sound is synthesized with Web Audio, so
 * there are no downloads, licenses, decoders, or asset-loading failure modes.
 */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.8;
  private muted = false;
  private removeUnlockHandlers: (() => void) | null = null;

  constructor(initialVolume = 0.8) {
    this.volume = clamp(initialVolume, 0, 1);
  }

  get masterVolume(): number {
    return this.volume;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isUnlocked(): boolean {
    return this.context?.state === 'running';
  }

  /** Call from a pointer/key handler to satisfy browser autoplay rules. */
  async unlock(): Promise<boolean> {
    const context = this.ensureContext();
    if (!context) return false;
    try {
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch {
      return false;
    }
  }

  resume(): Promise<boolean> {
    return this.unlock();
  }

  /** Installs one-shot pointer and keyboard unlock listeners. */
  attachUnlock(target?: UnlockTarget): () => void {
    this.removeUnlockHandlers?.();
    const resolved = target ?? (typeof window !== 'undefined' ? window : null);
    if (!resolved) return () => undefined;

    const unlock = (): void => {
      void this.unlock();
      remove();
    };
    const remove = (): void => {
      resolved.removeEventListener('pointerdown', unlock as EventListener);
      resolved.removeEventListener('keydown', unlock as EventListener);
      if (this.removeUnlockHandlers === remove) this.removeUnlockHandlers = null;
    };
    resolved.addEventListener('pointerdown', unlock as EventListener, { once: true });
    resolved.addEventListener('keydown', unlock as EventListener, { once: true });
    this.removeUnlockHandlers = remove;
    return remove;
  }

  setMasterVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    this.applyMasterVolume();
  }

  setVolume(value: number): void {
    this.setMasterVolume(value);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterVolume();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  play(cue: AudioCue | string, intensity = 1): void {
    switch (cue) {
      case 'ui': case 'uiClick': this.uiClick(intensity); break;
      case 'wood': case 'woodImpact': this.impact('wood', intensity); break;
      case 'metal': case 'metalImpact': this.impact('metal', intensity); break;
      case 'concrete': case 'concreteImpact': this.impact('concrete', intensity); break;
      case 'glass': case 'glassBreak': this.impact('glass', intensity); break;
      case 'crack': this.crack(intensity); break;
      case 'explosion': this.explosion(intensity); break;
      case 'spring': this.spring(intensity); break;
      case 'cannon': this.cannon(intensity); break;
      case 'character': case 'characterImpact': this.characterImpact(intensity); break;
      case 'juice': case 'juiceSplat': this.juiceSplat(intensity); break;
      case 'victory': this.victory(); break;
      case 'failure': this.failure(); break;
      default: break;
    }
  }

  uiClick(intensity = 1): void {
    const now = this.time();
    if (now === null) return;
    this.tone(now, 0.055, 520 * this.pitch(0.035), 740, 'sine', 0.09 * intensity, 0.002);
  }

  impact(material: MaterialId, intensity = 1): void {
    const amount = clamp(intensity, 0.05, 2);
    const now = this.time();
    if (now === null) return;
    const pitch = this.pitch(0.12);

    switch (material) {
      case 'wood':
        this.noise(now, 0.1, 760 * pitch, 'bandpass', 1.1, 0.18 * amount);
        this.tone(now, 0.09, 150 * pitch, 95 * pitch, 'triangle', 0.14 * amount, 0.004);
        break;
      case 'metal':
        this.noise(now, 0.045, 2400 * pitch, 'highpass', 0.7, 0.08 * amount);
        this.tone(now, 0.34, 720 * pitch, 610 * pitch, 'sine', 0.1 * amount, 0.002);
        this.tone(now + 0.003, 0.22, 1280 * pitch, 1090 * pitch, 'sine', 0.055 * amount, 0.002);
        break;
      case 'concrete':
        this.noise(now, 0.16, 520 * pitch, 'lowpass', 0.8, 0.23 * amount);
        this.tone(now, 0.11, 82 * pitch, 48 * pitch, 'sine', 0.18 * amount, 0.003);
        break;
      case 'glass':
        this.noise(now, 0.18, 3400 * pitch, 'highpass', 1.5, 0.18 * amount);
        for (let i = 0; i < 4; i += 1) {
          const frequency = (1250 + i * 430 + Math.random() * 190) * pitch;
          this.tone(now + i * 0.012, 0.12 + i * 0.025, frequency, frequency * 0.82, 'sine', 0.045 * amount, 0.001);
        }
        break;
      case 'rubber':
        this.tone(now, 0.14, 260 * pitch, 95 * pitch, 'sine', 0.18 * amount, 0.003);
        this.tone(now + 0.035, 0.09, 390 * pitch, 210 * pitch, 'triangle', 0.07 * amount, 0.002);
        break;
      case 'plastic':
        this.noise(now, 0.045, 1800 * pitch, 'bandpass', 1.8, 0.12 * amount);
        this.tone(now, 0.055, 300 * pitch, 190 * pitch, 'square', 0.035 * amount, 0.001);
        break;
      case 'dirt':
        this.noise(now, 0.2, 380 * pitch, 'lowpass', 0.6, 0.2 * amount);
        break;
      case 'toy':
        this.tone(now, 0.08, 330 * pitch, 210 * pitch, 'triangle', 0.13 * amount, 0.002);
        this.noise(now, 0.035, 1300 * pitch, 'bandpass', 1.4, 0.06 * amount);
        break;
    }
  }

  /** Compatibility entry point used by the physics/material system. */
  playMaterial(material: MaterialId, event: 'impact' | 'break' = 'impact', intensity = 1): void {
    if (event === 'break') {
      if (material === 'glass') this.glassBreak(intensity);
      else {
        this.crack(intensity);
        this.impact(material, intensity * 0.65);
      }
      return;
    }
    this.impact(material, intensity);
  }

  woodImpact(intensity = 1): void { this.impact('wood', intensity); }
  metalImpact(intensity = 1): void { this.impact('metal', intensity); }
  concreteImpact(intensity = 1): void { this.impact('concrete', intensity); }
  glassBreak(intensity = 1): void { this.impact('glass', intensity); }

  crack(intensity = 1): void {
    const now = this.time();
    if (now === null) return;
    const amount = clamp(intensity, 0.05, 2);
    for (let i = 0; i < 4; i += 1) {
      this.noise(now + i * 0.025, 0.035, (900 + Math.random() * 900) * this.pitch(0.08), 'bandpass', 2.4, 0.1 * amount);
    }
  }

  explosion(intensity = 1): void {
    const now = this.time();
    if (now === null) return;
    const amount = clamp(intensity, 0.1, 2);
    this.noise(now, 0.7, 650, 'lowpass', 0.5, 0.34 * amount, 0.006);
    this.noise(now, 0.18, 1800, 'bandpass', 0.65, 0.19 * amount, 0.002);
    this.tone(now, 0.5, 92 * this.pitch(0.05), 28, 'sine', 0.3 * amount, 0.003);
  }

  spring(intensity = 1): void {
    const now = this.time();
    if (now === null) return;
    const pitch = this.pitch(0.09);
    this.tone(now, 0.18, 190 * pitch, 780 * pitch, 'triangle', 0.13 * intensity, 0.003);
    this.tone(now + 0.09, 0.15, 650 * pitch, 240 * pitch, 'sine', 0.075 * intensity, 0.002);
  }

  cannon(intensity = 1): void {
    const now = this.time();
    if (now === null) return;
    const amount = clamp(intensity, 0.1, 2);
    this.noise(now, 0.27, 900, 'lowpass', 0.55, 0.3 * amount, 0.002);
    this.tone(now, 0.26, 125 * this.pitch(0.05), 42, 'sine', 0.28 * amount, 0.002);
    this.noise(now + 0.075, 0.24, 420, 'lowpass', 0.5, 0.09 * amount, 0.01);
  }

  characterImpact(intensity = 1): void {
    const now = this.time();
    if (now === null) return;
    const pitch = this.pitch(0.16);
    this.tone(now, 0.12, 270 * pitch, 125 * pitch, 'triangle', 0.12 * intensity, 0.002);
    this.tone(now + 0.018, 0.09, 460 * pitch, 190 * pitch, 'sine', 0.055 * intensity, 0.002);
  }

  juiceSplat(intensity = 1): void {
    const now = this.time();
    if (now === null) return;
    const pitch = this.pitch(0.12);
    this.noise(now, 0.13, 620 * pitch, 'lowpass', 1.2, 0.14 * intensity, 0.002);
    this.tone(now, 0.15, 190 * pitch, 72 * pitch, 'sine', 0.13 * intensity, 0.003);
  }

  victory(): void {
    const now = this.time();
    if (now === null) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      this.tone(now + index * 0.11, index === notes.length - 1 ? 0.42 : 0.18, frequency, frequency * 1.01, 'triangle', 0.095, 0.006);
    });
  }

  failure(): void {
    const now = this.time();
    if (now === null) return;
    [392, 330, 247].forEach((frequency, index) => {
      this.tone(now + index * 0.16, 0.24, frequency * this.pitch(0.015), frequency * 0.88, 'triangle', 0.09, 0.005);
    });
  }

  dispose(): void {
    this.removeUnlockHandlers?.();
    this.removeUnlockHandlers = null;
    const context = this.context;
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    if (context && context.state !== 'closed') {
      try { void context.close(); } catch { /* already closed */ }
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context?.state === 'closed') {
      this.context = null;
      this.master = null;
      this.noiseBuffer = null;
    }
    if (this.context) return this.context;
    const Constructor = contextConstructor();
    if (!Constructor) return null;
    try {
      this.context = new Constructor({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.applyMasterVolume();
      return this.context;
    } catch {
      this.context = null;
      this.master = null;
      return null;
    }
  }

  private time(): number | null {
    const context = this.ensureContext();
    if (!context || !this.master || this.muted || this.volume <= 0) return null;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    return context.currentTime + 0.004;
  }

  private applyMasterVolume(): void {
    if (!this.master || !this.context) return;
    const value = this.muted ? 0 : this.volume;
    try {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.012);
    } catch {
      this.master.gain.value = value;
    }
  }

  private pitch(spread: number): number {
    return 1 + (Math.random() * 2 - 1) * spread;
  }

  private tone(
    start: number,
    duration: number,
    startFrequency: number,
    endFrequency: number,
    type: OscillatorType,
    gain: number,
    attack = 0.003,
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    try {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(attack, duration * 0.3));
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope).connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
    } catch {
      // Audio nodes can fail during context teardown; effects are best effort.
    }
  }

  private noise(
    start: number,
    duration: number,
    frequency: number,
    filterType: BiquadFilterType,
    q: number,
    gain: number,
    attack = 0.002,
  ): void {
    const context = this.context;
    const master = this.master;
    const buffer = this.getNoiseBuffer();
    if (!context || !master || !buffer) return;
    try {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = this.pitch(0.08);
      filter.type = filterType;
      filter.frequency.value = clamp(frequency, 30, context.sampleRate * 0.45);
      filter.Q.value = Math.max(0.01, q);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(attack, duration * 0.25));
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter).connect(envelope).connect(master);
      source.start(start, Math.random() * 0.15, duration);
      source.stop(start + duration + 0.015);
    } catch {
      // Ignore races with context suspension/disposal.
    }
  }

  private getNoiseBuffer(): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    const context = this.context;
    if (!context) return null;
    try {
      const length = Math.ceil(context.sampleRate);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const samples = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.18 + white * 0.82;
        samples[i] = previous;
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }
}

export const audioSystem = new AudioSystem();
export const audio = audioSystem;
export default audioSystem;
