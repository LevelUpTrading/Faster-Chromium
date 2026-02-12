// Faster Chromium - Content Script
// Handles DOM-level performance optimizations

(function() {
  'use strict';

  let settings = null;
  let observer = null;
  let optimizationsApplied = false;
  let cleanupScheduled = false;
  let performanceMetrics = {
    startTime: performance.now(),
    loadTime: null,
    animationsDisabled: 0,
    imagesOptimized: 0,
    iframesLazyLoaded: 0,
    mediaOptimized: 0,
    cssNonBlocked: 0,
    scriptsDeferred: 0,
    linksPrefetched: 0,
    dnsPrefetched: 0
  };
  let contextValid = true;

  // Check if extension context is still valid (becomes invalid when extension is reloaded)
  function isContextValid() {
    try {
      return contextValid && !!chrome.runtime?.id;
    } catch (e) {
      contextValid = false;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      return false;
    }
  }

  // =========================================================================
  //  EXISTING PERFORMANCE FEATURES
  // =========================================================================

  function disableAnimations() {
    if (!settings.disableAnimations) return;

    const styleId = 'faster-chromium-disable-animations';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-delay: 0ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        transition-delay: 0ms !important;
        scroll-behavior: auto !important;
      }
    `;
    const target = document.head || document.documentElement;
    target.appendChild(style);
    performanceMetrics.animationsDisabled = 1;
  }

  function setupLazyLoading() {
    if (!settings.lazyLoadImages) return;

    document.querySelectorAll('img:not([loading])').forEach(img => {
      img.setAttribute('loading', 'lazy');
    });
  }

  function setupLazyLoadIframes() {
    if (!settings.lazyLoadIframes) return;

    document.querySelectorAll('iframe:not([loading])').forEach(iframe => {
      // Skip tiny iframes (tracking pixels) and same-page anchors
      if (iframe.width && parseInt(iframe.width) <= 1) return;
      if (iframe.height && parseInt(iframe.height) <= 1) return;
      iframe.setAttribute('loading', 'lazy');
      performanceMetrics.iframesLazyLoaded++;
    });
  }

  function disableAutoplay() {
    if (!settings.disableAutoplay) return;

    document.querySelectorAll('video[autoplay]').forEach(video => {
      video.removeAttribute('autoplay');
      video.pause();
    });

    document.querySelectorAll('audio[autoplay]').forEach(audio => {
      audio.removeAttribute('autoplay');
      audio.pause();
    });
  }

  function reduceMediaPreload() {
    if (!settings.reduceMediaPreload) return;

    document.querySelectorAll('video:not([data-fc-media-opt]), audio:not([data-fc-media-opt])').forEach(media => {
      media.setAttribute('data-fc-media-opt', '');
      const preload = media.getAttribute('preload');
      // Downgrade "auto" (full file) to "metadata" (tiny header only)
      if (!preload || preload === 'auto') {
        media.setAttribute('preload', 'metadata');
        performanceMetrics.mediaOptimized++;
      }
    });
  }

  // =========================================================================
  //  NEW: RESOURCE LOADING OPTIMIZATIONS
  // =========================================================================

  function setupDNSPrefetch() {
    if (!settings.prefetchDNS) return;

    const origins = new Set();
    const selectors = 'a[href], img[src], script[src], link[href]';

    document.querySelectorAll(selectors).forEach(el => {
      const url = el.href || el.src || el.getAttribute('href');
      if (!url) return;
      try {
        const parsed = new URL(url, location.href);
        if (parsed.origin !== location.origin && parsed.protocol.startsWith('http')) {
          origins.add(parsed.origin);
        }
      } catch (e) {}
    });

    let count = 0;
    for (const origin of origins) {
      if (count >= 10) break;

      // Skip if hints already exist
      if (document.querySelector(`link[rel="dns-prefetch"][href="${origin}"]`)) continue;

      const dns = document.createElement('link');
      dns.rel = 'dns-prefetch';
      dns.href = origin;
      document.head.appendChild(dns);

      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = origin;
      preconnect.crossOrigin = 'anonymous';
      document.head.appendChild(preconnect);

      count++;
      performanceMetrics.dnsPrefetched++;
    }
  }

  function preloadLCPCandidate() {
    if (!settings.preloadLCP) return;

    const images = document.querySelectorAll('img[src]');
    let largestImg = null;
    let largestArea = 0;

    images.forEach(img => {
      const rect = img.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0 &&
          rect.left < window.innerWidth && rect.right > 0) {
        const area = rect.width * rect.height;
        if (area > largestArea) {
          largestArea = area;
          largestImg = img;
        }
      }
    });

    if (largestImg && largestImg.src && largestArea > 5000) {
      if (!document.querySelector(`link[rel="preload"][href="${CSS.escape(largestImg.src)}"]`)) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = largestImg.src;
        document.head.appendChild(link);
      }
    }
  }

  function optimizeImageLoading() {
    if (!settings.optimizeImagePriority) return;

    const viewportHeight = window.innerHeight;
    document.querySelectorAll('img').forEach(img => {
      if (img.hasAttribute('data-fc-optimized')) return;
      img.setAttribute('data-fc-optimized', '');

      // decoding="async" for all images
      if (!img.hasAttribute('decoding')) {
        img.setAttribute('decoding', 'async');
      }

      // fetchpriority based on viewport position
      if (!img.hasAttribute('fetchpriority')) {
        const rect = img.getBoundingClientRect();
        if (rect.top < viewportHeight && rect.bottom > 0) {
          img.setAttribute('fetchpriority', 'high');
        } else {
          img.setAttribute('fetchpriority', 'low');
        }
      }

      performanceMetrics.imagesOptimized++;
    });
  }

  function prefetchVisibleLinks() {
    if (!settings.prefetchLinks) return;

    const prefetched = new Set();
    const MAX_PREFETCH = 5;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        if (prefetched.size >= MAX_PREFETCH) return;

        const href = entry.target.href;
        if (!href || prefetched.has(href)) return;

        try {
          const url = new URL(href);
          // Only prefetch same-origin, HTTP(S), different-path links
          if (url.origin !== location.origin) return;
          if (url.pathname === location.pathname) return;
          if (!url.protocol.startsWith('http')) return;
          // Skip URLs with query params (may contain tokens, trigger side effects)
          if (url.search) return;
          // Skip paths that commonly trigger state-changing actions
          if (/\/(logout|signout|delete|remove|unsubscribe|revoke)/i.test(url.pathname)) return;

          requestIdleCallback(() => {
            if (prefetched.size >= MAX_PREFETCH) return;
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = href;
            document.head.appendChild(link);
            prefetched.add(href);
            performanceMetrics.linksPrefetched++;
          }, { timeout: 2000 });
        } catch (e) {}

        io.unobserve(entry.target);
      });
    });

    document.querySelectorAll('a[href]').forEach(a => {
      io.observe(a);
    });
  }

  // =========================================================================
  //  NEW: RENDERING OPTIMIZATIONS
  // =========================================================================

  function injectFontDisplaySwap() {
    if (!settings.fontDisplaySwap) return;

    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSFontFaceRule) {
              rule.style.fontDisplay = 'swap';
            }
          }
        } catch (e) {
          // Cross-origin stylesheets throw SecurityError - skip them
        }
      }
    } catch (e) {}
  }

  function injectContentVisibility() {
    if (!settings.contentVisibility) return;

    const styleId = 'faster-chromium-content-visibility';
    if (document.getElementById(styleId)) return;

    const viewportHeight = window.innerHeight;
    const candidates = document.querySelectorAll('section, article, main > div, [role="region"]');
    let tagged = 0;

    candidates.forEach(el => {
      const rect = el.getBoundingClientRect();
      // Only apply to elements well below the fold and reasonably sized
      if (rect.top > viewportHeight * 1.5 && rect.height > 100) {
        el.setAttribute('data-fc-cv', '');
        tagged++;
      }
    });

    if (tagged > 0) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        [data-fc-cv] {
          content-visibility: auto;
          contain-intrinsic-size: auto 500px;
        }
      `;
      document.head.appendChild(style);
    }
  }

  function stabilizeImageLayout() {
    if (!settings.stabilizeLayout) return;

    document.querySelectorAll('img:not([data-fc-stabilized])').forEach(img => {
      // Skip images that already have both width and height
      if (img.hasAttribute('width') && img.hasAttribute('height')) return;

      if (img.naturalWidth && img.naturalHeight) {
        img.setAttribute('width', img.naturalWidth);
        img.setAttribute('height', img.naturalHeight);
        img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        img.setAttribute('data-fc-stabilized', '');
      } else {
        // Wait for image to load, then fill in dimensions
        img.addEventListener('load', function onLoad() {
          if (img.naturalWidth && img.naturalHeight && !img.hasAttribute('data-fc-stabilized')) {
            img.setAttribute('width', img.naturalWidth);
            img.setAttribute('height', img.naturalHeight);
            img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
            img.setAttribute('data-fc-stabilized', '');
          }
        }, { once: true });
      }
    });
  }

  // =========================================================================
  //  NEW: RENDER-BLOCKING CSS MITIGATION
  // =========================================================================

  function handleNewStylesheet(link) {
    if (!settings.nonBlockingCSS) return;
    if (link.rel !== 'stylesheet' || !link.href) return;
    if (link.hasAttribute('data-fc-nb')) return;
    // Skip already-loaded stylesheets — no benefit in toggling media
    if (link.sheet) return;
    // Skip stylesheets with targeted media queries (already non-blocking)
    if (link.media && link.media !== 'all' && link.media !== '') return;

    link.setAttribute('data-fc-nb', '');
    link.media = 'print';
    link.addEventListener('load', () => {
      link.media = 'all';
    }, { once: true });
    performanceMetrics.cssNonBlocked++;
  }

  // =========================================================================
  //  CORE INFRASTRUCTURE
  // =========================================================================

  function scheduleCleanup() {
    if (cleanupScheduled || !isContextValid()) return;
    cleanupScheduled = true;
    requestIdleCallback(() => {
      cleanupScheduled = false;
      if (!isContextValid()) return;
      setupLazyLoading();
      setupLazyLoadIframes();
      optimizeImageLoading();
      disableAutoplay();
      reduceMediaPreload();
      stabilizeImageLayout();
    }, { timeout: 200 });
  }

  function setupMutationObserver() {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver((mutations) => {
      if (!isContextValid()) return;

      let hasNewElements = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Make new stylesheets non-render-blocking
          if (node.tagName === 'LINK') {
            handleNewStylesheet(node);
          }

          // Check child stylesheets in added subtrees
          if (node.querySelectorAll) {
            const links = node.querySelectorAll('link[rel="stylesheet"]');
            links.forEach(link => handleNewStylesheet(link));
          }

          hasNewElements = true;
        }
      }

      if (hasNewElements) {
        scheduleCleanup();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function injectPageScript() {
    if (!isContextValid()) return;
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.dataset.fasterChromiumSettings = JSON.stringify({
        throttleTimers: settings.throttleTimers,
        passiveListeners: settings.passiveListeners,
        deferScripts: settings.deferScripts
      });
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
    } catch (e) {}
  }

  function onDOMContentLoaded() {
    setupLazyLoading();
    setupLazyLoadIframes();
    disableAutoplay();
    reduceMediaPreload();
    optimizeImageLoading();
    setupDNSPrefetch();
    preloadLCPCandidate();
    injectFontDisplaySwap();
    injectContentVisibility();
    stabilizeImageLayout();
  }

  function onLoad() {
    // Freeze load time at the load event — stops the counter from growing
    if (performanceMetrics.loadTime == null) {
      performanceMetrics.loadTime = performance.now() - performanceMetrics.startTime;
    }
    stabilizeImageLayout();
    prefetchVisibleLinks();
  }

  function applyOptimizations() {
    if (optimizationsApplied || !settings || !settings.enabled) return;
    optimizationsApplied = true;

    // --- document_start phase ---
    injectPageScript();
    disableAnimations();

    // --- DOMContentLoaded / load phases ---
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMContentLoaded);
      window.addEventListener('load', onLoad);
    } else if (document.readyState === 'interactive') {
      onDOMContentLoaded();
      window.addEventListener('load', onLoad);
    } else {
      onDOMContentLoaded();
      onLoad();
    }

    setupMutationObserver();

    console.log('[Faster Chromium] Optimizations applied:', performanceMetrics);
  }

  function removeInjectedStyles() {
    ['faster-chromium-disable-animations', 'faster-chromium-content-visibility'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    // Remove content-visibility data attributes
    document.querySelectorAll('[data-fc-cv]').forEach(el => {
      el.removeAttribute('data-fc-cv');
    });
  }

  // =========================================================================
  //  INITIALIZATION
  // =========================================================================

  function init() {
    if (!isContextValid()) return;
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('[Faster Chromium] Could not connect to background script');
          return;
        }

        if (response && response.settings) {
          settings = response.settings;
          applyOptimizations();
        }
      });
    } catch (e) {
      contextValid = false;
    }
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!isContextValid()) return;

      if (message.type === 'SETTINGS_UPDATED') {
        settings = message.settings;
        optimizationsApplied = false;

        if (settings.enabled) {
          applyOptimizations();
        } else {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          removeInjectedStyles();
        }
      }

      if (message.type === 'GET_METRICS') {
        sendResponse({
          metrics: {
            ...performanceMetrics,
            loadTime: performanceMetrics.loadTime != null
              ? performanceMetrics.loadTime
              : performance.now() - performanceMetrics.startTime
          }
        });
        return true;
      }

      if (message.type === 'REFRESH_OPTIMIZATIONS') {
        optimizationsApplied = false;
        applyOptimizations();
        sendResponse({ success: true });
        return true;
      }
    });
  } catch (e) {
    contextValid = false;
  }

  if (typeof requestIdleCallback === 'undefined') {
    window.requestIdleCallback = function(callback, options) {
      const timeout = options?.timeout || 50;
      return setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);
    };
  }

  init();
})();
