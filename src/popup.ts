declare var browser: any;
document.getElementById('settings-btn')?.addEventListener('click', () => {
  const url = browser.runtime.getURL('settings.html');
  browser.tabs.create({ url });
});