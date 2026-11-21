import { ChannelState } from './channelState';
import { getSampleRate } from './common';

export class SineVoice {
  public active: boolean = false;
  public channel: number = 0;
  public velocity: number = 0;
  private note: number = 60;
  private chState!: ChannelState;
  private phase: number = 0;
  private freq: number = 440;
  private envTime: number = 0;
  private releasing: boolean = false;
  private releaseLevel: number = 1.0;
  private releaseSpeed: number = 3.0; 

  private dt: number = 0;

  constructor() {}

  public init(note: number, velocity: number, channel: number, chState: ChannelState, preset: number = 0) {
    this.note = note;
    this.velocity = velocity;
    this.channel = channel;
    this.chState = chState;
    this.active = true;
    this.releasing = false;
    this.phase = 0;
    this.envTime = 0;
    this.releaseLevel = 1.0;
    this.releaseSpeed = 3.0; 

    this.freq = 440 * Math.pow(2, (note - 69) * 0.083333);
    if (!isFinite(this.freq)) this.freq = 440;

    const sr = getSampleRate();
    this.dt = 1.0 / sr;
  }

  render(outL: Float32Array, outR: Float32Array, start: number, count: number): void {
    if (!this.active) return;

    const panVal = (this.chState.pan - 64) * 0.015625; 
    const clampedPan = Math.max(-1, Math.min(1, panVal));
    const panAngle = (clampedPan + 1) * 0.785398;
    const gainL = Math.cos(panAngle);
    const gainR = Math.sin(panAngle);

    const vol = (this.velocity * 0.007874) * this.chState.getGain() * 0.3; 
    const end = start + count;

    for (let i = start; i < end; i++) {
      let env = 1.0;
      if (this.releasing) {

        env = this.releaseLevel * Math.max(0, 1.0 - (this.envTime * this.releaseSpeed)); 
        if (env <= 0) {
          this.active = false;
          break;
        }
      } else {

        env = Math.min(1.0, this.envTime * 50); 
      }

      const s1 = Math.sin(this.phase * 6.28318);
      const s2 = Math.sin(this.phase * 12.56637) * 0.5;
      const sample = (s1 + s2) * env * vol;

      outL[i] += sample * gainL;
      if (outR) outR[i] += sample * gainR;

      this.phase += this.freq * this.dt;
      if (this.phase > 1) this.phase -= 1;
      this.envTime += this.dt;
    }
  }

  release(): void {
    if (!this.releasing) {
      this.releasing = true;
      this.envTime = 0;
      this.releaseLevel = 1.0; 
      this.releaseSpeed = 3.0; 

    }
  }

  forceRelease(): void {
    if (!this.releasing) {
        this.releasing = true;
        this.envTime = 0;
        this.releaseLevel = 1.0; 
    }

    this.releaseSpeed = 50.0;
  }

  releaseSustain(): void {
    this.release();
  }
}