// Faster Chromium - Background Service Worker
// Settings management and tab coordination

'use strict';

const DEFAULT_SETTINGS = {
  enabled: true,
  // Existing performance features
  disableAnimations: true,
  lazyLoadImages: true,
  disableAutoplay: true,
  throttleTimers: true,
  // Resource Loading
  prefetchDNS: true,
  preloadLCP: true,
  prefetchLinks: false,
  optimizeImagePriority: true,
  lazyLoadIframes: true,
  reduceMediaPreload: true,
  // Rendering
  fontDisplaySwap: true,
  contentVisibility: true,
  stabilizeLayout: true,
  nonBlockingCSS: true,
  // Scripts & Interaction
  deferScripts: false,
  passiveListeners: true
};

let currentSettings = { ...DEFAULT_SETTINGS };
let activeContentScripts = new Set();

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get('fasterChromiumSettings');
    if (result.fasterChromiumSettings) {
      currentSettings = { ...DEFAULT_SETTINGS, ...result.fasterChromiumSettings };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return currentSettings;
}

async function saveSettings(settings) {
  currentSettings = { ...DEFAULT_SETTINGS, ...settings };
  try {
    await chrome.storage.sync.set({ fasterChromiumSettings: currentSettings });
    notifyAllTabs();
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

function notifyAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_UPDATED',
          settings: currentSettings
        }).catch(() => {});
      }
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    if (sender.tab?.id) {
      activeContentScripts.add(sender.tab.id);
    }
    loadSettings().then(settings => {
      sendResponse({ settings });
    });
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    saveSettings(message.settings).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'TOGGLE_ENABLED') {
    currentSettings.enabled = !currentSettings.enabled;
    saveSettings(currentSettings).then(() => {
      sendResponse({ enabled: currentSettings.enabled });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeContentScripts.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    activeContentScripts.delete(tabId);
  }
});

loadSettings();

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') {
    // Migrate settings from v1.x
    const result = await chrome.storage.sync.get('fasterChromiumSettings');
    if (result.fasterChromiumSettings) {
      const old = result.fasterChromiumSettings;
      // Rename blockAnimations -> disableAnimations
      if ('blockAnimations' in old && !('disableAnimations' in old)) {
        old.disableAnimations = old.blockAnimations;
      }
      // Remove old blocking keys
      const oldKeys = [
        'blockTracking', 'blockAds', 'blockSocialWidgets', 'blockChatWidgets',
        'blockWebFonts', 'blockImages', 'blockThirdPartyScripts', 'aggressiveMode',
        'blockAnimations'
      ];
      for (const key of oldKeys) {
        delete old[key];
      }
      await chrome.storage.sync.set({ fasterChromiumSettings: { ...DEFAULT_SETTINGS, ...old } });
    }
  }
  loadSettings();
});
