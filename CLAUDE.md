# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Faster Chromium is a Chrome/Edge Extension (Manifest V3) that improves website performance through smart resource loading, rendering optimizations, and runtime tuning. Written in vanilla JavaScript with no build tools, dependencies, or test framework. Does **not** block ads/trackers — designed to run alongside uBlock Origin without conflicts.

## Development

**No build step required.** Load the extension directly in Chrome/Edge:
1. Navigate to `chrome://extensions/` (or `edge://extensions/`)
2. Enable Developer Mode
3. Click "Load unpacked" and select this folder

After code changes, click the reload button on the extension card (or Ctrl+R on the card). For content script changes, also reload the target page.

There are no automated tests, linting, or formatting tools configured.

## Architecture

The extension operates at four layers:

### Layer 1: Settings — `background.js` (Service Worker)
Manages settings in `chrome.storage.sync` under the key `fasterChromiumSettings`. Acts as the central message hub between popup and content scripts. Handles settings migration from v1.x on extension update.

### Layer 2: DOM — `content.js` (Content Script)
Injected at `document_start` on all pages. Applies performance optimizations across three phases:

- **document_start**: Injects `injected.js` into page context, disables CSS animations, sets up MutationObserver
- **DOMContentLoaded**: Lazy loading (images + iframes), autoplay prevention, media preload reduction, image optimization (priority/decoding), DNS prefetch/preconnect, LCP preload, font-display swap, content-visibility, layout stabilization
- **load**: Second-pass layout stabilization (naturalWidth available), link prefetching via IntersectionObserver, load time capture (frozen at this event)

Uses a debounced `requestIdleCallback` scheduler to apply optimizations to dynamically added elements. The MutationObserver also intercepts new `<link rel="stylesheet">` elements to apply the non-blocking CSS pattern before they block rendering.

### Layer 3: Runtime — `injected.js` (Page Context)
Injected into the actual page context (not the isolated content script world) via a `<script>` tag by `content.js`. This runs under the **page's CSP**, not the extension's CSP — critical for script deferral which creates new `<script>` elements. Contains:

- **Timer throttling**: Monkey-patches `setInterval`/`setTimeout` for min delays (100ms/10ms)
- **Passive event listeners**: Patches `EventTarget.prototype.addEventListener` to force passive on scroll/touch events
- **Script deferral**: MutationObserver that intercepts synchronous same-origin scripts and replaces them with deferred versions (skips scripts with nonce/integrity attributes and cross-origin scripts)

### Layer 4: UI — `popup.html` + `popup.js`
Settings interface with master toggle, per-feature toggles organized in three sections (Resource Loading, Rendering, Scripts & Interaction), live stats (active features, images optimized, estimated time saved), and refresh/reset actions. Dark theme with green (#22c55e) accent.

## Message Protocol

Components communicate via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`:

| Message Type | Direction | Purpose |
|---|---|---|
| `GET_SETTINGS` | Popup/Content → Background | Retrieve current settings |
| `SAVE_SETTINGS` | Popup → Background | Persist settings |
| `SETTINGS_UPDATED` | Background → All tabs | Broadcast after settings change |
| `GET_METRICS` | Popup → Content | Get performance metrics for active tab |
| `TOGGLE_ENABLED` | Any → Background | Toggle master switch |
| `REFRESH_OPTIMIZATIONS` | Popup → Content | Reapply all optimizations |

## Settings

All settings default to `true` except `prefetchLinks` (uses bandwidth) and `deferScripts` (can break pages).

| Setting | Description |
|---|---|
| `enabled` | Master toggle |
| `disableAnimations` | Suppress CSS animations/transitions |
| `lazyLoadImages` | Add native `loading="lazy"` to images |
| `lazyLoadIframes` | Add native `loading="lazy"` to iframes (skips 1x1 tracking pixels) |
| `disableAutoplay` | Pause video/audio autoplay |
| `reduceMediaPreload` | Downgrade `preload="auto"` to `preload="metadata"` on video/audio |
| `throttleTimers` | Enforce min timer delays (100ms interval, 10ms timeout) |
| `prefetchDNS` | DNS prefetch + preconnect for third-party domains (max 10) |
| `preloadLCP` | Preload largest visible image |
| `prefetchLinks` | Prefetch same-origin visible links during idle (max 5) |
| `optimizeImagePriority` | Set `fetchpriority` high/low + `decoding="async"` |
| `fontDisplaySwap` | Set `font-display: swap` on same-origin @font-face rules |
| `nonBlockingCSS` | Make render-blocking stylesheets non-blocking via `media="print"` + `onload` pattern |
| `contentVisibility` | Apply `content-visibility: auto` to off-screen sections |
| `stabilizeLayout` | Set explicit dimensions on images to reduce CLS |
| `deferScripts` | Defer synchronous same-origin scripts (experimental, runs in page context via `injected.js`) |
| `passiveListeners` | Force passive on scroll/touch event listeners |

## Conventions

- Each script file uses an IIFE wrapper for namespace isolation
- `'use strict'` throughout
- Async/await for storage operations
- Silent error handling (`.catch(() => {})`) on cross-tab messaging since tabs may not have listeners
- `requestIdleCallback` with debounced scheduling for deferred cleanup work
- Data attributes track which elements have been processed to avoid duplicate work:
  - `data-fc-optimized` — image priority/decoding applied
  - `data-fc-stabilized` — explicit dimensions set
  - `data-fc-cv` — content-visibility applied
  - `data-fc-media-opt` — media preload reduced
  - `data-fc-nb` — non-blocking CSS applied
- Style IDs for injected CSS to enable clean removal:
  - `faster-chromium-disable-animations`
  - `faster-chromium-content-visibility`

## Key Design Decisions

- **Script deferral runs in page context (`injected.js`), not content script**: Content scripts run in the extension's isolated world. Elements created there are evaluated under the extension's CSP (which only allows `chrome-extension://` sources), causing CSP violations for any page script URL. Running in the page context avoids this.
- **Script deferral skips nonce/integrity scripts**: Browser security clears nonce values after parsing, so cloned scripts can't inherit CSP nonce allowances. Similarly, changing load behavior could break SRI integrity checks.
- **Non-blocking CSS intercepts via MutationObserver**: Must catch `<link>` elements before the browser blocks rendering on them. Applied at DOM insertion time, not at DOMContentLoaded (which is too late — blocking has already occurred).
