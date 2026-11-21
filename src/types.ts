export interface MidiEvent {
  tick: number;
  delta: number;
  type: string;
  channel?: number;
  params?: {
    note?: number;
    velocity?: number;
    cc?: number;
    value?: number;
    program?: number;
    pressure?: number;
    bpm?: number;
    micros?: number;
    text?: string;
  };
  meta_type?: number;
  data?: Uint8Array;
}

export interface MidiTrack {
  events: MidiEvent[];
}

export interface MidiFile {
  format: number;
  numTracks: number;
  division: number;
  tracks: MidiTrack[];
}

export interface TempoEvent {
  tick: number;
  micros: number;
}

export interface SF2Generator {
  op: number;
  u: number;
  s: number;
}

export interface SF2Layer {
  sampleName: string;
  rawData: Int16Array;
  sampleRate: number;
  loopMode: number;
  loopStart: number;
  loopEnd: number;
  rootKey: number;
  correction: number;
  attenuation: number;
  pan: number;
  scaleTuning: number;
  volDelay: number;
  volAttack: number;
  volHold: number;
  volDecay: number;
  volSustain: number;
  volRelease: number;
  modDelay: number;
  modAttack: number;
  modHold: number;
  modDecay: number;
  modSustain: number;
  modRelease: number;
  modEnvToPitch: number;
  filterCutoff: number;
  filterQ: number;
  modEnvToFilter: number;
  modLfoToFilter: number;
  modLfoDelay: number;
  modLfoFreq: number;
  modLfoToPitch: number;
  modLfoToVolume: number;
  vibLfoDelay: number;
  vibLfoFreq: number;
  vibLfoToPitch: number;
}

export interface StatusUpdate {
  tick: number;
  time: number;
  activeVoices: number;
  bpm?: number;
  log?: string;
}