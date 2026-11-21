declare var browser: any;
import { MidiParser } from './midiParser';
import { StatusUpdate } from './types';

class MidiPlayer {
  private midiUrl: string | null = null;
  private midiData: ArrayBuffer | null = null;
  private sf2Data: ArrayBuffer | null = null;
  private parser: MidiParser | null = null;

  private storedEvents: any[] = [];
  private storedDivision: number = 480;

  private isPlaying: boolean = false;
  private totalTicks: number = 0;
  private useSineWave: boolean = false;
  private estimatedDuration: number = 0;

  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationId: number = 0;

  private playBtn = document.getElementById('play-btn') as HTMLButtonElement;
  private pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  private stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
  private menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;
  private playerMenu = document.getElementById('player-menu') as HTMLDivElement;
  private downloadBtn = document.getElementById('download-btn') as HTMLDivElement;
  private settingsBtn = document.getElementById('settings-btn') as HTMLDivElement;
  private volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
  private progressBar = document.getElementById('progress-bar') as HTMLDivElement;
  private progressFill = document.getElementById('progress-fill') as HTMLDivElement;
  private trackName = document.getElementById('track-name') as HTMLDivElement;
  private currentTime = document.getElementById('current-time') as HTMLSpanElement;
  private totalTime = document.getElementById('total-time') as HTMLSpanElement;
  private statusText = document.getElementById('status-text') as HTMLSpanElement;
  private bpmText = document.getElementById('bpm-text') as HTMLSpanElement;
  private vizCanvas = document.getElementById('viz-canvas') as HTMLCanvasElement;
  private vizCtx: CanvasRenderingContext2D | null = null;

  constructor() {
    if (this.vizCanvas) {
      this.vizCtx = this.vizCanvas.getContext('2d', { alpha: false });
    }
    this.setupEventListeners();
    this.loadSettings();
    this.listenForMessages();
  }

