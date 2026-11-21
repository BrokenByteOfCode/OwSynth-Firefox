export class ChannelState {
  volume: number = 100;
  pan: number = 64;
  expression: number = 127;
  sustain: boolean = false;
  pitchBend: number = 0.0;
  pitchRange: number = 12.0;

  getGain(): number {
    return (this.volume * this.expression) / (127.0 * 127.0);
  }

  getPan(): number {
    return (this.pan - 64) / 64.0;
  }
}