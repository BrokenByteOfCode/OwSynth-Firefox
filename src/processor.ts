import { SynthEngine } from './audio/synthEngine';

declare class AudioWorkletProcessor {
  protected port: MessagePort;
  constructor(options?: any);
  public process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(name: string, processorCtor: any): void;

class MidiProcessor extends AudioWorkletProcessor {
  private engine: SynthEngine;

  constructor() {
    super();
    this.engine = new SynthEngine(this.port);

    this.port.onmessage = (event: MessageEvent) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'LOAD_SF2':
          console.log('[Processor] Received LOAD_SF2, payload type:', payload?.constructor?.name, 'byteLength:', payload?.byteLength);
          this.engine.loadSF2Data(payload);
          break;
        case 'LOAD_MIDI':
          if (payload && payload.events) {
            this.engine.loadEvents(payload.events, payload.division);
          }
          break;
        case 'PLAY':
          this.engine.play();
          break;
        case 'PAUSE':
          this.engine.pause();
          break;
        case 'STOP':
          this.engine.stop();
          break;
        case 'SEEK':
          this.engine.seek(payload);
          break;
        case 'SET_VOLUME':
          this.engine.setVolume(payload);
          break;
        case 'SET_SINE':
          this.engine.setUseSineWave(payload);
          break;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    return this.engine.process(inputs, outputs, parameters);
  }
}

registerProcessor('midi-processor', MidiProcessor);