  private setupEventListeners(): void {
    if (this.playBtn) this.playBtn.addEventListener('click', () => this.play());
    if (this.pauseBtn) this.pauseBtn.addEventListener('click', () => this.pause());
    if (this.stopBtn) this.stopBtn.addEventListener('click', () => this.stop());
    
    if (this.menuBtn) {
      this.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = this.playerMenu.style.display;
        this.playerMenu.style.display = (cur === 'none' || !cur) ? 'flex' : 'none';
      });
    }

    document.addEventListener('click', () => {
      if (this.playerMenu) this.playerMenu.style.display = 'none';
    });

    if (this.downloadBtn) this.downloadBtn.addEventListener('click', () => this.downloadMidi());
    if (this.settingsBtn) this.settingsBtn.addEventListener('click', () => this.openSettings());

    if (this.volumeSlider) {
      this.volumeSlider.addEventListener('input', (e) => {
        const volume = parseInt((e.target as HTMLInputElement).value) / 100;
        this.postMessage('SET_VOLUME', volume);
      });
    }

    if (this.progressBar) {
      this.progressBar.addEventListener('click', (e) => {
        if (!this.totalTicks) return;
        const rect = this.progressBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const targetTick = this.totalTicks * percent;
        this.postMessage('SEEK', targetTick);
        this.updateProgressUI(percent * 100, percent * this.estimatedDuration);
      });
    }
  }

  private postMessage(type: string, payload?: any): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type, payload });
    }
  }

  private listenForMessages(): void {
    window.addEventListener('message', (event) => {
      if (event.data.type === 'LOAD_MIDI') {
        this.loadMidi(event.data.url);
        return;
      }

      if (event.data.type === 'STOP') {
        this.stop();
        return;
      }
    });
  }

  private async loadSettings(): Promise<void> {
    const res = await browser.storage.local.get(['useSine']);
    this.useSineWave = res.useSine || false;
  }

  private async handleSF2Response(data: any): Promise<void> {
    if (!data || !data.data) return;

      try {
        const resp = await fetch(data.data);
        this.sf2Data = await resp.arrayBuffer();
      } catch (e) {
        console.error('[Player] Failed to fetch SF2 blob URL', e);
        this.sf2Data = null;
      }

    if (this.workletNode && !this.useSineWave && this.sf2Data) {
      this.postMessage('SET_SINE', false);
      this.postMessage('LOAD_SF2', this.sf2Data);
    }
  }

  private async ensureSF2Loaded(): Promise<void> {
    if (this.useSineWave || this.sf2Data) return;
    this.statusText.textContent = 'Loading SF2...';
    const response = await browser.runtime.sendMessage({ type: 'SF2_REQUEST' });
    if (response && response.data) {
      await this.handleSF2Response(response);
    } else {
      this.useSineWave = true;
      if (this.workletNode) this.postMessage('SET_SINE', true);
    }
    this.statusText.textContent = 'Ready';
  }

  private async initAudio(): Promise<boolean> {
    if (this.audioContext) return true;
    try {
      this.statusText.textContent = 'Init...';
      this.audioContext = new AudioContext();
      await this.audioContext.audioWorklet.addModule(browser.runtime.getURL('processor.js'));
      this.workletNode = new AudioWorkletNode(this.audioContext, 'midi-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.workletNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      this.workletNode.port.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'STATUS_UPDATE') {
          if (payload.log) {
            console.log('[Worklet]', payload.log);
            return;
          }
          const status = payload as StatusUpdate;
          const percent = this.totalTicks > 0 ? (status.tick / this.totalTicks) * 100 : 0;
          this.updateProgressUI(percent, status.time);
        } else if (type === 'BPM_UPDATE') {
          this.bpmText.textContent = `${payload} BPM`;
        } else if (type === 'STOP') {
          this.onPlaybackStop();
        }
      };

      if (this.sf2Data) this.postMessage('LOAD_SF2', this.sf2Data);
      this.postMessage('LOAD_MIDI', { events: this.storedEvents, division: this.storedDivision });
      this.startVisualizer();
      return true;
    } catch (e) {
      this.statusText.textContent = 'Error';
      return false;
    }
  }

  private startVisualizer(): void {
    const draw = () => {
      this.animationId = requestAnimationFrame(draw);
      if (!this.analyser || !this.dataArray || !this.vizCtx || !this.isPlaying) {
        if (!this.isPlaying && this.vizCtx) {
          this.vizCtx.fillStyle = '#000';
          this.vizCtx.fillRect(0, 0, this.vizCanvas.width, this.vizCanvas.height);
        }
        return;
      }
      this.analyser.getByteFrequencyData(this.dataArray as any);
      const w = this.vizCanvas.width;
      const h = this.vizCanvas.height;
      this.vizCtx.fillStyle = '#000';
      this.vizCtx.fillRect(0, 0, w, h);
      const bars = 10;
      const barW = Math.floor(w / bars);
      const gap = 1;
      const binCount = this.analyser.frequencyBinCount;
      const step = Math.floor(binCount / bars);

      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += this.dataArray[i * step + j];
        const val = (sum / step) / 255;
        const totalBlocks = 6;
        let litBlocks = Math.floor(val * totalBlocks * 1.8);
        if (val > 0.005 && litBlocks === 0) litBlocks = 1;
        const blockH = Math.floor(h / totalBlocks);

        for (let b = 0; b < totalBlocks; b++) {
          if (b < litBlocks) {
            if (b >= 5) this.vizCtx.fillStyle = '#ff3333';
            else if (b >= 3) this.vizCtx.fillStyle = '#ffff33';
            else this.vizCtx.fillStyle = '#33ff33';
            const y = h - ((b + 1) * blockH) + 1;
            this.vizCtx.fillRect(i * barW, y, barW - gap, blockH - gap);
          }
        }
      }
    };
    draw();
  }

  private async loadMidi(url: string): Promise<void> {
    this.statusText.textContent = 'Loading...';
    const response = await fetch(url);
    this.midiData = await response.arrayBuffer();
    this.parser = new MidiParser(this.midiData);
    this.trackName.textContent = url.split('/').pop() || 'Unknown';
    const allEvents: any[] = [];
    this.parser.tracks.forEach(t => allEvents.push(...t));
    allEvents.sort((a, b) => a.tick - b.tick);
    this.totalTicks = allEvents.length > 0 ? allEvents[allEvents.length - 1].tick : 0;
    this.estimatedDuration = this.estimateDuration();
    this.totalTime.textContent = this.formatTime(this.estimatedDuration);
    this.storedEvents = allEvents;
    this.storedDivision = this.parser.division || 480;
    this.statusText.textContent = 'Ready';
    if (this.workletNode) {
      this.postMessage('LOAD_MIDI', { events: this.storedEvents, division: this.storedDivision });
    }
  }

  private estimateDuration(): number {
    if (!this.parser) return 0;
    const division = this.parser.division || 480;
    let time = 0;
    let lastTick = 0;
    let curMicros = 500000;
    this.parser.getTempoMap().forEach(t => {
      time += ((t.tick - lastTick) / division) * (curMicros / 1000000);
      lastTick = t.tick;
      curMicros = t.micros;
    });
    time += ((this.totalTicks - lastTick) / division) * (curMicros / 1000000);
    return time;
  }

  private formatTime(s: number): string {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private async play(): Promise<void> {
    if (!this.useSineWave && !this.sf2Data) {
      await this.ensureSF2Loaded();
    }

    if (!this.audioContext) await this.initAudio();
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
    this.postMessage('PLAY');
    this.isPlaying = true;
    this.statusText.textContent = 'Play';
    this.updateUI();
  }

  private pause(): void {
    this.postMessage('PAUSE');
    this.isPlaying = false;
    this.statusText.textContent = 'Pause';
    this.updateUI();
  }

  private stop(): void {
    this.postMessage('STOP');
    this.onPlaybackStop();
  }

  private onPlaybackStop(): void {
    this.isPlaying = false;
    this.statusText.textContent = 'Stop';
    this.currentTime.textContent = '0:00';
    this.progressFill.style.width = '0%';
    this.updateUI();
  }

  private downloadMidi(): void {
    if (!this.midiData) return;
    const blob = new Blob([this.midiData], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.trackName.textContent || 'download.mid';
    a.click();
  }

  private openSettings(): void {
    const url = browser.runtime.getURL('settings.html');
    browser.runtime.sendMessage({ type: 'OPEN_TAB', url });
  }

  private updateUI(): void {
    this.playBtn.style.display = this.isPlaying ? 'none' : 'inline-block';
    this.pauseBtn.style.display = this.isPlaying ? 'inline-block' : 'none';
  }

  private updateProgressUI(p: number, s: number): void {
    this.progressFill.style.width = `${p}%`;
    this.currentTime.textContent = this.formatTime(s);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
}

new MidiPlayer();