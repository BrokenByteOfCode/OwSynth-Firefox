import { SF2Layer, SF2Generator } from './types';

const GEN_MOD_LFO_TO_PITCH = 5;
const GEN_VIB_LFO_TO_PITCH = 6;
const GEN_MOD_ENV_TO_PITCH = 7;
const GEN_FILTER_FC = 8;
const GEN_FILTER_Q = 9;
const GEN_MOD_LFO_TO_FILTER_FC = 10;
const GEN_MOD_ENV_TO_FILTER_FC = 11;
const GEN_MOD_LFO_TO_VOLUME = 13;
const GEN_PAN = 17;
const GEN_MOD_LFO_DELAY = 21;
const GEN_MOD_LFO_FREQ = 22;
const GEN_VIB_LFO_DELAY = 23;
const GEN_VIB_LFO_FREQ = 24;
const GEN_MOD_ENV_DELAY = 25;
const GEN_MOD_ENV_ATTACK = 26;
const GEN_MOD_ENV_HOLD = 27;
const GEN_MOD_ENV_DECAY = 28;
const GEN_MOD_ENV_SUSTAIN = 29;
const GEN_MOD_ENV_RELEASE = 30;
const GEN_VOL_ENV_DELAY = 33;
const GEN_VOL_ENV_ATTACK = 34;
const GEN_VOL_ENV_HOLD = 35;
const GEN_VOL_ENV_DECAY = 36;
const GEN_VOL_ENV_SUSTAIN = 37;
const GEN_VOL_ENV_RELEASE = 38;
const GEN_INSTRUMENT = 41;
const GEN_KEY_RANGE = 43;
const GEN_VEL_RANGE = 44;
const GEN_COARSE_TUNE = 51;
const GEN_FINE_TUNE = 52;
const GEN_SAMPLE_ID = 53;
const GEN_SAMPLE_MODES = 54;
const GEN_SCALE_TUNING = 56;
const GEN_OVERRIDING_ROOT_KEY = 58;
const GEN_ATTENUATION = 48;

function getGen(pGens: Map<number, SF2Generator>, iGens: Map<number, SF2Generator>, op: number, defaultVal: number = 0): number {
  const iVal = iGens.get(op)?.s ?? defaultVal;
  const pVal = pGens.get(op)?.s ?? 0;
  return iVal + pVal;
}

export class SF2Parser {
  private raw: Uint8Array;
  private presets: any[] = [];
  private pbags: number[][] = [];
  private pgens: SF2Generator[] = [];
  private insts: any[] = [];
  private ibags: number[][] = [];
  private igens: SF2Generator[] = [];
  private samples: any[] = [];
  private smplData: Uint8Array = new Uint8Array();
  private presetMap: Map<string, number> = new Map();

  constructor(data: ArrayBuffer) {
    this.raw = new Uint8Array(data);
    this.parse();
    this.buildMap();
  }

