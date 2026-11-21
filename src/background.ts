declare var browser: any;
import { getSF2, SF2Record } from './db';

class SF2CacheBroker {
    private cache: { data: ArrayBuffer; name: string; url?: string } | null = null;
    private loading: Promise<void> | null = null;

    constructor() {
        this.listenForRequests();
        this.listenForCacheInvalidation();
    }

    private listenForRequests(): void {
        browser.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
            if (message.type === 'SF2_REQUEST') {
                this.handleSF2Request().then(sendResponse);
                return true;
            }
            if (message.type === 'OPEN_TAB') {
                browser.tabs.create({ url: message.url });
                return false;
            }
            return false;
        });
    }

    private listenForCacheInvalidation(): void {
        browser.storage.onChanged.addListener((changes: any, areaName: string) => {
            if (areaName === 'local' && changes.sf2Name) {
                if (this.cache && this.cache.url) {
                    try { URL.revokeObjectURL(this.cache.url); } catch (e) {}
                }
                this.cache = null;
            }
        });
    }

    private async handleSF2Request(): Promise<{ data: string | null; name: string | null; encoding: string }> {
        if (this.loading) await this.loading;
        if (!this.cache) {
            this.loading = this.loadSF2FromDB();
            await this.loading;
            this.loading = null;
        }

        const currentCache = this.cache as { data: ArrayBuffer; name: string; url?: string } | null;
        if (currentCache) {
            if (!currentCache.url) {
                try {
                    const blob = new Blob([currentCache.data], { type: 'application/octet-stream' });
                    currentCache.url = URL.createObjectURL(blob);
                } catch (e) {
                    console.error('[SF2CacheBroker] failed to create blob URL', e);
                }
            }
            return {
                data: currentCache.url || null,
                name: currentCache.name,
                encoding: 'blob-url'
            };
        }
        return { data: null, name: null, encoding: 'none' };
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    private async loadSF2FromDB(): Promise<void> {
        try {
            const sf2Record = await getSF2() as SF2Record | null;
            if (sf2Record && sf2Record.data) {
                const uint8Array = new Uint8Array(sf2Record.data);
                const arrayBuffer = uint8Array.buffer;
                try {
                    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    this.cache = { data: arrayBuffer, name: sf2Record.name, url };
                } catch (e) {
                    this.cache = { data: arrayBuffer, name: sf2Record.name };
                }
            } else {
                this.cache = null;
            }
        } catch (error) {
            this.cache = null;
        }
    }
}

new SF2CacheBroker();