import { MidiEvent } from '../types';
import { SF2Parser } from '../sf2Parser';
import { ChannelState } from './channelState';
import { SineVoice } from './sineVoice';
import { SF2Voice } from './sf2Voice';
import { getSampleRate } from './common';

type AnyVoice = SF2Voice | SineVoice;
const MAX_VOICES = 64;

export class SynthEngine {

  private sf2: SF2Parser | null = null;
  private voices: AnyVoice[] = [];

  private sf2Pool: SF2Voice[] = [];
  private sinePool: SineVoice[] = [];

  private activeNotes: Map<string, AnyVoice[]> = new Map();
  private programs: number[] = new Array(16).fill(0);
  private banks: number[] = new Array(16).fill(0);
  private channels: ChannelState[] = [];
  private tempoMap: { tick: number, micros: number }[] = [];

  private currentTick: number = 0.0;
  private currentTime: number = 0.0;
  private ticksPerBeat: number = 480;
  private microsPerBeat: number = 500000;
  private samplesPerTick: number = 0;
  private currentBpm: number = 120;

  private eventQueue: MidiEvent[] = [];
  private eventIndex: number = 0;

  private isPlaying: boolean = false;
  private useSineWave: boolean = false;
  private masterVolume: number = 0.5;

  private port: MessagePort;
  private debugCounter: number = 0;

  constructor(port: MessagePort) {
    this.port = port;
    for (let i = 0; i < 16; i++) {
      this.channels.push(new ChannelState());
      this.banks[i] = i === 9 ? 128 : 0;
    }

    for (let i = 0; i < 32; i++) {
      this.sf2Pool.push(new SF2Voice());
      this.sinePool.push(new SineVoice());
    }
  }

  private acquireSF2Voice(): SF2Voice {
    if (this.sf2Pool.length > 0) return this.sf2Pool.pop()!;
    return new SF2Voice();
  }

  private acquireSineVoice(): SineVoice {
    if (this.sinePool.length > 0) return this.sinePool.pop()!;
    return new SineVoice();
  }

  private releaseVoice(v: AnyVoice) {
    if (v instanceof SF2Voice) this.sf2Pool.push(v);
    else if (v instanceof SineVoice) this.sinePool.push(v);
  }

