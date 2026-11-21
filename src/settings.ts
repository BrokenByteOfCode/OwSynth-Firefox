declare var browser: any;
import { saveSF2, clearSF2 } from './db';

const browseBtn = document.getElementById('browse-btn') as HTMLButtonElement;
const fileInput = document.getElementById('sf2-file-input') as HTMLInputElement;
const fileNameDisplay = document.getElementById('current-file-name') as HTMLInputElement;
const useSineCheckbox = document.getElementById('use-sine-checkbox') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const blacklistInput = document.getElementById('blacklist-input') as HTMLInputElement;
const blacklistAddBtn = document.getElementById('blacklist-add-btn') as HTMLButtonElement;
const blacklistList = document.getElementById('blacklist-list') as HTMLUListElement;

let pendingData: ArrayBuffer | null = null;
let pendingName: string | null = null;
let blacklist: string[] = [];

browseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file || !file.name.toLowerCase().endsWith('.sf2')) return;
  try {
    pendingData = await file.arrayBuffer();
    pendingName = file.name;
    fileNameDisplay.value = file.name + " (Unapplied)";
  } catch (e) {}
});

function renderBlacklist() {
  blacklistList.innerHTML = '';
  blacklist.forEach((b, idx) => {
    const li = document.createElement('li');
    li.style.cssText = 'display:flex; justify-content:space-between; gap:8px; padding:4px 6px; border-bottom:1px solid #e0e0e0;';
    const span = document.createElement('span');
    span.textContent = b;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.style.cssText = 'padding:2px 6px; font-size:11px;';
    btn.addEventListener('click', async () => {
      blacklist.splice(idx, 1);
      await browser.storage.local.set({ blacklist });
      renderBlacklist();
    });
    li.appendChild(span);
    li.appendChild(btn);
    blacklistList.appendChild(li);
  });
}

blacklistAddBtn.addEventListener('click', async () => {
  const val = (blacklistInput.value || '').trim().toLowerCase();
  if (!val) return;
  if (!blacklist.includes(val)) {
    blacklist.push(val);
    await browser.storage.local.set({ blacklist });
    renderBlacklist();
    blacklistInput.value = '';
  }
});

saveBtn.addEventListener('click', async () => {
  try {
    await browser.storage.local.set({ useSine: useSineCheckbox.checked, blacklist });
    if (pendingData && pendingName) {
      await saveSF2(pendingName, pendingData);
      await browser.storage.local.set({ sf2Name: pendingName });
      fileNameDisplay.value = pendingName;
      pendingData = null;
    }
    statusDiv.textContent = 'Saved!';
  } catch (e) {}
});

resetBtn.addEventListener('click', async () => {
  await clearSF2();
  await browser.storage.local.clear();
  useSineCheckbox.checked = false;
  fileNameDisplay.value = '';
  blacklist = [];
  renderBlacklist();
});

async function init() {
  const res = await browser.storage.local.get(['useSine', 'sf2Name', 'blacklist']);
  if (res.useSine) useSineCheckbox.checked = true;
  if (res.sf2Name) fileNameDisplay.value = res.sf2Name;
  blacklist = Array.isArray(res.blacklist) ? res.blacklist.map((s: string) => s.toLowerCase().trim()) : [];
  renderBlacklist();
}

init();