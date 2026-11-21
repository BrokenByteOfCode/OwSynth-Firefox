import { MidiFile, MidiEvent, TempoEvent } from './types';

export class MidiParser {
  private raw: Uint8Array;
  private pos: number = 0;
  public format: number = 0;
  public numTracks: number = 0;
  public division: number = 0;
  public tracks: MidiEvent[][] = [];

  constructor(data: ArrayBuffer) {
    this.raw = new Uint8Array(data);
    this.parseHeader();
    this.parseTracks();
  }

  private readByte(): number {
    return this.raw[this.pos++];
  }

  private readBytes(n: number): Uint8Array {
    const result = this.raw.slice(this.pos, this.pos + n);
    this.pos += n;
    return result;
  }

  private readIntBE(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      value = (value << 8) | this.readByte();
    }
    return value;
  }

  private readVarLen(): number {
    let value = 0;
    let byte: number;
    do {
      byte = this.readByte();
      value = (value << 7) | (byte & 0x7F);
    } while (byte & 0x80);
    return value;
  }

  private parseHeader(): void {
    const chunkType = String.fromCharCode(...this.readBytes(4));
    if (chunkType !== 'MThd') {
      throw new Error('Invalid MIDI: Missing MThd');
    }
    const length = this.readIntBE(4);
    if (length !== 6) {
      throw new Error('Invalid MThd length');
    }
    this.format = this.readIntBE(2);
    this.numTracks = this.readIntBE(2);
    this.division = this.readIntBE(2);
    if (this.division & 0x8000) {
      throw new Error('SMPTE time division not supported');
    }
  }

  private parseTracks(): void {
    for (let i = 0; i < this.numTracks; i++) {
      const chunkType = String.fromCharCode(...this.readBytes(4));
      if (chunkType !== 'MTrk') {
        throw new Error(`Expected MTrk, got ${chunkType}`);
      }
      const length = this.readIntBE(4);
      const startPos = this.pos;
      const endPos = startPos + length;
      const trackEvents = this.parseTrackEvents(endPos);
      this.tracks.push(trackEvents);
      this.pos = endPos;
    }
  }

  private parseTrackEvents(endPos: number): MidiEvent[] {
    const events: MidiEvent[] = [];
    let absTick = 0;
    let lastStatus = 0;

    while (this.pos < endPos) {
      const delta = this.readVarLen();
      absTick += delta;
      
      if (this.pos >= endPos) break;

      let status = this.raw[this.pos];
      const eventData: MidiEvent = {
        tick: absTick,
        delta: delta,
        type: 'unknown',
        params: {}
      };

      if (status === 0xFF) {
        this.pos++;
        const metaType = this.readByte();
        const length = this.readVarLen();
        const payload = this.readBytes(length);
        
        eventData.type = 'meta';
        eventData.meta_type = metaType;
        eventData.data = payload;

        if (metaType === 0x2F) {
          events.push(eventData);
          break;
        } else if (metaType === 0x51) {
          const micros = (payload[0] << 16) | (payload[1] << 8) | payload[2];
          const bpm = 60000000 / micros;
          eventData.params = { bpm, micros };
        } else if (metaType === 0x03) {
          const text = new TextDecoder('ascii').decode(payload);
          eventData.params = { text };
        }
      } else if (status === 0xF0 || status === 0xF7) {
        this.pos++;
        const length = this.readVarLen();
        this.pos += length;
        eventData.type = 'sysex';
      } else {
        if (status & 0x80) {
          this.pos++;
          lastStatus = status;
        } else {
          status = lastStatus;
        }

        const cmd = status & 0xF0;
        const channel = status & 0x0F;
        eventData.channel = channel;

        if (cmd === 0x80) {
          const note = this.readByte();
          const vel = this.readByte();
          eventData.type = 'note_off';
          eventData.params = { note, velocity: vel };
        } else if (cmd === 0x90) {
          const note = this.readByte();
          const vel = this.readByte();
          eventData.type = vel === 0 ? 'note_off' : 'note_on';
          eventData.params = { note, velocity: vel };
        } else if (cmd === 0xA0) {
          const note = this.readByte();
          const pres = this.readByte();
          eventData.type = 'poly_pressure';
          eventData.params = { note, pressure: pres };
        } else if (cmd === 0xB0) {
          const cc = this.readByte();
          const val = this.readByte();
          eventData.type = 'control_change';
          eventData.params = { cc, value: val };
        } else if (cmd === 0xC0) {
          const prog = this.readByte();
          eventData.type = 'program_change';
          eventData.params = { program: prog };
        } else if (cmd === 0xD0) {
          const pres = this.readByte();
          eventData.type = 'channel_pressure';
          eventData.params = { pressure: pres };
        } else if (cmd === 0xE0) {
          const l = this.readByte();
          const h = this.readByte();
          const val = (h << 7) | l;
          eventData.type = 'pitch_bend';
          eventData.params = { value: val };
        }
      }

      events.push(eventData);
    }

    return events;
  }

  public getTempoMap(): TempoEvent[] {
    const tempos: TempoEvent[] = [{ tick: 0, micros: 500000 }];
    
    for (const track of this.tracks) {
      for (const ev of track) {
        if (ev.type === 'meta' && ev.meta_type === 0x51 && ev.params?.micros) {
          tempos.push({ tick: ev.tick, micros: ev.params.micros });
        }
      }
    }

    tempos.sort((a, b) => a.tick - b.tick);
    return tempos;
  }
}