  private readStr(data: Uint8Array): string {
    let str = "";
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) break; 
        str += String.fromCharCode(data[i]);
    }
    return str;
  }

  private timecentToSec(tc: number): number {
    if (tc === -32768) return 0.0;
    return Math.pow(2.0, tc / 1200.0);
  }

  private absCentsToHz(val: number): number {
    return 8.176 * Math.pow(2.0, val / 1200.0);
  }

  private parse(): void {
    if (String.fromCharCode(...this.raw.slice(0, 4)) !== 'RIFF') return;

    let pos = 12;
    const sz = this.raw.length;

    while (pos < sz) {
      if (pos + 8 > sz) break;
      const cid = String.fromCharCode(...this.raw.slice(pos, pos + 4));
      const dv = new DataView(this.raw.buffer, this.raw.byteOffset + pos + 4, 4);
      const csize = dv.getUint32(0, true);
      pos += 8;

      if (cid === 'LIST') {
        const lid = String.fromCharCode(...this.raw.slice(pos, pos + 4));
        if (lid === 'pdta') {
          this.parsePdta(pos + 4, pos + csize);
        } else if (lid === 'sdta') {
          this.parseSdta(pos + 4, pos + csize);
        }
      }
      pos += csize + (csize % 2);
    }
  }

  private parseSdta(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      const cid = String.fromCharCode(...this.raw.slice(pos, pos + 4));
      const dv = new DataView(this.raw.buffer, this.raw.byteOffset + pos + 4, 4);
      const csize = dv.getUint32(0, true);
      pos += 8;
      if (cid === 'smpl') {
        this.smplData = this.raw.slice(pos, pos + csize);
      }
      pos += csize + (csize % 2);
    }
  }

  private parsePdta(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      if (pos + 8 > end) break;
      const cid = String.fromCharCode(...this.raw.slice(pos, pos + 4));
      const dv = new DataView(this.raw.buffer, this.raw.byteOffset + pos + 4, 4);
      const csize = dv.getUint32(0, true);
      pos += 8;
      const readChunk = (size: number, fn: (offset: number) => void) => {
        const count = Math.floor(csize / size);
        for (let i = 0; i < count; i++) {
          fn(pos + i * size);
        }
      };
      if (cid === 'phdr') {
        readChunk(38, (o) => {
          const dv = new DataView(this.raw.buffer, this.raw.byteOffset + o);
          this.presets.push({
            bank: dv.getUint16(22, true),
            preset: dv.getUint16(20, true),
            bag: dv.getUint16(24, true)
          });
        });
      } else if (cid === 'pbag') {
        readChunk(4, (o) => {
          const dv = new DataView(this.raw.buffer, this.raw.byteOffset + o);
          this.pbags.push([dv.getUint16(0, true), dv.getUint16(2, true)]);
        });
      } else if (cid === 'pgen') {
        readChunk(4, (o) => this.addGen(this.pgens, o));
      } else if (cid === 'inst') {
        readChunk(22, (o) => {
          const dv = new DataView(this.raw.buffer, this.raw.byteOffset + o);
          this.insts.push({ bag: dv.getUint16(20, true) });
        });
      } else if (cid === 'ibag') {
        readChunk(4, (o) => {
          const dv = new DataView(this.raw.buffer, this.raw.byteOffset + o);
          this.ibags.push([dv.getUint16(0, true), dv.getUint16(2, true)]);
        });
      } else if (cid === 'igen') {
        readChunk(4, (o) => this.addGen(this.igens, o));
      } else if (cid === 'shdr') {
        readChunk(46, (o) => {
          const dv = new DataView(this.raw.buffer, this.raw.byteOffset + o);
          this.samples.push({
            name: this.readStr(this.raw.slice(o, o + 20)),
            start: dv.getUint32(20, true),
            end: dv.getUint32(24, true),
            loopStart: dv.getUint32(28, true),
            loopEnd: dv.getUint32(32, true),
            rate: dv.getUint32(36, true),
            pitch: dv.getUint8(40),
            correction: dv.getInt8(41)
          });
        });
      }
      pos += csize + (csize % 2);
    }
  }

  private addGen(listRef: SF2Generator[], offset: number): void {
    const dv = new DataView(this.raw.buffer, this.raw.byteOffset + offset);
    const op = dv.getUint16(0, true);
    const val = dv.getUint16(2, true);
    const valS = dv.getInt16(2, true);
    listRef.push({ op, u: val, s: valS });
  }

  private buildMap(): void {
    for (let i = 0; i < this.presets.length - 1; i++) {
      const p = this.presets[i];
      this.presetMap.set(`${p.bank},${p.preset}`, i);
    }
  }

  public getSamples(bank: number, preset: number, note: number, vel: number): SF2Layer[] {
    let pidx = this.findPreset(bank, preset);
    if (pidx === -1) return [];

    const p = this.presets[pidx];
    const pNext = this.presets[pidx + 1];
    const layers: SF2Layer[] = [];

    let globalPGens = new Map<number, SF2Generator>();

    for (let pbg = p.bag; pbg < pNext.bag; pbg++) {
      const [gs, ge] = [this.pbags[pbg][0], this.pbags[pbg + 1][0]];
      const pgens = new Map<number, SF2Generator>();

      for (let i = gs; i < ge; i++) {
        pgens.set(this.pgens[i].op, this.pgens[i]);
      }

      if (!pgens.has(GEN_INSTRUMENT)) {

        globalPGens = pgens;
        continue;
      }

      for (const [op, gen] of globalPGens) {
        if (!pgens.has(op)) {
            pgens.set(op, gen);
        }
      }

      if (this.checkRange(pgens, GEN_KEY_RANGE, note) === false) continue;
      if (this.checkRange(pgens, GEN_VEL_RANGE, vel) === false) continue;

      const instId = pgens.get(GEN_INSTRUMENT)?.u ?? -1;
      if (instId < 0 || instId >= this.insts.length) continue;

      const inst = this.insts[instId];
      const instNext = this.insts[instId + 1];

      let globalIGens = new Map<number, SF2Generator>();

      for (let ibg = inst.bag; ibg < instNext.bag; ibg++) {
        const [igs, ige] = [this.ibags[ibg][0], this.ibags[ibg + 1][0]];
        const igens = new Map<number, SF2Generator>();

        for (let i = igs; i < ige; i++) {
          igens.set(this.igens[i].op, this.igens[i]);
        }

        if (!igens.has(GEN_SAMPLE_ID)) {
            globalIGens = igens;
            continue;
        }

        for (const [op, gen] of globalIGens) {
            if (!igens.has(op)) {
                igens.set(op, gen);
            }
        }

        if (this.checkRange(igens, GEN_KEY_RANGE, note) === false) continue;
        if (this.checkRange(igens, GEN_VEL_RANGE, vel) === false) continue;

        const sid = igens.get(GEN_SAMPLE_ID)?.u ?? -1;
        if (sid >= 0 && sid < this.samples.length) {
          layers.push(this.makeLayer(sid, pgens, igens));
        }
      }
    }

    if (layers.length === 0 && bank !== 128) {
        if (bank === 0 && preset === 0) return [];
        return this.getSamples(0, 0, note, vel);
    }
    return layers;
  }

  private checkRange(gens: Map<number, SF2Generator>, op: number, val: number): boolean {
    if (gens.has(op)) {
      const range = gens.get(op)!.u;
      const lo = range & 0xFF;
      const hi = (range >> 8) & 0xFF;
      if (val < lo || val > hi) return false;
    }
    return true;
  }

  private findPreset(bank: number, preset: number): number {
      let key = `${bank},${preset}`;
      if (this.presetMap.has(key)) return this.presetMap.get(key)!;
      if (bank !== 128) {
          key = `0,${preset}`;
          if (this.presetMap.has(key)) return this.presetMap.get(key)!;
      }
      if (bank === 128) {
           key = `128,0`;
           if (this.presetMap.has(key)) return this.presetMap.get(key)!;
      }
      if (bank !== 128) {
          key = `0,0`;
          if (this.presetMap.has(key)) return this.presetMap.get(key)!;
      }
      return -1;
  }

  private makeLayer(sid: number, pg: Map<number, SF2Generator>, ig: Map<number, SF2Generator>): SF2Layer {
    const s = this.samples[sid];

    const g = (op: number, def: number) => getGen(pg, ig, op, def);
    const ts = (val: number) => this.timecentToSec(val);

    return {
      sampleName: s.name,
      rawData: new Int16Array(this.smplData.buffer, this.smplData.byteOffset + s.start * 2, s.end - s.start),
      sampleRate: s.rate,
      loopMode: (ig.get(GEN_SAMPLE_MODES)?.u ?? 0) & 3,
      loopStart: s.loopStart - s.start,
      loopEnd: s.loopEnd - s.start,
      rootKey: ig.get(GEN_OVERRIDING_ROOT_KEY)?.u ?? s.pitch,
      correction: s.correction + g(GEN_COARSE_TUNE, 0) * 100 + g(GEN_FINE_TUNE, 0),
      attenuation: g(GEN_ATTENUATION, 0),
      pan: g(GEN_PAN, 0),
      scaleTuning: g(GEN_SCALE_TUNING, 100) / 100.0,
      volDelay: ts(g(GEN_VOL_ENV_DELAY, -12000)),
      volAttack: ts(g(GEN_VOL_ENV_ATTACK, -12000)),
      volHold: ts(g(GEN_VOL_ENV_HOLD, -12000)),
      volDecay: ts(g(GEN_VOL_ENV_DECAY, -12000)),
      volSustain: Math.pow(10.0, -g(GEN_VOL_ENV_SUSTAIN, 0) / 200.0),
      volRelease: ts(g(GEN_VOL_ENV_RELEASE, -12000)),
      modDelay: ts(g(GEN_MOD_ENV_DELAY, -12000)),
      modAttack: ts(g(GEN_MOD_ENV_ATTACK, -12000)),
      modHold: ts(g(GEN_MOD_ENV_HOLD, -12000)),
      modDecay: ts(g(GEN_MOD_ENV_DECAY, -12000)),
      modSustain: 1.0 - g(GEN_MOD_ENV_SUSTAIN, 0) / 1000.0,
      modRelease: ts(g(GEN_MOD_ENV_RELEASE, -12000)),
      modEnvToPitch: g(GEN_MOD_ENV_TO_PITCH, 0),
      filterCutoff: this.absCentsToHz(g(GEN_FILTER_FC, 13500)),
      filterQ: g(GEN_FILTER_Q, 0),
      modEnvToFilter: g(GEN_MOD_ENV_TO_FILTER_FC, 0),
      modLfoToFilter: g(GEN_MOD_LFO_TO_FILTER_FC, 0),
      modLfoDelay: ts(g(GEN_MOD_LFO_DELAY, -12000)),
      modLfoFreq: g(GEN_MOD_LFO_FREQ, 0) !== 0 ? this.absCentsToHz(g(GEN_MOD_LFO_FREQ, 0)) : 8.176,
      modLfoToPitch: g(GEN_MOD_LFO_TO_PITCH, 0),
      modLfoToVolume: g(GEN_MOD_LFO_TO_VOLUME, 0),
      vibLfoDelay: ts(g(GEN_VIB_LFO_DELAY, -12000)),
      vibLfoFreq: g(GEN_VIB_LFO_FREQ, 0) !== 0 ? this.absCentsToHz(g(GEN_VIB_LFO_FREQ, 0)) : 8.176,
      vibLfoToPitch: g(GEN_VIB_LFO_TO_PITCH, 0)
    };
  }
}