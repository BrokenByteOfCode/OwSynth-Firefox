import { SF2Layer } from '../types';
import { ChannelState } from './channelState';
import { getSampleRate } from './common';

const EXP_DECAY_CONST = -11.5129;

const FAST_RELEASE_RATE = 0.90;
const PIANO_RELEASE_RATE = 0.9995;

export class SF2Voice {
  private layer!: SF2Layer;

  private note: number = 60;
  public velocity: number = 0;
  public channel: number = 0;
  private chState!: ChannelState;
  private isDrum: boolean = false;
  private isPiano: boolean = false;
  private pos: number = 0.0;
  public active: boolean = false;
  private pendingRelease: boolean = false;

  private envPhase: number = 0;
  private envLevel: number = 0.0;

  private attackStep: number = 0;
  private holdSamples: number = 0;
  private decayRate: number = 0;
  private sustainLevel: number = 0;
  private releaseRate: number = 0;

  private currentPhaseSamples: number = 0;

  private basePitch: number = 0;
  private instGain: number = 0;
  private basePan: number = 0;
  private dlen: number = 0;
  private looping: boolean = false;
  private lStart: number = 0;
  private lEnd: number = 0;
  private lLen: number = 0;

  constructor() { }

  public init(layer: SF2Layer, note: number, velocity: number, channel: number, chState: ChannelState, preset: number) {
    this.layer = layer;
    this.note = note;
    this.velocity = velocity;
    this.channel = channel;
    this.chState = chState;
    this.isDrum = (channel === 9);

    this.isPiano = !this.isDrum && (preset >= 0 && preset <= 7);

    this.active = true;
    this.pendingRelease = false;
    this.pos = 0.0;
    this.envPhase = 0;
    this.envLevel = 0.0;
    this.currentPhaseSamples = 0;

    const sr = getSampleRate();

    this.basePitch = note - layer.rootKey + (layer.correction / 100.0);

    const attnGain = Math.pow(10.0, -layer.attenuation / 200.0);
    const velGain = (velocity * velocity) / 16129.0;

    this.instGain = velGain * attnGain;

    this.basePan = Math.max(-1.0, Math.min(1.0, layer.pan / 500.0));

    this.dlen = layer.rawData.length;
    this.looping = [1, 3].includes(layer.loopMode) && layer.loopEnd > layer.loopStart && !this.isDrum;
    this.lStart = layer.loopStart;
    this.lEnd = layer.loopEnd;
    this.lLen = Math.max(1, this.lEnd - this.lStart);

    let attTime = Math.max(0.001, layer.volAttack);
    this.attackStep = 1.0 / (attTime * sr);

    let holdTime = Math.max(0.0, layer.volHold);
    this.holdSamples = Math.floor(holdTime * sr);

    let decTime = Math.max(0.001, layer.volDecay);
    this.decayRate = Math.exp(EXP_DECAY_CONST / (decTime * sr));

    this.sustainLevel = Math.max(0.0, Math.min(1.0, layer.volSustain));

    let relTime = Math.max(0.001, layer.volRelease);
    this.releaseRate = Math.exp(EXP_DECAY_CONST / (relTime * sr));
  }

  render(outL: Float32Array, outR: Float32Array, start: number, count: number): void {
    if (!this.active) return;

    const cp = this.chState.getPan();
    const finalPan = this.basePan + cp;
    const theta = (Math.max(-1.0, Math.min(1.0, finalPan)) + 1.0) * 0.785398;
    const gainL = Math.cos(theta);
    const gainR = Math.sin(theta);
    const totalGain = this.instGain * this.chState.getGain();

    const pitchShift = this.basePitch + this.chState.pitchBend;
    const currentSampleRate = getSampleRate();
    const ratio = Math.pow(2.0, pitchShift * 0.083333) * (this.layer.sampleRate / currentSampleRate);

    if (!isFinite(ratio) || ratio <= 0) {
      this.active = false;
      return;
    }

    const data = this.layer.rawData;
    const end = start + count;

    for (let i = start; i < end; i++) {
      if (!this.active) break;

      if (this.envPhase === 0) {

        this.envLevel += this.attackStep;
        if (this.envLevel >= 1.0) {
          this.envLevel = 1.0;
          this.envPhase = 1;
          this.currentPhaseSamples = 0;
        }
      } else if (this.envPhase === 1) {

        this.currentPhaseSamples++;
        if (this.currentPhaseSamples >= this.holdSamples) {
          this.envPhase = 2;
        }
      } else if (this.envPhase === 2) {

        this.envLevel *= this.decayRate;
        if (this.envLevel <= this.sustainLevel) {
          this.envLevel = this.sustainLevel;
          this.envPhase = 3;
        }
      } else if (this.envPhase === 3) {

        this.envLevel = this.sustainLevel;
      } else if (this.envPhase === 4) {

        this.envLevel *= this.releaseRate;
        if (this.envLevel < 0.00001) {
          this.envLevel = 0;
          this.active = false;
        }
      }

      const iPos = this.pos | 0;
      let sample = 0.0;
      if (iPos >= 0 && iPos < this.dlen) {
        const s1 = data[iPos];
        const s2 = (iPos + 1 < this.dlen) ? data[iPos + 1] : s1;
        sample = (s1 + (s2 - s1) * (this.pos - iPos)) * 0.000030517;
      }

      const finalSample = sample * this.envLevel * totalGain;
      outL[i] += finalSample * gainL;
      if (outR) outR[i] += finalSample * gainR;

      this.pos += ratio;

      if (this.looping) {
        if (this.pos >= this.lEnd) {
          this.pos = this.lStart + ((this.pos - this.lStart) % this.lLen);
        }
      } else {
        if (this.pos >= this.dlen) {
          this.active = false;
          break;
        }
      }
    }
  }

  release(): void {
    if (this.isDrum) return;
    if (this.envPhase < 4) {
      if (this.chState.sustain) {
        this.pendingRelease = true;
      } else {
        this.envPhase = 4;
      }
    }
  }

  forceRelease(): void {
    this.pendingRelease = false;
    this.envPhase = 4;

    if (this.isPiano) {
      this.releaseRate = PIANO_RELEASE_RATE;
    } else {
      this.releaseRate = FAST_RELEASE_RATE;
    }
  }

  releaseSustain(): void {
    if (this.pendingRelease) {
      this.pendingRelease = false;
      this.envPhase = 4;
    }
  }
}