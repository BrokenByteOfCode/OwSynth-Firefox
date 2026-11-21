declare var browser: any;

const MIDI_REGEX = /\.(midi?|rmi)(\?.*|#.*)?$/i;
const DATA_URI_MIDI_PREFIX = "data:audio/mid";

const MIDI_MIME_TYPES = [
  'audio/midi',
  'audio/x-midi',
  'application/x-midi',
  'audio/mid',
  'x-music/x-midi'
];

class MidiDetector {
  private observer: MutationObserver | null = null;
  private blacklist: string[] = [];
  private isBlacklisted: boolean = false;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    await this.checkBlacklist();
    if (this.isBlacklisted) return;
    this.scanPage();
    this.observeDOMChanges();
  }

  private scanPage(): void {
    const mediaElements = document.querySelectorAll('embed, object, audio, bgsound');
    mediaElements.forEach(el => {
      if (this.isMidiElement(el)) {
        this.injectPlayer(el);
      }
    });

    const links = document.querySelectorAll('a');
    links.forEach(el => {
      if (this.isMidiLink(el)) {
        this.wrapLink(el as HTMLAnchorElement);
      }
    });
  }

  private observeDOMChanges(): void {
    if (this.isBlacklisted) return;

    this.observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          shouldScan = true;
        }
      });
      if (shouldScan) {
        this.scanPage();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    try {
      browser.storage.onChanged.addListener((changes: any, areaName: string) => {
        if (areaName === 'local' && changes.blacklist) {
          this.checkBlacklist();
        }
      });
    } catch (e) {}
  }

  private isMidiLink(anchor: HTMLAnchorElement): boolean {
    if (anchor.hasAttribute('data-midi-processed')) return false;
    const href = anchor.getAttribute('href');
    if (!href) return false;
    const type = anchor.getAttribute('type');
    return this.checkUrlOrType(href, type);
  }

  private isMidiElement(element: Element): boolean {
    if (element.hasAttribute('data-midi-processed')) return false;
    let src = this.getMidiUrlFromElement(element);
    let type = element.getAttribute('type');

    if (element.tagName === 'AUDIO') {
      const source = element.querySelector('source');
      if (source) {
        type = source.getAttribute('type') || type;
      }
    }

    return this.checkUrlOrType(src, type);
  }

  private checkUrlOrType(url: string, mimeType: string | null): boolean {
    if (url && url.startsWith(DATA_URI_MIDI_PREFIX)) return true;
    if (mimeType && MIDI_MIME_TYPES.includes(mimeType.toLowerCase())) return true;
    if (url && MIDI_REGEX.test(url)) return true;
    return false;
  }

  private getMidiUrlFromElement(element: Element): string {
    if (element.tagName === 'EMBED') return element.getAttribute('src') || '';
    if (element.tagName === 'OBJECT') return element.getAttribute('data') || '';
    if (element.tagName === 'BGSOUND') return element.getAttribute('src') || '';
    if (element.tagName === 'AUDIO') {
      let src = element.getAttribute('src');
      if (!src) {
        const source = element.querySelector('source');
        if (source) src = source.getAttribute('src');
      }
      return src || '';
    }
    return '';
  }

  private toAbsoluteUrl(url: string): string {
    if (!url || url.startsWith('data:')) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  private async checkBlacklist(): Promise<void> {
    try {
      const res = await browser.storage.local.get(['blacklist']);
      this.blacklist = Array.isArray(res.blacklist) ? res.blacklist.map((s: string) => s.toLowerCase().trim()) : [];
      const host = (window.location.hostname || '').toLowerCase();
      this.isBlacklisted = this.blacklist.some(b => b && host.endsWith(b));
      if (this.isBlacklisted && this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    } catch (e) {
      this.blacklist = [];
      this.isBlacklisted = false;
    }
  }

  private injectPlayer(element: Element): void {
    if (element.hasAttribute('data-midi-processed')) return;
    element.setAttribute('data-midi-processed', 'true');

    const rawUrl = this.getMidiUrlFromElement(element);
    if (!rawUrl) return;

    const absoluteUrl = this.toAbsoluteUrl(rawUrl);
    const isBg = element.tagName === 'BGSOUND';

    if (isBg) {
      this.createBgSoundInteraction(absoluteUrl);
      return;
    }

    const container = document.createElement('div');
    container.className = 'owsynth-player-container';
    container.style.cssText = 'margin: 5px 0; width: 320px; z-index: 9999; position: relative; box-sizing: border-box; display: block;';

    const iframe = document.createElement('iframe');
    iframe.src = browser.runtime.getURL('player.html');
    iframe.style.cssText = 'width: 320px; height: 54px; border: none; display: block; overflow: hidden; background: transparent;';
    iframe.setAttribute('data-midi-url', absoluteUrl);

    container.appendChild(iframe);

    if (element.parentNode) {
      (element as HTMLElement).style.display = 'none';
      if (element instanceof HTMLAudioElement) {
        element.pause();
        element.muted = true;
      }
      element.parentNode.insertBefore(container, element);
    }

    iframe.addEventListener('load', () => {
      iframe.contentWindow?.postMessage({ type: 'LOAD_MIDI', url: absoluteUrl }, '*');
    });
  }

  private createBgSoundInteraction(url: string): void {
    const btn = document.createElement('button');
    btn.textContent = 'Enable Background MIDI (Click me)';
    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 10000;
        padding: 8px 12px;
        background: #c0c0c0;
        color: #000;
        border: 2px solid #fff;
        border-right-color: #808080;
        border-bottom-color: #808080;
        box-shadow: 1px 1px 0 #000;
        font-family: 'MS Sans Serif', sans-serif;
        font-size: 11px;
        cursor: pointer;
    `;

    btn.onclick = () => {
      const container = document.createElement('div');
      container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 10001; width: 320px;';
      const iframe = document.createElement('iframe');
      iframe.src = browser.runtime.getURL('player.html');
      iframe.style.cssText = 'width: 320px; height: 54px; border: none; overflow: hidden; background: transparent;';
      
      container.appendChild(iframe);
      document.body.appendChild(container);
      
      iframe.addEventListener('load', () => {
        iframe.contentWindow?.postMessage({ type: 'LOAD_MIDI', url }, '*');
      });
      btn.remove();
    };

    document.body.appendChild(btn);
  }

  private wrapLink(link: HTMLAnchorElement): void {
    if (link.hasAttribute('data-midi-processed')) return;
    if (link.closest('.midi-link-player')) return;
    link.setAttribute('data-midi-processed', 'true');
    const rawUrl = link.getAttribute('href') || '';
    if (!rawUrl) return;
    const absoluteUrl = this.toAbsoluteUrl(rawUrl);

    const container = document.createElement('div');
    container.className = 'midi-link-player';
    container.style.cssText = 'display: inline-flex; align-items: center; gap: 5px; margin: 0 5px; vertical-align: middle; max-width: 100%;';

    const button = document.createElement('button');
    button.textContent = '▶';
    button.title = 'Play with OwSynth';
    button.style.cssText = `
        padding: 0 6px;
        height: 20px;
        cursor: pointer; 
        background: #c0c0c0;
        color: #000;
        border: 2px solid #fff;
        border-right-color: #808080;
        border-bottom-color: #808080;
        box-shadow: 1px 1px 0 #000;
        font-family: 'MS Sans Serif', sans-serif;
        font-size: 11px;
        line-height: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    `;

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.createInlinePlayer(container, absoluteUrl);
      button.style.display = 'none';
    });

    if (link.parentNode) {
      link.parentNode.insertBefore(container, link);
      container.appendChild(button);
      container.appendChild(link);
    }
  }

  private createInlinePlayer(container: HTMLElement, midiUrl: string): void {
    if (container.querySelector('iframe')) return;

    const playerDiv = document.createElement('div');
    playerDiv.style.cssText = 'margin-top: 5px; width: 320px; clear: both; display: block; position: relative;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close player';
    closeBtn.style.cssText = `
      position: absolute;
      top: 50%;
      left: calc(100% + 6px); /* sit just right of the iframe */
      transform: translateY(-50%);
      width: 20px;
      height: 20px;
      padding: 0;
      cursor: pointer;
      background: #c0c0c0;
      color: #000;
      border: 2px solid #fff;
      border-right-color: #808080;
      border-bottom-color: #808080;
      box-shadow: 1px 1px 0 #000;
      font-family: 'MS Sans Serif', sans-serif;
      font-size: 12px;
      line-height: 12px;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = browser.runtime.getURL('player.html');
    iframe.style.cssText = 'width: 320px; height: 54px; border: none; overflow: hidden; display: block; background: transparent;';
    iframe.setAttribute('data-midi-url', midiUrl);

    closeBtn.addEventListener('click', () => {
      try {
        iframe.contentWindow?.postMessage({ type: 'STOP' }, '*');
      } catch (e) {}

      if (playerDiv.parentNode) playerDiv.parentNode.removeChild(playerDiv);
      const playBtn = container.querySelector('button');
      if (playBtn) playBtn.style.display = 'inline-flex';
    });

    playerDiv.appendChild(closeBtn);
    playerDiv.appendChild(iframe);

    if (container.parentNode) {
      container.parentNode.insertBefore(playerDiv, container.nextSibling);
    }

    iframe.addEventListener('load', () => {
      iframe.contentWindow?.postMessage({ type: 'LOAD_MIDI', url: midiUrl }, '*');
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new MidiDetector();
  });
} else {
  new MidiDetector();
}