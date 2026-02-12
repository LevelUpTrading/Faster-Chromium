// Faster Chromium - Injected Script
// Runs in the actual page context (not isolated world) for JS-level performance tuning

(function() {
  'use strict';

  const scriptTag = document.currentScript;
  let injectedSettings = { throttleTimers: false, passiveListeners: false, deferScripts: false };
  if (scriptTag && scriptTag.dataset.fasterChromiumSettings) {
    try {
      injectedSettings = JSON.parse(scriptTag.dataset.fasterChromiumSettings);
    } catch (e) {}
  }

  // --- Timer throttling ---
  // Enforces minimum delays on setInterval/setTimeout to reduce CPU usage
  // from aggressive polling loops in page scripts

  if (injectedSettings.throttleTimers) {
    const originalSetInterval = window.setInterval;
    const originalSetTimeout = window.setTimeout;
    const minInterval = 100;
    const minTimeout = 10;

    window.setInterval = function(callback, delay, ...args) {
      const minDelay = Math.max(delay || 0, minInterval);
      return originalSetInterval.call(window, callback, minDelay, ...args);
    };

    window.setTimeout = function(callback, delay, ...args) {
      const minDelay = Math.max(delay || 0, minTimeout);
      return originalSetTimeout.call(window, callback, minDelay, ...args);
    };
  }

  // --- Passive event listeners ---
  // Forces passive: true on scroll/touch event listeners to prevent
  // them from blocking the compositor thread during scrolling

  if (injectedSettings.passiveListeners) {
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    // Only touch and scroll events — NOT wheel/mousewheel, which need preventDefault()
    // for custom scroll containers, zoom prevention, carousels, etc.
    const passiveEvents = new Set(['touchstart', 'touchmove', 'scroll']);

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (passiveEvents.has(type)) {
        let opts;
        if (typeof options === 'boolean' || options === undefined) {
          opts = { capture: !!options, passive: true };
        } else if (typeof options === 'object' && options !== null) {
          opts = { ...options, passive: true };
        } else {
          opts = { passive: true };
        }
        return originalAddEventListener.call(this, type, listener, opts);
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
  }

  // --- Script deferral ---
  // Intercepts parser-inserted scripts and replaces them with deferred versions.
  // This MUST run in the page context (not content script isolated world) because
  // elements created by content scripts are evaluated under the extension's CSP,
  // which blocks all non-extension script URLs. In the page context,
  // createElement('script') produces elements under the page's own CSP.

  if (injectedSettings.deferScripts) {
    function deferScript(script) {
      if (!script.src) return;
      if (script.hasAttribute('async') || script.hasAttribute('defer') || script.type === 'module') return;
      if (script.hasAttribute('nomodule')) return;
      // Skip scripts with nonce/integrity — cloned elements can't inherit CSP nonce allowances
      if (script.nonce || script.hasAttribute('integrity')) return;
      // Only defer same-origin scripts to stay within page CSP 'self' scope
      try {
        if (new URL(script.src, location.href).origin !== location.origin) return;
      } catch (e) { return; }

      const deferred = document.createElement('script');
      deferred.src = script.src;
      deferred.defer = true;
      for (const attr of script.attributes) {
        if (attr.name !== 'src' && attr.name !== 'defer' && attr.name !== 'type') {
          deferred.setAttribute(attr.name, attr.value);
        }
      }
      if (script.parentNode) {
        script.parentNode.replaceChild(deferred, script);
      }
    }

    const deferObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === 'SCRIPT') deferScript(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('script').forEach(deferScript);
          }
        }
      }
    });

    const target = document.documentElement || document;
    deferObserver.observe(target, { childList: true, subtree: true });
  }
})();
