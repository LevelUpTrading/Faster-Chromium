// Faster Chromium - Popup Script
// Handles UI interactions and settings management

document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    disableAnimations: true,
    lazyLoadImages: true,
    disableAutoplay: true,
    throttleTimers: true,
    prefetchDNS: true,
    preloadLCP: true,
    prefetchLinks: false,
    optimizeImagePriority: true,
    lazyLoadIframes: true,
    reduceMediaPreload: true,
    fontDisplaySwap: true,
    contentVisibility: true,
    stabilizeLayout: true,
    nonBlockingCSS: true,
    deferScripts: false,
    passiveListeners: true
  };

  const FEATURE_KEYS = [
    'disableAnimations', 'lazyLoadImages', 'disableAutoplay', 'throttleTimers',
    'prefetchDNS', 'preloadLCP', 'prefetchLinks', 'optimizeImagePriority',
    'lazyLoadIframes', 'reduceMediaPreload', 'fontDisplaySwap', 'contentVisibility',
    'stabilizeLayout', 'nonBlockingCSS', 'deferScripts', 'passiveListeners'
  ];

  let currentSettings = { ...DEFAULT_SETTINGS };

  const mainToggle = document.getElementById('mainToggle');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const activeFeatures = document.getElementById('activeFeatures');
  const imagesOptimized = document.getElementById('imagesOptimized');
  const estSaved = document.getElementById('estSaved');
  const refreshBtn = document.getElementById('refreshBtn');
  const resetBtn = document.getElementById('resetBtn');
  const alertBanner = document.getElementById('alertBanner');
  const alertText = document.getElementById('alertText');

  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error loading settings:', chrome.runtime.lastError);
          resolve(DEFAULT_SETTINGS);
          return;
        }
        if (response && response.settings) {
          currentSettings = { ...DEFAULT_SETTINGS, ...response.settings };
        }
        resolve(currentSettings);
      });
    });
  }

  async function saveSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: currentSettings }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error saving settings:', chrome.runtime.lastError);
        }
        resolve(response);
      });
    });
  }

  function updateUI() {
    if (currentSettings.enabled) {
      mainToggle.classList.add('active');
      statusIndicator.classList.remove('inactive');
      statusText.textContent = 'Active';
      document.body.classList.remove('disabled');
    } else {
      mainToggle.classList.remove('active');
      statusIndicator.classList.add('inactive');
      statusText.textContent = 'Disabled';
      document.body.classList.add('disabled');
    }

    document.querySelectorAll('.option').forEach(option => {
      const settingName = option.dataset.setting;
      const toggle = option.querySelector('.toggle');

      if (currentSettings[settingName]) {
        toggle.classList.add('checked');
      } else {
        toggle.classList.remove('checked');
      }
    });
  }

  function updateStats() {
    // Count active features
    const activeCount = FEATURE_KEYS.filter(k => currentSettings[k]).length;
    activeFeatures.textContent = activeCount;

    // Try to get metrics from content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_METRICS' }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        const metrics = response.metrics;
        imagesOptimized.textContent = metrics.imagesOptimized || 0;

        // Estimate time saved based on concrete optimizations applied
        let savedMs = 0;
        savedMs += (metrics.imagesOptimized || 0) * 15;     // fetchpriority + async decode
        savedMs += (metrics.iframesLazyLoaded || 0) * 150;  // deferred iframe loads
        savedMs += (metrics.mediaOptimized || 0) * 100;     // prevented full preloads
        savedMs += (metrics.cssNonBlocked || 0) * 80;       // non-blocking stylesheets
        savedMs += (metrics.dnsPrefetched || 0) * 40;       // DNS pre-resolution
        savedMs += (metrics.linksPrefetched || 0) * 200;    // prefetched next-page
        if (metrics.animationsDisabled) savedMs += 30;       // reduced paint work
        savedMs = Math.round(savedMs);
        estSaved.textContent = savedMs >= 1000
          ? '~' + (savedMs / 1000).toFixed(1) + 's'
          : '~' + savedMs + 'ms';
      });
    });

    // Update alert text
    if (currentSettings.enabled) {
      alertBanner.classList.remove('warning');
      alertText.textContent = `${activeCount} optimizations active on this page.`;
    } else {
      alertBanner.classList.add('warning');
      alertText.textContent = 'Extension is disabled. Enable to optimize pages.';
    }
  }

  mainToggle.addEventListener('click', async () => {
    currentSettings.enabled = !currentSettings.enabled;
    updateUI();
    updateStats();
    await saveSettings();
  });

  document.querySelectorAll('.option').forEach(option => {
    option.addEventListener('click', async () => {
      const settingName = option.dataset.setting;
      const toggle = option.querySelector('.toggle');

      currentSettings[settingName] = !currentSettings[settingName];

      if (currentSettings[settingName]) {
        toggle.classList.add('checked');
      } else {
        toggle.classList.remove('checked');
      }

      updateStats();
      await saveSettings();
    });
  });

  refreshBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id);
        window.close();
      }
    });
  });

  resetBtn.addEventListener('click', async () => {
    currentSettings = { ...DEFAULT_SETTINGS };
    updateUI();
    updateStats();
    await saveSettings();
  });

  document.getElementById('helpLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/faster-chromium/extension#readme' });
  });

  await loadSettings();
  updateUI();
  updateStats();

  // Re-check metrics after page has had time to load
  setTimeout(updateStats, 3000);
});
