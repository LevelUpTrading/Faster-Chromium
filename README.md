# Faster Chromium - Speed Up Any Website

A Chrome/Edge Extension (Manifest V3) that improves website performance through smart resource loading, rendering optimizations, and runtime tuning. Written in vanilla JavaScript with no build tools or dependencies.

**Does not block ads or trackers** -- designed to run alongside uBlock Origin without conflicts.

## Installation

1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

After code changes, click the reload button on the extension card. For content script changes, also reload the target page.

## Features

### Resource Loading

| Feature | Default | Description |
|---------|---------|-------------|
| DNS Prefetch | ON | Injects `dns-prefetch` and `preconnect` hints for third-party domains (max 10) |
| Preload Hero Image | ON | Detects and preloads the largest visible image (LCP candidate) |
| Image Priority | ON | Sets `fetchpriority` high/low based on viewport position and `decoding="async"` |
| Lazy Load Images | ON | Adds `loading="lazy"` to images missing the attribute |
| Lazy Load Iframes | ON | Adds `loading="lazy"` to iframes (YouTube embeds, maps, social widgets) |
| Reduce Media Preload | ON | Downgrades `preload="auto"` to `preload="metadata"` on video/audio elements |
| Prefetch Links | OFF | Prefetches same-origin visible links during idle time (max 5, uses bandwidth) |

### Rendering

| Feature | Default | Description |
|---------|---------|-------------|
| Disable Animations | ON | Suppresses CSS animations, transitions, and smooth scroll |
| Stop Autoplay | ON | Pauses video/audio autoplay elements |
| Font Display Swap | ON | Sets `font-display: swap` on same-origin `@font-face` rules to prevent invisible text flash |
| Non-Blocking CSS | ON | Makes render-blocking stylesheets non-blocking via `media="print"` + `onload` pattern |
| Content Visibility | ON | Applies `content-visibility: auto` to off-screen sections for skip rendering |
| Stabilize Layout | ON | Sets explicit width/height on images to reduce Cumulative Layout Shift (CLS) |

### Scripts & Interaction

| Feature | Default | Description |
|---------|---------|-------------|
| Throttle Timers | ON | Enforces minimum delays on `setInterval` (100ms) and `setTimeout` (10ms) |
| Passive Listeners | ON | Forces `passive: true` on scroll/touch event listeners for smoother scrolling |
| Defer Scripts | OFF | Replaces synchronous scripts with deferred versions (experimental, can break pages) |

## Architecture

The extension operates across four layers:

### Layer 1: Settings -- `background.js` (Service Worker)
Manages settings in `chrome.storage.sync` under the key `fasterChromiumSettings`. Acts as the central message hub between popup and content scripts. Handles settings migration from v1.x on extension update.

### Layer 2: DOM -- `content.js` (Content Script)
Injected at `document_start` on all pages. Applies performance optimizations across three phases:

- **document_start**: Injects `injected.js` into page context, disables CSS animations, sets up MutationObserver
- **DOMContentLoaded**: Lazy loading (images + iframes), autoplay prevention, media preload reduction, image optimization (priority/decoding), DNS prefetch/preconnect, LCP preload, font-display swap, non-blocking CSS, content-visibility, layout stabilization
- **load**: Second-pass layout stabilization, link prefetching via IntersectionObserver, load time capture

Uses a debounced `requestIdleCallback` scheduler to apply optimizations to dynamically added elements. The MutationObserver also intercepts new `<link rel="stylesheet">` elements to apply the non-blocking CSS pattern before they block rendering.

### Layer 3: Runtime -- `injected.js` (Page Context)
Injected into the actual page context (not the isolated content script world) via a `<script>` tag. This is necessary because code running in the page context operates under the page's CSP, not the extension's CSP. Contains:

- **Timer throttling**: Monkey-patches `setInterval`/`setTimeout` to enforce minimum delays
- **Passive event listeners**: Patches `EventTarget.prototype.addEventListener` to force passive on scroll/touch events
- **Script deferral**: MutationObserver that intercepts synchronous same-origin scripts and replaces them with deferred versions

### Layer 4: UI -- `popup.html` + `popup.js`
Settings interface with master toggle, per-feature toggles organized in three sections, live stats (active features, images optimized, estimated time saved), and refresh/reset actions. Dark theme with green (#22c55e) accent.

## Message Protocol

Components communicate via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`:

| Message Type | Direction | Purpose |
|---|---|---|
| `GET_SETTINGS` | Popup/Content -> Background | Retrieve current settings |
| `SAVE_SETTINGS` | Popup -> Background | Persist settings |
| `SETTINGS_UPDATED` | Background -> All tabs | Broadcast after settings change |
| `GET_METRICS` | Popup -> Content | Get performance metrics for active tab |
| `TOGGLE_ENABLED` | Any -> Background | Toggle master switch |
| `REFRESH_OPTIMIZATIONS` | Popup -> Content | Reapply all optimizations |

## Popup Stats

The popup displays three metrics for the active tab:

- **Active**: Number of enabled feature toggles
- **Images**: Count of images optimized (priority + decode attributes set)
- **Est. Saved**: Estimated time saved based on concrete optimizations applied (per-item estimates: images 15ms, iframes 150ms, media 100ms, CSS 80ms, DNS 40ms, links 200ms, animations 30ms)

## Conventions

- Each script file uses an IIFE wrapper for namespace isolation
- `'use strict'` throughout
- Async/await for storage operations
- Silent error handling (`.catch(() => {})`) on cross-tab messaging since tabs may not have listeners
- `requestIdleCallback` with debounced scheduling for deferred cleanup work
- Data attributes track processed elements to avoid duplicate work:
  - `data-fc-optimized` -- image priority/decoding applied
  - `data-fc-stabilized` -- explicit dimensions set
  - `data-fc-cv` -- content-visibility applied
  - `data-fc-media-opt` -- media preload reduced
  - `data-fc-nb` -- non-blocking CSS applied
- Style IDs for injected CSS to enable clean removal:
  - `faster-chromium-disable-animations`
  - `faster-chromium-content-visibility`

## Privacy

- No data collection or telemetry
- No external requests from the extension itself
- Settings stored in Chrome's sync storage only
- All code is visible and auditable

## License

MIT License - Free to use, modify, and distribute.