  public setVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
  }

  public loadSF2Data(data: ArrayBuffer): void {
    try {
      console.log('[SynthEngine] Loading SF2 data, size:', data.byteLength);
      this.sf2 = new SF2Parser(data);
      this.useSineWave = false;
      console.log('[SynthEngine] ✓ SF2 Loaded Successfully, useSineWave set to:', this.useSineWave);
      this.port.postMessage({ type: 'STATUS_UPDATE', payload: { log: 'SF2 Loaded Successfully' } });
    } catch (e) {
      this.useSineWave = true;
      this.sf2 = null;
      console.error('[SynthEngine] ✗ SF2 Load Failed:', e);
      this.port.postMessage({ type: 'STATUS_UPDATE', payload: { log: 'SF2 Load Failed, using Sine' } });
    }
  }

  public setUseSineWave(use: boolean): void {
    this.useSineWave = use;
    console.log('[SynthEngine] UseSineWave set to:', use);
  }

  public loadEvents(events: MidiEvent[], division: number): void {
    console.log('[SynthEngine] Loading events, count:', events.length, 'division:', division);
    this.eventQueue = events;
    this.ticksPerBeat = (division && division > 0) ? division : 480;
    this.microsPerBeat = 500000;

    this.tempoMap = [{ tick: 0, micros: 500000 }];
    for (const ev of events) {
      if (ev.type === 'meta' && ev.meta_type === 0x51 && ev.params?.micros) {
        this.tempoMap.push({ tick: ev.tick, micros: ev.params.micros });
      }
    }

    this.tempoMap.sort((a, b) => a.tick - b.tick);

    this.updateTiming();
    this.eventIndex = 0;
    this.currentTick = 0;
    this.currentTime = 0;

    this.cutAllVoices();
    this.notifyBpm(120);

    this.programs.fill(0);
    this.channels = [];
    for (let i = 0; i < 16; i++) {
      this.channels.push(new ChannelState());
      this.banks[i] = i === 9 ? 128 : 0;
    }
  }

  private cutAllVoices() {
    if (this.voices.length > 0) {
      console.log('[SynthEngine] Cutting all voices, count:', this.voices.length);
    }
    this.voices.forEach(v => {
      v.active = false;
      this.releaseVoice(v);
    });
    this.voices = [];
    this.activeNotes.clear();
  }

  private silenceAllVoices() {
    this.voices.forEach(v => v.forceRelease());
    this.activeNotes.clear();
  }

  private updateTiming(): void {
    const sr = getSampleRate();
    const samplesPerBeat = (this.microsPerBeat / 1000000.0) * sr;
    this.samplesPerTick = samplesPerBeat / this.ticksPerBeat;

    if (isNaN(this.samplesPerTick) || !isFinite(this.samplesPerTick) || this.samplesPerTick <= 0) {
      this.samplesPerTick = 100;
    }

    const bpm = Math.round(60000000 / this.microsPerBeat);
    if (this.currentBpm !== bpm) {
      this.currentBpm = bpm;
      this.notifyBpm(bpm);
    }
  }

  private notifyBpm(bpm: number): void {
    this.port.postMessage({ type: 'BPM_UPDATE', payload: bpm });
  }

  public play(): void {
    console.log('[SynthEngine] Play called, events:', this.eventQueue.length, 'isPlaying:', this.isPlaying);
    if (this.eventQueue.length === 0) {
      console.warn('[SynthEngine] Cannot play: eventQueue is empty');
      return;
    }
    this.isPlaying = true;
    this.port.postMessage({ type: 'STATUS_UPDATE', payload: { log: 'Playback started' } });
  }

  public pause(): void {
    this.isPlaying = false;

    this.silenceAllVoices();
    this.port.postMessage({ type: 'STATUS_UPDATE', payload: { log: 'Paused' } });
  }

  public stop(): void {
    console.log('[SynthEngine] Stop called. EventIndex:', this.eventIndex, 'Voices:', this.voices.length);
    this.isPlaying = false;
    this.silenceAllVoices();

    this.eventIndex = 0;
    this.currentTick = 0;
    this.currentTime = 0;
    this.microsPerBeat = 500000;
    this.updateTiming();

    for (const ch of this.channels) {
      ch.sustain = false;
      ch.pitchBend = 0;
      ch.volume = 100;
      ch.expression = 127;
      ch.pan = 64;
    }

    this.port.postMessage({ type: 'STATUS_UPDATE', payload: { log: 'Stopped' } });
  }

  private tickToTime(targetTick: number): number {
    let t = 0;
    let lastTick = 0;
    let currentMicros = 500000;

    for (const tm of this.tempoMap) {
      if (tm.tick >= targetTick) break;
      const dt = tm.tick - lastTick;
      t += (dt / this.ticksPerBeat) * (currentMicros / 1000000.0);
      lastTick = tm.tick;
      currentMicros = tm.micros;
    }

    const remainingTicks = targetTick - lastTick;
    t += (remainingTicks / this.ticksPerBeat) * (currentMicros / 1000000.0);
    return t;
  }

  public seek(tick: number): void {
    this.currentTick = tick;
    this.currentTime = this.tickToTime(tick);

    this.eventIndex = 0;
    this.microsPerBeat = 500000;

    this.cutAllVoices();

    let scanIdx = 0;
    while (scanIdx < this.eventQueue.length) {
      const ev = this.eventQueue[scanIdx];
      if (ev.tick >= tick) {
        this.eventIndex = scanIdx;
        break;
      }

      if (ev.type === 'meta' && ev.meta_type === 0x51 && ev.params?.micros) {
        this.microsPerBeat = ev.params.micros;
      }

      if (ev.type === 'program_change' && ev.params?.program !== undefined && ev.channel !== undefined) {
        this.programs[ev.channel] = ev.params.program;
      }
      if (ev.type === 'control_change' && ev.params && ev.channel !== undefined) {
        const cc = ev.params.cc;
        const val = ev.params.value || 0;
        if (cc === 0 && ev.channel !== 9) this.banks[ev.channel] = val;
        if (cc === 7) this.channels[ev.channel].volume = val;
        if (cc === 10) this.channels[ev.channel].pan = val;
      }

      scanIdx++;
    }
    this.updateTiming();

    this.port.postMessage({
      type: 'STATUS_UPDATE',
      payload: { tick: this.currentTick, time: this.currentTime, activeVoices: 0 }
    });
  }

  public process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const outL = outputs[0][0];
    const outR = outputs[0][1];

    if (!outL) return true;

    const blockSize = outL.length;

    outL.fill(0);
    if (outR) outR.fill(0);

    const safeOutR = outR || new Float32Array(blockSize);

    if (!this.isPlaying) {
      if (this.voices.length > 0) {
        this.renderVoices(outL, safeOutR, 0, blockSize);
        this.applyMasterEffects(outL, safeOutR, blockSize);
        this.cullVoices();
      }
      return true;
    }

    let framesRendered = 0;

    while (framesRendered < blockSize) {

      let framesUntilNextEvent = blockSize - framesRendered;

      if (this.eventIndex < this.eventQueue.length) {
        const nextEvent = this.eventQueue[this.eventIndex];
        const ticksUntilEvent = nextEvent.tick - this.currentTick;

        if (ticksUntilEvent <= 0) {
          framesUntilNextEvent = 0;
        } else {
          const samplesUntil = Math.floor(ticksUntilEvent * this.samplesPerTick);
          if (samplesUntil < framesUntilNextEvent) {
            framesUntilNextEvent = samplesUntil;
          }
        }
      }

      if (framesUntilNextEvent > 0) {
        const renderCount = Math.min(framesUntilNextEvent, blockSize - framesRendered);

        this.renderVoices(outL, safeOutR, framesRendered, renderCount);

        framesRendered += renderCount;
        this.currentTick += renderCount / this.samplesPerTick;
        this.currentTime += renderCount / getSampleRate();
      }

      if (framesRendered < blockSize && this.eventIndex < this.eventQueue.length) {
        const nextEvent = this.eventQueue[this.eventIndex];

        if (nextEvent.tick <= this.currentTick + 0.1) {
          this.processEvent(nextEvent);
          this.eventIndex++;
        } else {

          this.renderVoices(outL, safeOutR, framesRendered, 1);
          framesRendered++;
          this.currentTick += 1.0 / this.samplesPerTick;
          this.currentTime += 1.0 / getSampleRate();
        }
      } else if (framesRendered < blockSize) {

        const rest = blockSize - framesRendered;
        this.renderVoices(outL, safeOutR, framesRendered, rest);
        this.currentTick += rest / this.samplesPerTick;
        this.currentTime += rest / getSampleRate();
        framesRendered += rest;
      }
    }

    this.applyMasterEffects(outL, safeOutR, blockSize);
    this.cullVoices();
    this.sendDebugStatus();

    if (this.eventIndex >= this.eventQueue.length && this.voices.length === 0) {
      console.log('[SynthEngine] Auto-stopping: queue finished and no active voices');
      this.stop();
      this.port.postMessage({ type: 'STOP' });
    }

    return true;
  }

  private applyMasterEffects(outL: Float32Array, outR: Float32Array, count: number) {
    const voiceScale = 1.0 / (1.0 + Math.sqrt(this.voices.length) * 0.15);
    const finalVol = this.masterVolume * voiceScale;

    for (let i = 0; i < count; i++) {
      outL[i] = Math.tanh(outL[i] * finalVol);
      outR[i] = Math.tanh(outR[i] * finalVol);
    }
  }

  private sendDebugStatus() {
    this.debugCounter++;
    if (this.debugCounter > 20) {
      this.debugCounter = 0;
      this.port.postMessage({
        type: 'STATUS_UPDATE',
        payload: {
          tick: this.currentTick,
          time: this.currentTime,
          activeVoices: this.voices.length
        }
      });
    }
  }

  private renderVoices(outL: Float32Array, outR: Float32Array, start: number, count: number) {
    for (const voice of this.voices) {
      voice.render(outL, outR, start, count);
    }
  }

  private cullVoices() {
    let activeCount = 0;
    for (let i = 0; i < this.voices.length; i++) {
      if (this.voices[i].active) {
        this.voices[activeCount++] = this.voices[i];
      } else {
        this.releaseVoice(this.voices[i]);
      }
    }
    this.voices.length = activeCount;
  }

  private processEvent(ev: MidiEvent): void {
    const ch = ev.channel ?? 0;

    if (ev.type === 'meta' && ev.meta_type === 0x51 && ev.params?.micros) {
      this.microsPerBeat = ev.params.micros;
      this.updateTiming();
    }
    else if (ev.type === 'program_change' && ev.params?.program !== undefined) {
      this.programs[ch] = ev.params.program;
    }
    else if (ev.type === 'control_change' && ev.params) {
      const cc = ev.params.cc ?? 0;
      const val = ev.params.value ?? 0;

      if (cc === 0) {
        if (ch !== 9) this.banks[ch] = val;
      }
      else if (cc === 7) this.channels[ch].volume = val;
      else if (cc === 10) this.channels[ch].pan = val;
      else if (cc === 11) this.channels[ch].expression = val;
      else if (cc === 64) {
        this.channels[ch].sustain = val >= 64;
        if (!this.channels[ch].sustain) {
          for (const v of this.voices) {
            if (v.channel === ch && v.active) {
              v.releaseSustain();
            }
          }
        }
      }
    }
    else if (ev.type === 'pitch_bend' && ev.params?.value !== undefined) {
      const val = ev.params.value;
      const norm = (val - 8192) / 8192.0;
      this.channels[ch].pitchBend = norm * this.channels[ch].pitchRange;
    }
    else if (ev.type === 'note_on' && ev.params) {
      const note = ev.params.note ?? 60;
      const vel = ev.params.velocity ?? 100;
      const keyId = `${ch},${note}`;

      if (this.activeNotes.has(keyId)) {
        const oldVoices = this.activeNotes.get(keyId)!;
        for (const v of oldVoices) v.release();
        this.activeNotes.delete(keyId);
      }

      if (this.voices.length >= MAX_VOICES) {
        const v = this.voices.shift();

        if (v) {
          v.active = false;
          this.releaseVoice(v);
        }
      }

      const preset = this.programs[ch];

      if (this.useSineWave || !this.sf2) {
        console.log('[SynthEngine] Using SineVoice (useSineWave:', this.useSineWave, ', sf2:', !!this.sf2, ')');
        const v = this.acquireSineVoice();
        v.init(note, vel, ch, this.channels[ch], preset);
        this.voices.push(v);
        this.activeNotes.set(keyId, [v]);
        return;
      }

      const bank = ch === 9 ? 128 : this.banks[ch];

      const layers = this.sf2.getSamples(bank, preset, note, vel);

      if (layers.length === 0) {

        const v = this.acquireSineVoice();
        v.init(note, vel, ch, this.channels[ch], preset);
        this.voices.push(v);
        this.activeNotes.set(keyId, [v]);
      } else {
        const newVoices: AnyVoice[] = [];
        for (const layer of layers) {
          const v = this.acquireSF2Voice();
          v.init(layer, note, vel, ch, this.channels[ch], preset);
          newVoices.push(v);
        }

        if (newVoices.length > 0) {
          this.voices.push(...newVoices);
          this.activeNotes.set(keyId, newVoices);
        }
      }
    }
    else if (ev.type === 'note_off' && ev.params?.note !== undefined) {
      const note = ev.params.note;
      const keyId = `${ch},${note}`;

      if (this.activeNotes.has(keyId)) {
        for (const v of this.activeNotes.get(keyId)!) {
          v.release();
        }
        this.activeNotes.delete(keyId);
      }
    }
  }
}