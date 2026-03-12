# Music Manager Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the single-file Audio Manipulator PWA into a tab-based music manager with persistent library, playlists, queue, and all existing audio manipulation features preserved.

**Architecture:** The app splits from one monolithic index.html into 8 files: an HTML shell with tab navigation/mini player/Now Playing overlay, a CSS file, and 6 JS modules (storage, player, library, queue, playlists, settings). All modules attach to a shared `window.AM` namespace. The audio pipeline (BufferSource -> Gain -> EQ -> Limiter -> destination) is unchanged. Library metadata persists in localStorage; actual File objects are reconnected each session via folder loading with multi-layer matching.

**Tech Stack:** Vanilla JS (no build tools, no npm, no frameworks), Web Audio API, localStorage, CSS3, Service Worker for offline caching.

---

## Chunk 1: Foundation

### Task 1: storage.js

**Files:**
- Create: `storage.js`

- [ ] Create `storage.js` with the following complete content:

```js
// storage.js — localStorage abstraction with am- prefix keys
(function () {
    'use strict';

    const KEYS = {
        library: 'am-library',
        playlists: 'am-playlists',
        settings: 'am-settings'
    };

    function safeGet(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                return JSON.parse(raw);
            }
        } catch (e) {
            console.warn('storage: failed to read ' + key, e);
        }
        return fallback;
    }

    function safeSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.error('storage: QuotaExceededError on ' + key);
                // Show brief warning to user
                if (window.AM && window.AM.showToast) {
                    window.AM.showToast('Storage full — some data may not be saved');
                }
            } else {
                console.warn('storage: failed to write ' + key, e);
            }
            return false;
        }
    }

    function safeRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn('storage: failed to remove ' + key, e);
        }
    }

    const DEFAULT_SETTINGS = {
        autoplay: true,
        sortOrder: 'az',
        limiterEnabled: true,
        limiterCeiling: -1,
        boostWarning: true,
        eqEnabled: true,
        eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    };

    window.AM = window.AM || {};

    window.AM.storage = {
        getLibrary: function () {
            return safeGet(KEYS.library, []);
        },

        saveLibrary: function (entries) {
            return safeSet(KEYS.library, entries);
        },

        getPlaylists: function () {
            return safeGet(KEYS.playlists, []);
        },

        savePlaylists: function (playlists) {
            return safeSet(KEYS.playlists, playlists);
        },

        getSettings: function () {
            var saved = safeGet(KEYS.settings, null);
            if (saved) {
                var merged = Object.assign({}, DEFAULT_SETTINGS, saved);
                if (!Array.isArray(merged.eqBands) || merged.eqBands.length !== 10) {
                    merged.eqBands = DEFAULT_SETTINGS.eqBands.slice();
                }
                return merged;
            }
            return Object.assign({}, DEFAULT_SETTINGS, { eqBands: DEFAULT_SETTINGS.eqBands.slice() });
        },

        saveSettings: function (settings) {
            return safeSet(KEYS.settings, settings);
        },

        getDefaultSettings: function () {
            return Object.assign({}, DEFAULT_SETTINGS, { eqBands: DEFAULT_SETTINGS.eqBands.slice() });
        },

        clearLibrary: function () {
            safeRemove(KEYS.library);
        },

        clearAll: function () {
            safeRemove(KEYS.library);
            safeRemove(KEYS.playlists);
            safeRemove(KEYS.settings);
        },

        getStorageUsed: function () {
            var total = 0;
            Object.values(KEYS).forEach(function (key) {
                try {
                    var item = localStorage.getItem(key);
                    if (item) total += item.length * 2; // UTF-16 chars = ~2 bytes each
                } catch (e) {}
            });
            return total;
        }
    };
})();
```

- [ ] Verify the file loads without errors by opening the browser console after Task 3 integrates it into index.html.
- [ ] Git commit: `feat: add storage.js localStorage abstraction`

---

### Task 2: styles.css

**Files:**
- Create: `styles.css`

- [ ] Create `styles.css` with the following complete content:

```css
/* styles.css — All styles for Audio Manipulator Music Manager */

/* === Reset & Base === */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    background: #0a0a0a;
    color: #e0e0e0;
    min-height: 100vh;
    overflow: hidden;
    padding-top: env(safe-area-inset-top, 0px);
}

/* === App Layout === */
.app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    max-width: 428px;
    margin: 0 auto;
}

.tab-content-area {
    flex: 1;
    overflow: hidden;
    position: relative;
}

.tab-view {
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 16px;
}

.tab-view.active {
    display: block;
}

/* === Tab Bar === */
.tab-bar {
    display: flex;
    background: #111;
    border-top: 1px solid #222;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    flex-shrink: 0;
}

.tab-bar-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 0 4px;
    background: none;
    border: none;
    color: #666;
    font-size: 10px;
    cursor: pointer;
    gap: 2px;
    transition: color 0.15s;
}

.tab-bar-btn .tab-icon {
    font-size: 20px;
    line-height: 1;
}

.tab-bar-btn .tab-label {
    font-size: 10px;
    letter-spacing: 0.3px;
}

.tab-bar-btn.active {
    color: #4a9eff;
}

/* === Mini Player === */
.mini-player {
    display: none;
    background: #1a1a1a;
    border-top: 1px solid #333;
    padding: 8px 16px;
    flex-shrink: 0;
    cursor: pointer;
    position: relative;
}

.mini-player.visible {
    display: flex;
    align-items: center;
    gap: 12px;
}

.mini-player-info {
    flex: 1;
    min-width: 0;
}

.mini-player-title {
    font-size: 13px;
    color: #e0e0e0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.mini-player-time {
    font-size: 11px;
    color: #666;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
    margin-top: 1px;
}

.mini-player-play-btn {
    width: 36px;
    height: 36px;
    background: #e0e0e0;
    border: none;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 14px;
    color: #000;
    line-height: 1;
}

.mini-player-play-btn:active {
    background: #bbb;
}

.mini-player-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: #4a9eff;
    transition: width 0.3s linear;
}

/* === Now Playing Overlay === */
.now-playing-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: #0a0a0a;
    z-index: 200;
    transform: translateY(100%);
    transition: transform 0.3s ease;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding-top: env(safe-area-inset-top, 0px);
}

.now-playing-overlay.open {
    transform: translateY(0);
}

.np-header {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 12px 16px 0;
    position: relative;
}

.np-dismiss-btn {
    position: absolute;
    left: 16px;
    background: none;
    border: none;
    color: #4a9eff;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
}

.np-header-title {
    font-size: 12px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.np-body {
    max-width: 428px;
    margin: 0 auto;
    padding: 16px;
}

.np-track-info {
    text-align: center;
    margin-bottom: 24px;
    margin-top: 24px;
}

.np-track-name {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 4px;
    word-break: break-word;
}

.np-track-sub {
    font-size: 13px;
    color: #666;
}

/* === Transport === */
.transport {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    margin-bottom: 28px;
}

.transport-btn {
    width: 44px;
    height: 44px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
}

.transport-btn:active {
    background: #333;
}

.transport-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.transport-btn .icon {
    font-size: 14px;
    color: #e0e0e0;
    line-height: 1;
}

.play-btn {
    width: 60px;
    height: 60px;
    background: #e0e0e0;
    border: none;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
}

.play-btn:active {
    background: #bbb;
}

.play-btn:disabled {
    background: #333;
    cursor: not-allowed;
}

.play-btn .icon {
    font-size: 22px;
    color: #000;
    line-height: 1;
}

.play-btn:disabled .icon {
    color: #666;
}

/* === Seek Bar === */
.seek-group {
    background: #141414;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
}

.seek-time {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
}

.seek-time span {
    font-size: 12px;
    color: #888;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
}

/* === Range Inputs === */
input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    background: #333;
    border-radius: 3px;
    outline: none;
}

input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 22px;
    height: 22px;
    background: #fff;
    border-radius: 50%;
    cursor: pointer;
}

.range-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
}

.range-labels span {
    font-size: 11px;
    color: #555;
}

/* === Control Groups (Speed/Pitch, EQ, Volume) === */
.control-group {
    background: #141414;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
}

.control-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.control-label {
    font-size: 13px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.control-value {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
}

/* === Semitone Controls === */
.semitone-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 12px;
}

.semitone-btn {
    width: 44px;
    height: 44px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #e0e0e0;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
}

.semitone-btn:active {
    background: #333;
}

.semitone-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.semitone-display {
    text-align: center;
    min-width: 80px;
}

.semitone-display .value {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
}

.semitone-display .label {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 2px;
}

/* === EQ === */
.eq-container {
    display: flex;
    align-items: stretch;
    gap: 2px;
}

.eq-db-labels {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    padding: 2px 6px 2px 0;
    font-size: 10px;
    color: #555;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
    min-width: 24px;
}

.eq-sliders {
    display: flex;
    flex: 1;
    justify-content: space-around;
    align-items: center;
    position: relative;
    padding: 4px 0;
}

.eq-sliders::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: #333;
    pointer-events: none;
    z-index: 0;
}

.eq-band {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    position: relative;
    z-index: 1;
}

.eq-band input[type="range"] {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 28px;
    height: 120px;
    background: transparent;
    margin: 0;
    padding: 0;
}

.eq-band input[type="range"]::-webkit-slider-runnable-track {
    width: 4px;
    background: #444;
    border-radius: 2px;
}

.eq-band input[type="range"]::-webkit-slider-thumb {
    width: 18px;
    height: 18px;
    background: #fff;
    border-radius: 50%;
    margin-left: -7px;
}

.eq-freq-labels {
    display: flex;
    justify-content: space-around;
    margin-top: 6px;
    padding-left: 32px;
}

.eq-freq-labels span {
    font-size: 9px;
    color: #555;
    text-align: center;
    flex: 1;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
}

.eq-reset-btn {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    color: #888;
    font-size: 12px;
    padding: 4px 10px;
    cursor: pointer;
}

.eq-reset-btn:active {
    background: #333;
}

.eq-bypassed .eq-sliders,
.eq-bypassed .eq-db-labels,
.eq-bypassed .eq-freq-labels {
    opacity: 0.3;
}

/* === Volume Boost Warning === */
.volume-warn input[type="range"] {
    background: #4d3800;
}
.volume-warn input[type="range"]::-webkit-slider-thumb {
    background: #ff9500;
}
.volume-warn .control-value {
    color: #ff9500;
}

.volume-danger input[type="range"] {
    background: #4d1a17;
}
.volume-danger input[type="range"]::-webkit-slider-thumb {
    background: #ff3b30;
}
.volume-danger .control-value {
    color: #ff3b30;
}

/* === Library Tab === */
.library-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.library-header h2 {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
}

.load-folder-btn {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #4a9eff;
    font-size: 13px;
    padding: 6px 12px;
    cursor: pointer;
}

.load-folder-btn:active {
    background: #333;
}

.load-folder-btn-large {
    display: inline-block;
    background: #4a9eff;
    border: none;
    border-radius: 10px;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    padding: 14px 32px;
    cursor: pointer;
    margin-top: 16px;
}

.load-folder-btn-large:active {
    background: #3a8eef;
}

.library-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-top: 120px;
    text-align: center;
}

.library-empty-text {
    font-size: 16px;
    color: #666;
    margin-bottom: 8px;
}

.search-bar-container {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
}

.search-input {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #e0e0e0;
    font-size: 14px;
    padding: 8px 12px;
    outline: none;
}

.search-input::placeholder {
    color: #555;
}

.search-input:focus {
    border-color: #4a9eff;
}

.filter-btn {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #888;
    font-size: 16px;
    padding: 8px 12px;
    cursor: pointer;
    flex-shrink: 0;
}

.filter-btn:active {
    background: #333;
}

.filter-btn.active-filter {
    color: #4a9eff;
    border-color: #4a9eff;
}

.sort-filter-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
}

.sort-select {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    color: #ccc;
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
}

.track-count-label {
    font-size: 12px;
    color: #666;
}

/* === Track List (shared by Library, Queue, Playlists) === */
.track-list {
    list-style: none;
}

.track-row {
    display: flex;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #1a1a1a;
    gap: 10px;
    cursor: pointer;
}

.track-row:active {
    background: #1a1a1a;
}

.track-row.unavailable {
    opacity: 0.4;
    cursor: default;
}

.track-row.now-playing-row {
    border-left: 3px solid #4a9eff;
    padding-left: 8px;
}

.track-drag-handle {
    color: #444;
    font-size: 16px;
    cursor: grab;
    padding: 4px;
    touch-action: none;
    flex-shrink: 0;
}

.track-drag-handle:active {
    color: #888;
}

.track-info {
    flex: 1;
    min-width: 0;
}

.track-name {
    font-size: 14px;
    color: #e0e0e0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.track-meta {
    font-size: 11px;
    color: #555;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.track-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}

.track-action-btn {
    width: 32px;
    height: 32px;
    background: none;
    border: 1px solid #333;
    border-radius: 6px;
    color: #888;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.track-action-btn:active {
    background: #333;
    color: #fff;
}

.unavailable-label {
    font-size: 10px;
    color: #555;
    background: #1a1a1a;
    border-radius: 4px;
    padding: 2px 6px;
    flex-shrink: 0;
}

/* === Bottom Sheet === */
.bottom-sheet-backdrop {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 300;
}

.bottom-sheet-backdrop.open {
    display: block;
}

.bottom-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #1a1a1a;
    border-radius: 16px 16px 0 0;
    z-index: 301;
    transform: translateY(100%);
    transition: transform 0.25s ease;
    max-height: 70vh;
    overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom, 0px);
}

.bottom-sheet.open {
    transform: translateY(0);
}

.bottom-sheet-handle {
    width: 36px;
    height: 4px;
    background: #444;
    border-radius: 2px;
    margin: 10px auto;
}

.bottom-sheet-title {
    font-size: 14px;
    color: #888;
    padding: 4px 16px 8px;
    text-align: center;
}

.bottom-sheet-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-top: 1px solid #222;
    color: #e0e0e0;
    font-size: 15px;
    cursor: pointer;
    background: none;
    border-left: none;
    border-right: none;
    border-bottom: none;
    width: 100%;
    text-align: left;
}

.bottom-sheet-option:active {
    background: #222;
}

.bottom-sheet-option.danger {
    color: #ff453a;
}

.bottom-sheet-option .bs-icon {
    font-size: 18px;
    width: 24px;
    text-align: center;
    flex-shrink: 0;
}

.bottom-sheet-cancel {
    display: block;
    width: calc(100% - 32px);
    margin: 8px 16px 12px;
    padding: 14px;
    background: #222;
    border: none;
    border-radius: 10px;
    color: #4a9eff;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
}

.bottom-sheet-cancel:active {
    background: #333;
}

/* === Playlist Picker (quick add) === */
.playlist-picker-backdrop {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 300;
}

.playlist-picker-backdrop.open {
    display: block;
}

.playlist-picker {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #1a1a1a;
    border-radius: 16px 16px 0 0;
    z-index: 301;
    transform: translateY(100%);
    transition: transform 0.25s ease;
    max-height: 60vh;
    overflow-y: auto;
    padding-bottom: env(safe-area-inset-bottom, 0px);
}

.playlist-picker.open {
    transform: translateY(0);
}

.playlist-picker-title {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    padding: 16px 16px 8px;
    text-align: center;
}

.playlist-picker-item {
    padding: 12px 16px;
    border-top: 1px solid #222;
    color: #e0e0e0;
    font-size: 15px;
    cursor: pointer;
}

.playlist-picker-item:active {
    background: #222;
}

.playlist-picker-new {
    color: #4a9eff;
    font-weight: 600;
}

/* === Filter Popover === */
.filter-popover {
    display: none;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 10px;
}

.filter-popover.open {
    display: block;
}

.filter-group-label {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 6px;
    margin-top: 10px;
}

.filter-group-label:first-child {
    margin-top: 0;
}

.filter-option {
    display: inline-block;
    padding: 4px 10px;
    background: #222;
    border: 1px solid #333;
    border-radius: 6px;
    color: #888;
    font-size: 12px;
    cursor: pointer;
    margin: 0 4px 4px 0;
}

.filter-option:active {
    background: #333;
}

.filter-option.selected {
    background: #1a3a5c;
    border-color: #4a9eff;
    color: #4a9eff;
}

.filter-folder-select {
    background: #222;
    border: 1px solid #333;
    border-radius: 6px;
    color: #ccc;
    font-size: 12px;
    padding: 6px 10px;
    outline: none;
    width: 100%;
    margin-top: 4px;
}

/* === Playlists Tab === */
.playlists-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.playlists-header h2 {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
}

.playlists-add-btn {
    width: 36px;
    height: 36px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 50%;
    color: #4a9eff;
    font-size: 22px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.playlists-add-btn:active {
    background: #333;
}

.playlists-empty {
    text-align: center;
    padding-top: 120px;
    color: #666;
    font-size: 16px;
}

.playlist-card {
    background: #141414;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
}

.playlist-card:active {
    background: #1a1a1a;
}

.playlist-card-info {
    flex: 1;
    min-width: 0;
}

.playlist-card-name {
    font-size: 15px;
    color: #e0e0e0;
    font-weight: 600;
}

.playlist-card-count {
    font-size: 12px;
    color: #666;
    margin-top: 2px;
}

.playlist-card-preview {
    font-size: 11px;
    color: #444;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.playlist-card-more {
    background: none;
    border: none;
    color: #666;
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    flex-shrink: 0;
}

.playlist-card-more:active {
    color: #fff;
}

/* === Inside Playlist View === */
.playlist-inside-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
}

.playlist-back-btn {
    background: none;
    border: none;
    color: #4a9eff;
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
}

.playlist-inside-name {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    flex: 1;
    cursor: pointer;
}

.playlist-inside-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
}

.playlist-play-btn,
.playlist-shuffle-btn {
    flex: 1;
    padding: 10px;
    border: 1px solid #333;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
}

.playlist-play-btn {
    background: #4a9eff;
    border-color: #4a9eff;
    color: #fff;
}

.playlist-play-btn:active {
    background: #3a8eef;
}

.playlist-shuffle-btn {
    background: #1a1a1a;
    color: #e0e0e0;
}

.playlist-shuffle-btn:active {
    background: #333;
}

.playlist-new-input-row {
    display: none;
    gap: 8px;
    margin-bottom: 12px;
}

.playlist-new-input-row.visible {
    display: flex;
}

.playlist-new-input {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #4a9eff;
    border-radius: 8px;
    color: #e0e0e0;
    font-size: 14px;
    padding: 8px 12px;
    outline: none;
}

.playlist-new-confirm,
.playlist-new-cancel {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #4a9eff;
    font-size: 14px;
    padding: 8px 12px;
    cursor: pointer;
}

.playlist-new-cancel {
    color: #888;
}

/* === Queue Tab === */
.queue-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.queue-header h2 {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
}

.queue-source {
    font-size: 12px;
    color: #666;
    margin-bottom: 12px;
}

.queue-empty {
    text-align: center;
    padding-top: 120px;
    color: #666;
    font-size: 15px;
    line-height: 1.6;
    padding-left: 20px;
    padding-right: 20px;
}

.clear-queue-btn {
    width: 100%;
    padding: 12px;
    background: #141414;
    border: 1px solid #333;
    border-radius: 8px;
    color: #ff453a;
    font-size: 14px;
    cursor: pointer;
    margin-top: 16px;
}

.clear-queue-btn:active {
    background: #2a1a1a;
}

/* === Settings Tab === */
.settings-tab-header {
    margin-bottom: 20px;
}

.settings-tab-header h2 {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
}

.settings-section {
    background: #141414;
    border-radius: 8px;
    margin-bottom: 16px;
    overflow: hidden;
}

.settings-section-title {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 14px 16px 0;
}

.setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
}

.setting-row + .setting-row {
    border-top: 1px solid #222;
}

.setting-label {
    font-size: 14px;
    color: #ccc;
}

.setting-value {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
}

.setting-slider-row {
    padding: 0 16px 14px;
}

.setting-description {
    font-size: 12px;
    color: #555;
    padding: 0 16px 12px;
    line-height: 1.4;
}

.setting-slider-row input[type="range"] {
    margin-bottom: 4px;
}

.ceiling-controls {
    transition: opacity 0.2s;
}

.ceiling-controls.disabled {
    opacity: 0.3;
    pointer-events: none;
}

.toggle-switch {
    position: relative;
    width: 48px;
    height: 28px;
    flex-shrink: 0;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0; left: 0; right: 0; bottom: 0;
    background: #333;
    border-radius: 14px;
    transition: background 0.2s;
}

.toggle-slider::before {
    content: '';
    position: absolute;
    width: 22px;
    height: 22px;
    left: 3px;
    bottom: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
    background: #4a9eff;
}

.toggle-switch input:checked + .toggle-slider::before {
    transform: translateX(20px);
}

.reset-btn {
    width: 100%;
    padding: 14px;
    background: #141414;
    border: 1px solid #333;
    border-radius: 8px;
    color: #ff453a;
    font-size: 15px;
    cursor: pointer;
    margin-top: 8px;
}

.reset-btn:active {
    background: #2a1a1a;
}

.settings-stats {
    font-size: 12px;
    color: #555;
    padding: 8px 16px 12px;
    line-height: 1.6;
}

/* === Toast === */
.toast {
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: #333;
    color: #fff;
    font-size: 13px;
    padding: 8px 16px;
    border-radius: 8px;
    z-index: 500;
    opacity: 0;
    transition: opacity 0.3s, transform 0.3s;
    pointer-events: none;
    white-space: nowrap;
}

.toast.visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

/* === File Input (hidden) === */
.hidden-file-input {
    display: none;
}

/* === Rename Input Inline === */
.rename-input {
    background: #1a1a1a;
    border: 1px solid #4a9eff;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 15px;
    padding: 4px 8px;
    outline: none;
    width: 100%;
}
```

- [ ] Verify all styles render correctly after Task 3 integrates the file.
- [ ] Git commit: `feat: add styles.css with all music manager styles`

---

## Chunk 2: App Shell

### Task 3: index.html (new app shell)

**Files:**
- Modify: `index.html` (complete replacement)

- [ ] Replace the entire contents of `index.html` with the following:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#0a0a0a">
    <title>Audio Manipulator</title>
    <link rel="manifest" href="manifest.json">
    <link rel="apple-touch-icon" href="icons/icon-192.png">
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="app-container">

        <!-- === Tab Content Area === -->
        <div class="tab-content-area">

            <!-- Library Tab -->
            <div class="tab-view active" id="libraryView">
                <div class="library-header">
                    <h2>Library</h2>
                    <button class="load-folder-btn" id="libraryLoadBtn" style="display:none;">Load Folder</button>
                </div>
                <div class="library-empty" id="libraryEmpty">
                    <div class="library-empty-text">No tracks yet</div>
                    <button class="load-folder-btn-large" id="libraryLoadBtnLarge">Load Folder</button>
                </div>
                <div id="libraryContent" style="display:none;">
                    <div class="search-bar-container">
                        <input type="text" class="search-input" id="librarySearch" placeholder="Search tracks...">
                        <button class="filter-btn" id="filterToggleBtn">&#9776;</button>
                    </div>
                    <div class="filter-popover" id="filterPopover">
                        <div class="filter-group-label">Availability</div>
                        <div id="filterAvailability">
                            <span class="filter-option selected" data-value="all">All</span>
                            <span class="filter-option" data-value="available">Available</span>
                            <span class="filter-option" data-value="unavailable">Unavailable</span>
                        </div>
                        <div class="filter-group-label">Folder</div>
                        <select class="filter-folder-select" id="filterFolder">
                            <option value="">All Folders</option>
                        </select>
                    </div>
                    <div class="sort-filter-row">
                        <select class="sort-select" id="sortSelect">
                            <option value="az">A &rarr; Z</option>
                            <option value="za">Z &rarr; A</option>
                            <option value="oldest">Oldest First</option>
                            <option value="newest">Newest First</option>
                        </select>
                        <span class="track-count-label" id="trackCountLabel"></span>
                    </div>
                    <ul class="track-list" id="libraryTrackList"></ul>
                </div>
            </div>

            <!-- Playlists Tab -->
            <div class="tab-view" id="playlistsView">
                <div id="playlistListView">
                    <div class="playlists-header">
                        <h2>Playlists</h2>
                        <button class="playlists-add-btn" id="playlistAddBtn">+</button>
                    </div>
                    <div class="playlist-new-input-row" id="playlistNewRow">
                        <input type="text" class="playlist-new-input" id="playlistNewInput" placeholder="Playlist name...">
                        <button class="playlist-new-confirm" id="playlistNewConfirm">Add</button>
                        <button class="playlist-new-cancel" id="playlistNewCancel">Cancel</button>
                    </div>
                    <div class="playlists-empty" id="playlistsEmpty">No playlists yet</div>
                    <div id="playlistCards"></div>
                </div>
                <div id="playlistInsideView" style="display:none;">
                    <div class="playlist-inside-header">
                        <button class="playlist-back-btn" id="playlistBackBtn">&#8249;</button>
                        <div class="playlist-inside-name" id="playlistInsideName"></div>
                    </div>
                    <div class="playlist-inside-actions">
                        <button class="playlist-play-btn" id="playlistPlayAllBtn">Play All</button>
                        <button class="playlist-shuffle-btn" id="playlistShuffleBtn">Shuffle</button>
                    </div>
                    <ul class="track-list" id="playlistTrackList"></ul>
                </div>
            </div>

            <!-- Queue Tab -->
            <div class="tab-view" id="queueView">
                <div class="queue-header">
                    <h2>Queue</h2>
                </div>
                <div class="queue-source" id="queueSource"></div>
                <div class="queue-empty" id="queueEmpty">Queue is empty — play a track from Library or a Playlist to start.</div>
                <ul class="track-list" id="queueTrackList"></ul>
                <button class="clear-queue-btn" id="clearQueueBtn" style="display:none;">Clear Queue</button>
            </div>

            <!-- Settings Tab -->
            <div class="tab-view" id="settingsView">
                <div class="settings-tab-header">
                    <h2>Settings</h2>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Playback</div>
                    <div class="setting-row">
                        <span class="setting-label">Autoplay</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="autoplayToggle" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="setting-description">Auto-advance to the next track when the current one ends.</div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Equalizer</div>
                    <div class="setting-row">
                        <span class="setting-label">Equalizer</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="eqToggle" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="setting-description">10-band graphic equalizer. When disabled, audio bypasses all EQ filters.</div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Audio Safety</div>
                    <div class="setting-row">
                        <span class="setting-label">Limiter</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="limiterToggle" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="setting-description">Brick-wall limiter prevents audio from exceeding the ceiling.</div>
                    <div class="ceiling-controls" id="ceilingControls">
                        <div class="setting-row">
                            <span class="setting-label">Limiter Ceiling</span>
                            <span class="setting-value" id="ceilingValue">-1.0 dB</span>
                        </div>
                        <div class="setting-slider-row">
                            <input type="range" id="ceilingSlider" min="-6" max="0" step="0.5" value="-1">
                            <div class="range-labels">
                                <span>-6 dB (safe)</span>
                                <span>0 dB</span>
                            </div>
                        </div>
                    </div>
                    <div class="setting-row">
                        <span class="setting-label">Volume Boost Warning</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="boostWarningToggle" checked>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="setting-description">Colors the volume slider orange above 100% and red above 150%.</div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Library</div>
                    <div class="setting-row">
                        <span class="setting-label">Load Folder</span>
                        <button class="load-folder-btn" id="settingsLoadBtn">Load</button>
                    </div>
                    <div class="setting-row">
                        <span class="setting-label">Clear Library</span>
                        <button class="load-folder-btn" id="clearLibraryBtn" style="color:#ff453a;border-color:#ff453a;">Clear</button>
                    </div>
                    <div class="settings-stats" id="libraryStats">0 tracks | 0 available | 0 B used</div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">Reset</div>
                    <div class="setting-row">
                        <span class="setting-label">Reset to Defaults</span>
                        <button class="load-folder-btn" id="resetDefaultsBtn">Reset</button>
                    </div>
                    <div class="setting-description">Resets settings only. Library and playlists are preserved.</div>
                    <div class="setting-row">
                        <span class="setting-label">Reset Everything</span>
                        <button class="load-folder-btn" id="resetEverythingBtn" style="color:#ff453a;border-color:#ff453a;">Reset All</button>
                    </div>
                    <div class="setting-description">Clears settings, library, and all playlists.</div>
                </div>
            </div>
        </div>

        <!-- === Mini Player === -->
        <div class="mini-player" id="miniPlayer">
            <div class="mini-player-info">
                <div class="mini-player-title" id="miniPlayerTitle">—</div>
                <div class="mini-player-time" id="miniPlayerTime">0:00</div>
            </div>
            <button class="mini-player-play-btn" id="miniPlayerPlayBtn">
                <span id="miniPlayerPlayIcon">&#9654;</span>
            </button>
            <div class="mini-player-progress" id="miniPlayerProgress" style="width:0%"></div>
        </div>

        <!-- === Tab Bar === -->
        <div class="tab-bar">
            <button class="tab-bar-btn active" data-tab="libraryView">
                <span class="tab-icon">&#127925;</span>
                <span class="tab-label">Library</span>
            </button>
            <button class="tab-bar-btn" data-tab="playlistsView">
                <span class="tab-icon">&#128220;</span>
                <span class="tab-label">Playlists</span>
            </button>
            <button class="tab-bar-btn" data-tab="queueView">
                <span class="tab-icon">&#9654;</span>
                <span class="tab-label">Queue</span>
            </button>
            <button class="tab-bar-btn" data-tab="settingsView">
                <span class="tab-icon">&#9881;</span>
                <span class="tab-label">Settings</span>
            </button>
        </div>
    </div>

    <!-- === Now Playing Overlay === -->
    <div class="now-playing-overlay" id="nowPlayingOverlay">
        <div class="np-header">
            <button class="np-dismiss-btn" id="npDismissBtn">&#8744; Done</button>
            <span class="np-header-title">Now Playing</span>
        </div>
        <div class="np-body">
            <div class="np-track-info">
                <div class="np-track-name" id="npTrackName">No track loaded</div>
                <div class="np-track-sub" id="npTrackSub"></div>
            </div>

            <div class="seek-group">
                <input type="range" id="seekSlider" min="0" max="1000" step="1" value="0" disabled>
                <div class="seek-time">
                    <span id="currentTime">0:00</span>
                    <span id="totalTime">0:00</span>
                </div>
            </div>

            <div class="transport">
                <button class="transport-btn" id="prevBtn" disabled>
                    <span class="icon">&#9198;</span>
                </button>
                <button class="play-btn" id="playBtn" disabled>
                    <span class="icon" id="playIcon">&#9654;</span>
                </button>
                <button class="transport-btn" id="nextBtn" disabled>
                    <span class="icon">&#9197;</span>
                </button>
            </div>

            <div class="control-group">
                <div class="control-header">
                    <span class="control-label">Speed / Pitch</span>
                    <span class="control-value" id="rateValue">100%</span>
                </div>
                <input type="range" id="rateSlider" min="25" max="200" step="1" value="100">
                <div class="range-labels">
                    <span>25%</span>
                    <span>200%</span>
                </div>
                <div class="semitone-controls">
                    <button class="semitone-btn" id="semitoneDown">&#9664;</button>
                    <div class="semitone-display">
                        <div class="value" id="semitoneValue">0 st</div>
                        <div class="label">semitones</div>
                    </div>
                    <button class="semitone-btn" id="semitoneUp">&#9654;</button>
                </div>
            </div>

            <div class="control-group" id="eqGroup">
                <div class="control-header">
                    <span class="control-label">Equalizer</span>
                    <button class="eq-reset-btn" id="eqReset">Flat</button>
                </div>
                <div class="eq-container">
                    <div class="eq-db-labels">
                        <span>+12</span>
                        <span>0</span>
                        <span>-12</span>
                    </div>
                    <div class="eq-sliders" id="eqSliders"></div>
                </div>
                <div class="eq-freq-labels" id="eqFreqLabels"></div>
            </div>

            <div class="control-group" id="volumeGroup">
                <div class="control-header">
                    <span class="control-label">Volume</span>
                    <span class="control-value" id="volumeValue">80%</span>
                </div>
                <input type="range" id="volumeSlider" min="0" max="2" step="0.01" value="0.8">
                <div class="range-labels">
                    <span>0%</span>
                    <span>200%</span>
                </div>
            </div>
        </div>
    </div>

    <!-- === Bottom Sheet === -->
    <div class="bottom-sheet-backdrop" id="bottomSheetBackdrop"></div>
    <div class="bottom-sheet" id="bottomSheet">
        <div class="bottom-sheet-handle"></div>
        <div class="bottom-sheet-title" id="bottomSheetTitle"></div>
        <div id="bottomSheetOptions"></div>
        <button class="bottom-sheet-cancel" id="bottomSheetCancel">Cancel</button>
    </div>

    <!-- === Playlist Picker === -->
    <div class="playlist-picker-backdrop" id="playlistPickerBackdrop"></div>
    <div class="playlist-picker" id="playlistPicker">
        <div class="bottom-sheet-handle"></div>
        <div class="playlist-picker-title">Add to Playlist</div>
        <div id="playlistPickerList"></div>
    </div>

    <!-- === Toast === -->
    <div class="toast" id="toast"></div>

    <!-- === Hidden File Input === -->
    <input type="file" class="hidden-file-input" id="fileInput" accept=".wav,audio/wav" webkitdirectory>

    <!-- === Scripts (order matters: storage first, then player, then features, then settings) === -->
    <script src="storage.js"></script>
    <script src="player.js"></script>
    <script src="library.js"></script>
    <script src="queue.js"></script>
    <script src="playlists.js"></script>
    <script src="settings.js"></script>
    <script>
        // Tab switching
        document.querySelectorAll('.tab-bar-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.tab-bar-btn').forEach(function (b) { b.classList.remove('active'); });
                document.querySelectorAll('.tab-view').forEach(function (v) { v.classList.remove('active'); });
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Mini player tap opens Now Playing
        document.getElementById('miniPlayer').addEventListener('click', function (e) {
            if (e.target.closest('.mini-player-play-btn')) return;
            document.getElementById('nowPlayingOverlay').classList.add('open');
        });

        // Now Playing dismiss
        document.getElementById('npDismissBtn').addEventListener('click', function () {
            document.getElementById('nowPlayingOverlay').classList.remove('open');
        });

        // Bottom sheet close
        document.getElementById('bottomSheetBackdrop').addEventListener('click', function () {
            window.AM.closeBottomSheet();
        });
        document.getElementById('bottomSheetCancel').addEventListener('click', function () {
            window.AM.closeBottomSheet();
        });

        // Playlist picker close
        document.getElementById('playlistPickerBackdrop').addEventListener('click', function () {
            window.AM.closePlaylistPicker();
        });

        // Toast utility
        window.AM = window.AM || {};
        var toastTimer = null;
        window.AM.showToast = function (msg) {
            var t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.add('visible');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { t.classList.remove('visible'); }, 2000);
        };

        // Bottom sheet utility
        window.AM.openBottomSheet = function (title, options) {
            document.getElementById('bottomSheetTitle').textContent = title;
            var container = document.getElementById('bottomSheetOptions');
            container.innerHTML = '';
            options.forEach(function (opt) {
                var btn = document.createElement('button');
                btn.className = 'bottom-sheet-option' + (opt.danger ? ' danger' : '');
                btn.innerHTML = '<span class="bs-icon">' + (opt.icon || '') + '</span>' + opt.label;
                btn.addEventListener('click', function () {
                    window.AM.closeBottomSheet();
                    if (opt.action) opt.action();
                });
                container.appendChild(btn);
            });
            document.getElementById('bottomSheetBackdrop').classList.add('open');
            document.getElementById('bottomSheet').classList.add('open');
        };

        window.AM.closeBottomSheet = function () {
            document.getElementById('bottomSheetBackdrop').classList.remove('open');
            document.getElementById('bottomSheet').classList.remove('open');
        };

        // Playlist picker utility
        window.AM.openPlaylistPicker = function (trackId) {
            var playlists = window.AM.storage.getPlaylists();
            var list = document.getElementById('playlistPickerList');
            list.innerHTML = '';

            if (playlists.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'playlist-picker-item playlist-picker-new';
                empty.textContent = '+ Create a Playlist';
                empty.addEventListener('click', function () {
                    window.AM.closePlaylistPicker();
                    // Switch to playlists tab and trigger new playlist
                    document.querySelectorAll('.tab-bar-btn').forEach(function (b) { b.classList.remove('active'); });
                    document.querySelectorAll('.tab-view').forEach(function (v) { v.classList.remove('active'); });
                    document.querySelector('[data-tab="playlistsView"]').classList.add('active');
                    document.getElementById('playlistsView').classList.add('active');
                    if (window.AM.playlists && window.AM.playlists.showNewInput) {
                        window.AM.playlists.showNewInput(trackId);
                    }
                });
                list.appendChild(empty);
            } else {
                playlists.forEach(function (pl) {
                    var item = document.createElement('div');
                    item.className = 'playlist-picker-item';
                    item.textContent = pl.name;
                    item.addEventListener('click', function () {
                        window.AM.closePlaylistPicker();
                        if (window.AM.playlists) {
                            window.AM.playlists.addTrackToPlaylist(pl.id, trackId);
                        }
                        window.AM.showToast('Added to ' + pl.name);
                    });
                    list.appendChild(item);
                });
                var newItem = document.createElement('div');
                newItem.className = 'playlist-picker-item playlist-picker-new';
                newItem.textContent = '+ New Playlist';
                newItem.addEventListener('click', function () {
                    window.AM.closePlaylistPicker();
                    document.querySelectorAll('.tab-bar-btn').forEach(function (b) { b.classList.remove('active'); });
                    document.querySelectorAll('.tab-view').forEach(function (v) { v.classList.remove('active'); });
                    document.querySelector('[data-tab="playlistsView"]').classList.add('active');
                    document.getElementById('playlistsView').classList.add('active');
                    if (window.AM.playlists && window.AM.playlists.showNewInput) {
                        window.AM.playlists.showNewInput(trackId);
                    }
                });
                list.appendChild(newItem);
            }

            document.getElementById('playlistPickerBackdrop').classList.add('open');
            document.getElementById('playlistPicker').classList.add('open');
        };

        window.AM.closePlaylistPicker = function () {
            document.getElementById('playlistPickerBackdrop').classList.remove('open');
            document.getElementById('playlistPicker').classList.remove('open');
        };

        // Switch to tab programmatically
        window.AM.switchTab = function (tabId) {
            document.querySelectorAll('.tab-bar-btn').forEach(function (b) { b.classList.remove('active'); });
            document.querySelectorAll('.tab-view').forEach(function (v) { v.classList.remove('active'); });
            var btn = document.querySelector('[data-tab="' + tabId + '"]');
            if (btn) btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        };

        // Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js');
        }
    </script>
</body>
</html>
```

- [ ] At this point the app shell renders: tab bar, mini player (hidden), Now Playing (hidden), all four tab views with placeholder content. No JS logic yet beyond tab switching.
- [ ] Verify tab switching works by tapping each tab.
- [ ] Git commit: `feat: replace index.html with tab-based app shell`

---

## Chunk 3: Audio Engine

### Task 4: player.js

**Files:**
- Create: `player.js`

- [ ] Create `player.js` with the following complete content:

```js
// player.js — Audio engine, Now Playing UI, mini player updates
(function () {
    'use strict';

    var AM = window.AM = window.AM || {};

    // --- EQ band definitions ---
    var EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

    function formatFreq(hz) {
        return hz >= 1000 ? (hz / 1000) + 'k' : String(hz);
    }

    function formatTime(sec) {
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    // --- Audio State ---
    var audioCtx = null;
    var audioBuffer = null;
    var sourceNode = null;
    var gainNode = null;
    var limiterNode = null;
    var eqFilters = [];
    var isPlaying = false;
    var segmentStartTime = 0;
    var bufferOffset = 0;
    var currentRate = 1.0;
    var isSeeking = false;
    var animFrameId = null;
    var semitones = 0;
    var SEMITONE = Math.pow(2, 1 / 12);
    var miniPlayerVisible = false;

    // Current track metadata (from library entry)
    var currentTrackId = null;
    var currentTrackName = '';
    var currentTrackSub = '';

    // --- Settings ref ---
    var settings = AM.storage.getSettings();

    // --- DOM refs ---
    var playBtn = document.getElementById('playBtn');
    var playIcon = document.getElementById('playIcon');
    var prevBtn = document.getElementById('prevBtn');
    var nextBtn = document.getElementById('nextBtn');
    var rateSlider = document.getElementById('rateSlider');
    var rateValue = document.getElementById('rateValue');
    var volumeSlider = document.getElementById('volumeSlider');
    var volumeValue = document.getElementById('volumeValue');
    var volumeGroup = document.getElementById('volumeGroup');
    var seekSlider = document.getElementById('seekSlider');
    var currentTimeEl = document.getElementById('currentTime');
    var totalTimeEl = document.getElementById('totalTime');
    var semitoneUp = document.getElementById('semitoneUp');
    var semitoneDown = document.getElementById('semitoneDown');
    var semitoneValue = document.getElementById('semitoneValue');
    var eqGroup = document.getElementById('eqGroup');
    var eqSlidersContainer = document.getElementById('eqSliders');
    var eqFreqLabels = document.getElementById('eqFreqLabels');
    var eqResetBtn = document.getElementById('eqReset');

    // Mini player DOM
    var miniPlayer = document.getElementById('miniPlayer');
    var miniPlayerTitle = document.getElementById('miniPlayerTitle');
    var miniPlayerTime = document.getElementById('miniPlayerTime');
    var miniPlayerPlayBtn = document.getElementById('miniPlayerPlayBtn');
    var miniPlayerPlayIcon = document.getElementById('miniPlayerPlayIcon');
    var miniPlayerProgress = document.getElementById('miniPlayerProgress');

    // Now Playing DOM
    var npTrackName = document.getElementById('npTrackName');
    var npTrackSub = document.getElementById('npTrackSub');

    // --- Build EQ sliders ---
    var eqSliderEls = [];

    EQ_FREQUENCIES.forEach(function (freq, i) {
        var band = document.createElement('div');
        band.className = 'eq-band';

        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '-12';
        slider.max = '12';
        slider.step = '0.5';
        slider.value = settings.eqBands[i];

        slider.addEventListener('input', function () {
            var val = parseFloat(slider.value);
            settings.eqBands[i] = val;
            if (eqFilters[i]) {
                eqFilters[i].gain.value = val;
            }
            updateFreqLabelColors();
            AM.storage.saveSettings(settings);
        });

        band.appendChild(slider);
        eqSlidersContainer.appendChild(band);
        eqSliderEls.push(slider);

        var label = document.createElement('span');
        label.textContent = formatFreq(freq);
        eqFreqLabels.appendChild(label);
    });

    function updateFreqLabelColors() {
        var labels = eqFreqLabels.children;
        for (var i = 0; i < labels.length; i++) {
            labels[i].style.color = settings.eqBands[i] !== 0 ? '#4a9eff' : '#555';
        }
    }

    updateFreqLabelColors();

    // --- EQ bypass ---
    eqGroup.classList.toggle('eq-bypassed', !settings.eqEnabled);

    // --- Audio chain management ---
    function ensureAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.gain.value = parseFloat(volumeSlider.value);

            EQ_FREQUENCIES.forEach(function (freq, i) {
                var filter = audioCtx.createBiquadFilter();
                if (i === 0) {
                    filter.type = 'lowshelf';
                } else if (i === EQ_FREQUENCIES.length - 1) {
                    filter.type = 'highshelf';
                } else {
                    filter.type = 'peaking';
                    filter.Q.value = 1.4;
                }
                filter.frequency.value = freq;
                filter.gain.value = settings.eqBands[i];
                eqFilters.push(filter);
            });

            limiterNode = audioCtx.createDynamicsCompressor();
            limiterNode.threshold.value = settings.limiterCeiling;
            limiterNode.knee.value = 0;
            limiterNode.ratio.value = 20;
            limiterNode.attack.value = 0.003;
            limiterNode.release.value = 0.25;

            updateAudioChain();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function updateAudioChain() {
        if (!gainNode || !audioCtx) return;

        gainNode.disconnect();
        eqFilters.forEach(function (f) { f.disconnect(); });
        if (limiterNode) limiterNode.disconnect();

        var lastNode = gainNode;

        if (settings.eqEnabled && eqFilters.length > 0) {
            gainNode.connect(eqFilters[0]);
            for (var i = 0; i < eqFilters.length - 1; i++) {
                eqFilters[i].connect(eqFilters[i + 1]);
            }
            lastNode = eqFilters[eqFilters.length - 1];
        }

        if (settings.limiterEnabled && limiterNode) {
            limiterNode.threshold.value = settings.limiterCeiling;
            lastNode.connect(limiterNode);
            limiterNode.connect(audioCtx.destination);
        } else {
            lastNode.connect(audioCtx.destination);
        }
    }

    // --- Volume boost warning ---
    function updateBoostWarning() {
        var vol = parseFloat(volumeSlider.value);
        volumeGroup.classList.remove('volume-warn', 'volume-danger');
        if (settings.boostWarning) {
            if (vol > 1.5) {
                volumeGroup.classList.add('volume-danger');
            } else if (vol > 1.0) {
                volumeGroup.classList.add('volume-warn');
            }
        }
    }

    updateBoostWarning();

    // --- Seek UI ---
    function getCurrentBufferPosition() {
        if (!isPlaying) return bufferOffset;
        var wallElapsed = audioCtx.currentTime - segmentStartTime;
        var pos = bufferOffset + wallElapsed * currentRate;
        return audioBuffer ? Math.min(pos, audioBuffer.duration) : pos;
    }

    function updateSeekUI() {
        if (!audioBuffer) return;
        var pos = getCurrentBufferPosition();
        currentTimeEl.textContent = formatTime(pos);
        if (!isSeeking) {
            seekSlider.value = Math.round((pos / audioBuffer.duration) * 1000);
        }
        // Update mini player
        miniPlayerTime.textContent = formatTime(pos);
        miniPlayerProgress.style.width = ((pos / audioBuffer.duration) * 100) + '%';

        if (isPlaying) {
            animFrameId = requestAnimationFrame(updateSeekUI);
        }
    }

    // --- Playback controls ---
    function startPlayback() {
        if (!audioBuffer || !audioCtx) return;

        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        currentRate = parseInt(rateSlider.value) / 100;
        sourceNode.playbackRate.value = currentRate;
        sourceNode.connect(gainNode);

        sourceNode.onended = function () {
            if (isPlaying) {
                isPlaying = false;
                bufferOffset = 0;
                updatePlayIcons(false);
                seekSlider.value = 0;
                currentTimeEl.textContent = '0:00';
                if (animFrameId) cancelAnimationFrame(animFrameId);

                // Auto-advance to next track in queue
                if (settings.autoplay && AM.queue && AM.queue.hasNext()) {
                    AM.queue.playNext();
                }
            }
        };

        sourceNode.start(0, bufferOffset);
        segmentStartTime = audioCtx.currentTime;
        isPlaying = true;
        updatePlayIcons(true);
        showMiniPlayer();
        updateSeekUI();
    }

    function pausePlayback() {
        if (!sourceNode) return;
        bufferOffset = getCurrentBufferPosition();
        if (audioBuffer && bufferOffset >= audioBuffer.duration) {
            bufferOffset = 0;
        }
        sourceNode.onended = null;
        sourceNode.stop();
        sourceNode = null;
        isPlaying = false;
        updatePlayIcons(false);
        if (animFrameId) cancelAnimationFrame(animFrameId);
        updateSeekUI();
    }

    function stopPlayback() {
        if (sourceNode) {
            sourceNode.onended = null;
            sourceNode.stop();
            sourceNode = null;
        }
        isPlaying = false;
        bufferOffset = 0;
        updatePlayIcons(false);
        if (animFrameId) cancelAnimationFrame(animFrameId);
    }

    function updatePlayIcons(playing) {
        if (playing) {
            playIcon.innerHTML = '&#9646;&#9646;';
            miniPlayerPlayIcon.innerHTML = '&#9646;&#9646;';
        } else {
            playIcon.innerHTML = '&#9654;';
            miniPlayerPlayIcon.innerHTML = '&#9654;';
        }
    }

    function showMiniPlayer() {
        if (!miniPlayerVisible) {
            miniPlayer.classList.add('visible');
            miniPlayerVisible = true;
        }
    }

    // --- Load a track by File object and metadata ---
    function loadTrack(file, trackId, trackName, trackSub, autoplay) {
        ensureAudioContext();
        stopPlayback();
        audioBuffer = null;
        playBtn.disabled = true;
        seekSlider.disabled = true;
        currentTrackId = trackId;
        currentTrackName = trackName;
        currentTrackSub = trackSub || '';

        npTrackName.textContent = 'Loading...';
        npTrackSub.textContent = '';
        miniPlayerTitle.textContent = 'Loading...';

        var reader = new FileReader();
        reader.onload = function (event) {
            audioCtx.decodeAudioData(event.target.result)
                .then(function (buffer) {
                    audioBuffer = buffer;
                    playBtn.disabled = false;
                    seekSlider.disabled = false;
                    seekSlider.value = 0;
                    totalTimeEl.textContent = formatTime(buffer.duration);
                    currentTimeEl.textContent = '0:00';
                    bufferOffset = 0;

                    // Update Now Playing display
                    npTrackName.textContent = trackName;
                    npTrackSub.textContent = trackSub || '';

                    // Update mini player
                    miniPlayerTitle.textContent = trackName;
                    miniPlayerTime.textContent = '0:00';
                    miniPlayerProgress.style.width = '0%';

                    // Update nav buttons
                    updateNavButtons();

                    // Write duration back to library entry
                    if (AM.library && AM.library.updateDuration) {
                        AM.library.updateDuration(trackId, buffer.duration);
                    }

                    if (autoplay) {
                        startPlayback();
                    }
                })
                .catch(function () {
                    npTrackName.textContent = 'Error: could not decode';
                    miniPlayerTitle.textContent = 'Error';
                });
        };
        reader.onerror = function () {
            npTrackName.textContent = 'Error: could not read file';
            miniPlayerTitle.textContent = 'Error';
        };
        reader.readAsArrayBuffer(file);
    }

    function updateNavButtons() {
        if (AM.queue) {
            prevBtn.disabled = !AM.queue.hasPrev() && !(audioBuffer && getCurrentBufferPosition() > 3);
            nextBtn.disabled = !AM.queue.hasNext();
        } else {
            prevBtn.disabled = true;
            nextBtn.disabled = true;
        }
    }

    // --- Event listeners ---

    // Play/Pause
    playBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
        if (isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    });

    // Mini player play/pause
    miniPlayerPlayBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!audioBuffer) return;
        if (isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    });

    // Prev (restart or previous track)
    prevBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
        var pos = getCurrentBufferPosition();
        if (pos > 3) {
            // Restart current track
            var wasPlaying = isPlaying;
            stopPlayback();
            bufferOffset = 0;
            seekSlider.value = 0;
            currentTimeEl.textContent = '0:00';
            miniPlayerProgress.style.width = '0%';
            if (wasPlaying) {
                startPlayback();
            }
        } else if (AM.queue && AM.queue.hasPrev()) {
            AM.queue.playPrev();
        } else {
            // Restart from beginning
            var wasPlaying2 = isPlaying;
            stopPlayback();
            bufferOffset = 0;
            seekSlider.value = 0;
            currentTimeEl.textContent = '0:00';
            miniPlayerProgress.style.width = '0%';
            if (wasPlaying2) {
                startPlayback();
            }
        }
    });

    // Next
    nextBtn.addEventListener('click', function () {
        if (AM.queue && AM.queue.hasNext()) {
            AM.queue.playNext();
        }
    });

    // Seek
    seekSlider.addEventListener('input', function () {
        if (!audioBuffer) return;
        isSeeking = true;
        var pos = (parseInt(seekSlider.value) / 1000) * audioBuffer.duration;
        currentTimeEl.textContent = formatTime(pos);
    });

    seekSlider.addEventListener('change', function () {
        if (!audioBuffer) return;
        var pos = (parseInt(seekSlider.value) / 1000) * audioBuffer.duration;
        bufferOffset = pos;
        isSeeking = false;
        if (isPlaying) {
            sourceNode.onended = null;
            sourceNode.stop();
            sourceNode = null;
            startPlayback();
        }
    });

    // Rate slider
    rateSlider.addEventListener('input', function () {
        var pct = parseInt(rateSlider.value);
        var rate = pct / 100;
        rateValue.textContent = pct + '%';
        semitones = Math.round(12 * Math.log2(rate));
        updateSemitoneDisplay();
        if (sourceNode && isPlaying) {
            bufferOffset = getCurrentBufferPosition();
            segmentStartTime = audioCtx.currentTime;
            currentRate = rate;
            sourceNode.playbackRate.value = rate;
        }
    });

    function applyRate(rate) {
        var pct = Math.round(rate * 100);
        rateSlider.value = Math.max(25, Math.min(200, pct));
        rateValue.textContent = pct + '%';
        if (sourceNode && isPlaying) {
            bufferOffset = getCurrentBufferPosition();
            segmentStartTime = audioCtx.currentTime;
            currentRate = rate;
            sourceNode.playbackRate.value = rate;
        } else {
            currentRate = rate;
        }
    }

    function updateSemitoneDisplay() {
        var sign = semitones > 0 ? '+' : '';
        semitoneValue.textContent = sign + semitones + ' st';
        semitoneDown.disabled = semitones <= -12;
        semitoneUp.disabled = semitones >= 12;
    }

    semitoneUp.addEventListener('click', function () {
        if (semitones >= 12) return;
        semitones++;
        applyRate(Math.pow(SEMITONE, semitones));
        updateSemitoneDisplay();
    });

    semitoneDown.addEventListener('click', function () {
        if (semitones <= -12) return;
        semitones--;
        applyRate(Math.pow(SEMITONE, semitones));
        updateSemitoneDisplay();
    });

    // Volume
    volumeSlider.addEventListener('input', function () {
        var vol = parseFloat(volumeSlider.value);
        volumeValue.textContent = Math.round(vol * 100) + '%';
        if (gainNode) {
            gainNode.gain.value = vol;
        }
        updateBoostWarning();
    });

    // EQ Reset
    eqResetBtn.addEventListener('click', function () {
        settings.eqBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        eqSliderEls.forEach(function (slider) { slider.value = 0; });
        eqFilters.forEach(function (f) { f.gain.value = 0; });
        updateFreqLabelColors();
        AM.storage.saveSettings(settings);
    });

    // --- Public API ---
    AM.player = {
        loadTrack: loadTrack,
        startPlayback: startPlayback,
        pausePlayback: pausePlayback,
        stopPlayback: stopPlayback,
        isPlaying: function () { return isPlaying; },
        getCurrentTrackId: function () { return currentTrackId; },
        updateNavButtons: updateNavButtons,
        getSettings: function () { return settings; },
        setSettings: function (s) {
            settings = s;
            eqGroup.classList.toggle('eq-bypassed', !settings.eqEnabled);
            eqSliderEls.forEach(function (slider, i) {
                slider.value = settings.eqBands[i];
                if (eqFilters[i]) eqFilters[i].gain.value = settings.eqBands[i];
            });
            updateFreqLabelColors();
            updateAudioChain();
            updateBoostWarning();
        },
        updateAudioChain: updateAudioChain,
        updateBoostWarning: updateBoostWarning,
        hideMiniPlayer: function () {
            miniPlayer.classList.remove('visible');
            miniPlayerVisible = false;
        },
        formatTime: formatTime,
        EQ_FREQUENCIES: EQ_FREQUENCIES
    };
})();
```

- [ ] After creating this file, the app should load without errors. Playback won't work yet because no tracks are loaded from the library, but the Now Playing overlay should open/close and all audio controls should be visible.
- [ ] Git commit: `feat: add player.js audio engine with Now Playing and mini player`

---

## Chunk 4: Library

### Task 5: library.js

**Files:**
- Create: `library.js`

- [ ] Create `library.js` with the following complete content:

```js
// library.js — Library data model, file matching, Library tab UI
(function () {
    'use strict';

    var AM = window.AM = window.AM || {};
    var storage = AM.storage;

    // --- Runtime state ---
    var libraryEntries = storage.getLibrary(); // Array of LibraryEntry objects
    var fileMap = new Map(); // Map<entryId, File>
    var settings = AM.player.getSettings();

    // --- DOM refs ---
    var fileInput = document.getElementById('fileInput');
    var libraryEmpty = document.getElementById('libraryEmpty');
    var libraryContent = document.getElementById('libraryContent');
    var libraryLoadBtn = document.getElementById('libraryLoadBtn');
    var libraryLoadBtnLarge = document.getElementById('libraryLoadBtnLarge');
    var librarySearch = document.getElementById('librarySearch');
    var filterToggleBtn = document.getElementById('filterToggleBtn');
    var filterPopover = document.getElementById('filterPopover');
    var filterFolder = document.getElementById('filterFolder');
    var sortSelect = document.getElementById('sortSelect');
    var trackCountLabel = document.getElementById('trackCountLabel');
    var libraryTrackList = document.getElementById('libraryTrackList');

    // Filter state
    var currentAvailFilter = 'all';
    var currentFolderFilter = '';

    // --- Init UI state ---
    sortSelect.value = settings.sortOrder;
    updateLibraryUI();

    // --- File input triggers ---
    function triggerFileInput() {
        fileInput.click();
    }

    libraryLoadBtnLarge.addEventListener('click', triggerFileInput);
    libraryLoadBtn.addEventListener('click', triggerFileInput);

    // --- Folder load ---
    fileInput.addEventListener('change', function (e) {
        var files = Array.from(e.target.files).filter(function (f) {
            return f.name.toLowerCase().endsWith('.wav');
        });

        if (files.length === 0) {
            AM.showToast('No .wav files found');
            return;
        }

        matchAndMerge(files);
        storage.saveLibrary(libraryEntries);
        updateLibraryUI();
        AM.showToast(files.length + ' file(s) loaded');

        // Reset the input so the same folder can be re-selected
        fileInput.value = '';
    });

    // --- Multi-layer file matching ---
    function matchAndMerge(files) {
        var matched = new Set(); // entry IDs that got matched

        files.forEach(function (file) {
            var relPath = file.webkitRelativePath || '';
            // Strip the root folder name from relativePath to get subfolder path
            var pathParts = relPath.split('/');
            var cleanPath = pathParts.length > 1 ? pathParts.slice(1).join('/') : '';
            var matchedEntry = null;

            // Step 1: Exact relativePath match
            if (cleanPath) {
                for (var i = 0; i < libraryEntries.length; i++) {
                    var entry = libraryEntries[i];
                    if (!matched.has(entry.id) && entry.relativePath === cleanPath) {
                        matchedEntry = entry;
                        break;
                    }
                }
            }

            // Step 2: Filename + fileSize match
            if (!matchedEntry) {
                var candidates = libraryEntries.filter(function (entry) {
                    return !matched.has(entry.id) && entry.filename === file.name && entry.fileSize === file.size;
                });
                if (candidates.length === 1) {
                    matchedEntry = candidates[0];
                }
            }

            // Step 3: Filename match (any size)
            if (!matchedEntry) {
                var candidates2 = libraryEntries.filter(function (entry) {
                    return !matched.has(entry.id) && entry.filename === file.name;
                });
                if (candidates2.length === 1) {
                    matchedEntry = candidates2[0];
                }
                // Step 4: Multiple matches = ambiguous, skip
            }

            if (matchedEntry) {
                // Reconnect: update file map and possibly update relativePath/fileSize
                matched.add(matchedEntry.id);
                fileMap.set(matchedEntry.id, file);
                if (cleanPath && !matchedEntry.relativePath) {
                    matchedEntry.relativePath = cleanPath;
                }
                matchedEntry.fileSize = file.size;
            } else {
                // Step 5: New entry
                var newEntry = {
                    id: crypto.randomUUID(),
                    filename: file.name,
                    relativePath: cleanPath,
                    fileSize: file.size,
                    duration: 0,
                    dateAdded: Date.now(),
                    lastPlayed: 0
                };
                libraryEntries.push(newEntry);
                fileMap.set(newEntry.id, file);
            }
        });
    }

    // --- Sort ---
    function sortEntries(entries, order) {
        var sorted = entries.slice();
        switch (order) {
            case 'az':
                sorted.sort(function (a, b) { return a.filename.localeCompare(b.filename); });
                break;
            case 'za':
                sorted.sort(function (a, b) { return b.filename.localeCompare(a.filename); });
                break;
            case 'oldest':
                sorted.sort(function (a, b) { return a.dateAdded - b.dateAdded; });
                break;
            case 'newest':
                sorted.sort(function (a, b) { return b.dateAdded - a.dateAdded; });
                break;
        }
        return sorted;
    }

    sortSelect.addEventListener('change', function () {
        settings.sortOrder = sortSelect.value;
        AM.storage.saveSettings(settings);
        renderTrackList();
    });

    // --- Search ---
    librarySearch.addEventListener('input', function () {
        renderTrackList();
    });

    // --- Filter ---
    filterToggleBtn.addEventListener('click', function () {
        filterPopover.classList.toggle('open');
        filterToggleBtn.classList.toggle('active-filter',
            currentAvailFilter !== 'all' || currentFolderFilter !== '');
    });

    document.getElementById('filterAvailability').addEventListener('click', function (e) {
        var option = e.target.closest('.filter-option');
        if (!option) return;
        document.querySelectorAll('#filterAvailability .filter-option').forEach(function (o) {
            o.classList.remove('selected');
        });
        option.classList.add('selected');
        currentAvailFilter = option.dataset.value;
        filterToggleBtn.classList.toggle('active-filter',
            currentAvailFilter !== 'all' || currentFolderFilter !== '');
        renderTrackList();
    });

    filterFolder.addEventListener('change', function () {
        currentFolderFilter = filterFolder.value;
        filterToggleBtn.classList.toggle('active-filter',
            currentAvailFilter !== 'all' || currentFolderFilter !== '');
        renderTrackList();
    });

    // --- Get filtered & sorted entries ---
    function getFilteredEntries() {
        var query = librarySearch.value.trim().toLowerCase();
        var filtered = libraryEntries.filter(function (entry) {
            // Search filter
            if (query) {
                var searchText = (entry.filename + ' ' + entry.relativePath).toLowerCase();
                if (searchText.indexOf(query) === -1) return false;
            }
            // Availability filter
            var available = fileMap.has(entry.id);
            if (currentAvailFilter === 'available' && !available) return false;
            if (currentAvailFilter === 'unavailable' && available) return false;
            // Folder filter
            if (currentFolderFilter) {
                var subfolder = getSubfolder(entry.relativePath);
                if (subfolder !== currentFolderFilter) return false;
            }
            return true;
        });
        return sortEntries(filtered, settings.sortOrder);
    }

    function getSubfolder(relativePath) {
        if (!relativePath) return '';
        var parts = relativePath.split('/');
        return parts.length > 1 ? parts[0] : '';
    }

    function getDisplayName(filename) {
        return filename.replace(/\.wav$/i, '');
    }

    function formatDuration(seconds) {
        if (!seconds || seconds === 0) return '\u2014';
        return AM.player.formatTime(seconds);
    }

    // --- Build folder filter options ---
    function updateFolderFilter() {
        var folders = new Set();
        libraryEntries.forEach(function (entry) {
            var subfolder = getSubfolder(entry.relativePath);
            if (subfolder) folders.add(subfolder);
        });
        filterFolder.innerHTML = '<option value="">All Folders</option>';
        Array.from(folders).sort().forEach(function (folder) {
            var opt = document.createElement('option');
            opt.value = folder;
            opt.textContent = folder;
            filterFolder.appendChild(opt);
        });
        filterFolder.value = currentFolderFilter;
    }

    // --- Render ---
    function updateLibraryUI() {
        if (libraryEntries.length === 0) {
            libraryEmpty.style.display = '';
            libraryContent.style.display = 'none';
            libraryLoadBtn.style.display = 'none';
        } else {
            libraryEmpty.style.display = 'none';
            libraryContent.style.display = '';
            libraryLoadBtn.style.display = '';
            updateFolderFilter();
            renderTrackList();
        }
    }

    function renderTrackList() {
        var filtered = getFilteredEntries();
        trackCountLabel.textContent = filtered.length + ' of ' + libraryEntries.length + ' tracks';

        libraryTrackList.innerHTML = '';

        filtered.forEach(function (entry) {
            var available = fileMap.has(entry.id);
            var li = document.createElement('li');
            li.className = 'track-row' + (available ? '' : ' unavailable');

            var currentId = AM.player.getCurrentTrackId();
            if (entry.id === currentId) {
                li.classList.add('now-playing-row');
            }

            var info = document.createElement('div');
            info.className = 'track-info';

            var name = document.createElement('div');
            name.className = 'track-name';
            name.textContent = getDisplayName(entry.filename);

            var meta = document.createElement('div');
            meta.className = 'track-meta';
            var subPath = getSubfolder(entry.relativePath);
            meta.textContent = (subPath ? subPath + ' \u00B7 ' : '') + formatDuration(entry.duration);

            info.appendChild(name);
            info.appendChild(meta);

            li.appendChild(info);

            if (available) {
                var actions = document.createElement('div');
                actions.className = 'track-actions';

                // Add to playlist button
                var addBtn = document.createElement('button');
                addBtn.className = 'track-action-btn';
                addBtn.innerHTML = '+';
                addBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    AM.openPlaylistPicker(entry.id);
                });

                // More button
                var moreBtn = document.createElement('button');
                moreBtn.className = 'track-action-btn';
                moreBtn.innerHTML = '\u22EF';
                moreBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    AM.openBottomSheet(getDisplayName(entry.filename), [
                        {
                            icon: '\u23ED',
                            label: 'Play Next',
                            action: function () {
                                if (AM.queue) AM.queue.insertNext(entry.id);
                                AM.showToast('Playing next');
                            }
                        },
                        {
                            icon: '\u2795',
                            label: 'Add to Queue',
                            action: function () {
                                if (AM.queue) AM.queue.addToEnd(entry.id);
                                AM.showToast('Added to queue');
                            }
                        },
                        {
                            icon: '\u2716',
                            label: 'Remove from Library',
                            danger: true,
                            action: function () {
                                removeEntry(entry.id);
                            }
                        }
                    ]);
                });

                actions.appendChild(addBtn);
                actions.appendChild(moreBtn);
                li.appendChild(actions);

                // Tap to play
                li.addEventListener('click', function () {
                    playFromLibrary(entry.id);
                });
            } else {
                var badge = document.createElement('span');
                badge.className = 'unavailable-label';
                badge.textContent = 'unavailable';
                li.appendChild(badge);
            }

            libraryTrackList.appendChild(li);
        });
    }

    // --- Play from library ---
    function playFromLibrary(entryId) {
        var filtered = getFilteredEntries().filter(function (e) { return fileMap.has(e.id); });
        if (filtered.length === 0) return;

        var trackIds = filtered.map(function (e) { return e.id; });
        var startIndex = trackIds.indexOf(entryId);
        if (startIndex === -1) startIndex = 0;

        if (AM.queue) {
            AM.queue.setQueue(trackIds, startIndex, 'library');
        }
    }

    // --- Remove entry ---
    function removeEntry(entryId) {
        libraryEntries = libraryEntries.filter(function (e) { return e.id !== entryId; });
        fileMap.delete(entryId);
        storage.saveLibrary(libraryEntries);
        if (AM.queue) AM.queue.removeTrackId(entryId);
        updateLibraryUI();
    }

    // --- Update duration (called by player after decode) ---
    function updateDuration(entryId, duration) {
        for (var i = 0; i < libraryEntries.length; i++) {
            if (libraryEntries[i].id === entryId) {
                if (libraryEntries[i].duration === 0) {
                    libraryEntries[i].duration = duration;
                    storage.saveLibrary(libraryEntries);
                }
                break;
            }
        }
    }

    // --- Update lastPlayed ---
    function markPlayed(entryId) {
        for (var i = 0; i < libraryEntries.length; i++) {
            if (libraryEntries[i].id === entryId) {
                libraryEntries[i].lastPlayed = Date.now();
                storage.saveLibrary(libraryEntries);
                break;
            }
        }
    }

    // --- Public API ---
    AM.library = {
        getEntries: function () { return libraryEntries; },
        getFileMap: function () { return fileMap; },
        getEntry: function (id) {
            return libraryEntries.find(function (e) { return e.id === id; });
        },
        getFile: function (id) {
            return fileMap.get(id);
        },
        isAvailable: function (id) {
            return fileMap.has(id);
        },
        getDisplayName: getDisplayName,
        formatDuration: formatDuration,
        getSubfolder: getSubfolder,
        updateDuration: updateDuration,
        markPlayed: markPlayed,
        triggerFileInput: triggerFileInput,
        refresh: updateLibraryUI,
        clearLibrary: function () {
            libraryEntries = [];
            fileMap.clear();
            storage.clearLibrary();
            updateLibraryUI();
        }
    };
})();
```

- [ ] After this task, Library tab should show "No tracks yet" with a Load Folder button. Loading a folder should populate the library, display track rows, and search/filter/sort should work. Tapping a track won't play yet (needs queue.js).
- [ ] Git commit: `feat: add library.js with data model, file matching, and Library tab UI`

---

## Chunk 5: Queue

### Task 6: queue.js

**Files:**
- Create: `queue.js`

- [ ] Create `queue.js` with the following complete content:

```js
// queue.js — Queue state management, Queue tab UI
(function () {
    'use strict';

    var AM = window.AM = window.AM || {};
    var library = AM.library;
    var player = AM.player;

    // --- Queue state (runtime only, not persisted) ---
    var trackIds = [];
    var currentIndex = -1;
    var source = ''; // "library", "playlist:<id>", or "manual"

    // --- DOM refs ---
    var queueSource = document.getElementById('queueSource');
    var queueEmpty = document.getElementById('queueEmpty');
    var queueTrackList = document.getElementById('queueTrackList');
    var clearQueueBtn = document.getElementById('clearQueueBtn');

    // --- Set queue and start playback ---
    function setQueue(ids, startIndex, queueSource) {
        trackIds = ids.slice();
        currentIndex = startIndex;
        source = queueSource || 'manual';
        playCurrentTrack(true);
        renderQueue();
    }

    // --- Play current track ---
    function playCurrentTrack(autoplay) {
        if (currentIndex < 0 || currentIndex >= trackIds.length) return;

        var entryId = trackIds[currentIndex];
        var file = library.getFile(entryId);
        var entry = library.getEntry(entryId);

        if (!file || !entry) return;

        var displayName = library.getDisplayName(entry.filename);
        var subfolder = library.getSubfolder(entry.relativePath);
        var sub = (subfolder ? subfolder + ' \u00B7 ' : '') + library.formatDuration(entry.duration);

        library.markPlayed(entryId);
        player.loadTrack(file, entryId, displayName, sub, autoplay);
        player.updateNavButtons();
        renderQueue();
        // Refresh library to update now-playing highlight
        library.refresh();
    }

    // --- Navigation ---
    function hasNext() {
        return currentIndex < trackIds.length - 1;
    }

    function hasPrev() {
        return currentIndex > 0;
    }

    function playNext() {
        if (hasNext()) {
            currentIndex++;
            playCurrentTrack(true);
        }
    }

    function playPrev() {
        if (hasPrev()) {
            currentIndex--;
            playCurrentTrack(true);
        }
    }

    // --- Insert / Append ---
    function insertNext(entryId) {
        if (currentIndex === -1) {
            trackIds = [entryId];
            currentIndex = 0;
            playCurrentTrack(true);
        } else {
            trackIds.splice(currentIndex + 1, 0, entryId);
            renderQueue();
        }
        player.updateNavButtons();
    }

    function addToEnd(entryId) {
        if (currentIndex === -1) {
            trackIds = [entryId];
            currentIndex = 0;
            playCurrentTrack(true);
        } else {
            trackIds.push(entryId);
            renderQueue();
        }
        player.updateNavButtons();
    }

    // --- Remove ---
    function removeFromQueue(index) {
        if (index === currentIndex) return; // Cannot remove currently playing
        trackIds.splice(index, 1);
        if (index < currentIndex) {
            currentIndex--;
        }
        player.updateNavButtons();
        renderQueue();
    }

    function removeTrackId(entryId) {
        // Remove all instances except the currently playing one
        for (var i = trackIds.length - 1; i >= 0; i--) {
            if (trackIds[i] === entryId && i !== currentIndex) {
                trackIds.splice(i, 1);
                if (i < currentIndex) currentIndex--;
            }
        }
        player.updateNavButtons();
        renderQueue();
    }

    // --- Clear queue ---
    clearQueueBtn.addEventListener('click', function () {
        if (currentIndex === -1) {
            // Nothing playing, clear everything
            trackIds = [];
            currentIndex = -1;
        } else {
            // Keep current track, remove everything after
            trackIds = trackIds.slice(0, currentIndex + 1);
        }
        source = '';
        player.updateNavButtons();
        renderQueue();
    });

    // --- Drag reorder ---
    var dragSrcIndex = null;

    function handleDragStart(index, el) {
        dragSrcIndex = index;
        el.style.opacity = '0.4';
    }

    function handleDragOver(e) {
        e.preventDefault();
    }

    function handleDrop(targetIndex) {
        if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

        var movedId = trackIds[dragSrcIndex];
        trackIds.splice(dragSrcIndex, 1);
        trackIds.splice(targetIndex, 0, movedId);

        // Update currentIndex if it was affected
        if (dragSrcIndex === currentIndex) {
            currentIndex = targetIndex;
        } else if (dragSrcIndex < currentIndex && targetIndex >= currentIndex) {
            currentIndex--;
        } else if (dragSrcIndex > currentIndex && targetIndex <= currentIndex) {
            currentIndex++;
        }

        dragSrcIndex = null;
        renderQueue();
    }

    function handleDragEnd(el) {
        el.style.opacity = '1';
        dragSrcIndex = null;
    }

    // --- Touch drag reorder ---
    var touchDragIndex = null;
    var touchDragEl = null;
    var touchStartY = 0;
    var touchRows = [];

    function handleTouchStart(index, el, e) {
        touchDragIndex = index;
        touchDragEl = el;
        touchStartY = e.touches[0].clientY;
        el.style.opacity = '0.6';
        el.style.background = '#222';
        touchRows = Array.from(queueTrackList.querySelectorAll('.track-row'));
    }

    function handleTouchMove(e) {
        if (touchDragIndex === null) return;
        e.preventDefault();
        var touchY = e.touches[0].clientY;
        var diff = touchY - touchStartY;
        if (touchDragEl) {
            touchDragEl.style.transform = 'translateY(' + diff + 'px)';
        }
    }

    function handleTouchEnd(e) {
        if (touchDragIndex === null || !touchDragEl) return;

        var touchY = e.changedTouches[0].clientY;
        var targetIndex = touchDragIndex;

        // Find which row the touch ended on
        for (var i = 0; i < touchRows.length; i++) {
            var rect = touchRows[i].getBoundingClientRect();
            if (touchY >= rect.top && touchY <= rect.bottom) {
                targetIndex = parseInt(touchRows[i].dataset.index);
                break;
            }
        }

        touchDragEl.style.opacity = '1';
        touchDragEl.style.background = '';
        touchDragEl.style.transform = '';

        if (targetIndex !== touchDragIndex) {
            handleDrop(targetIndex);
        }

        touchDragIndex = null;
        touchDragEl = null;
        touchRows = [];
    }

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    // --- Render ---
    function renderQueue() {
        if (trackIds.length === 0) {
            queueEmpty.style.display = '';
            queueTrackList.style.display = 'none';
            clearQueueBtn.style.display = 'none';
            queueSource.textContent = '';
            return;
        }

        queueEmpty.style.display = 'none';
        queueTrackList.style.display = '';
        clearQueueBtn.style.display = '';

        // Source indicator
        if (source === 'library') {
            queueSource.textContent = 'Playing from: Library';
        } else if (source.startsWith('playlist:')) {
            var plId = source.replace('playlist:', '');
            var playlists = AM.storage.getPlaylists();
            var pl = playlists.find(function (p) { return p.id === plId; });
            queueSource.textContent = 'Playing from: ' + (pl ? pl.name : 'Playlist');
        } else {
            queueSource.textContent = '';
        }

        queueTrackList.innerHTML = '';

        trackIds.forEach(function (entryId, index) {
            var entry = library.getEntry(entryId);
            var li = document.createElement('li');
            li.className = 'track-row';
            li.dataset.index = index;
            li.draggable = true;

            if (index === currentIndex) {
                li.classList.add('now-playing-row');
            }

            // Drag handle
            var handle = document.createElement('span');
            handle.className = 'track-drag-handle';
            handle.innerHTML = '\u2630';
            handle.addEventListener('touchstart', function (e) {
                handleTouchStart(index, li, e);
            }, { passive: true });

            li.addEventListener('dragstart', function () { handleDragStart(index, li); });
            li.addEventListener('dragover', handleDragOver);
            li.addEventListener('drop', function () { handleDrop(index); });
            li.addEventListener('dragend', function () { handleDragEnd(li); });

            var info = document.createElement('div');
            info.className = 'track-info';

            var nameEl = document.createElement('div');
            nameEl.className = 'track-name';
            nameEl.textContent = entry ? library.getDisplayName(entry.filename) : 'Unknown';

            var metaEl = document.createElement('div');
            metaEl.className = 'track-meta';
            if (entry) {
                var subPath = library.getSubfolder(entry.relativePath);
                metaEl.textContent = (subPath ? subPath + ' \u00B7 ' : '') + library.formatDuration(entry.duration);
            }

            info.appendChild(nameEl);
            info.appendChild(metaEl);

            li.appendChild(handle);
            li.appendChild(info);

            // Actions (not for currently playing track)
            if (index !== currentIndex) {
                var actions = document.createElement('div');
                actions.className = 'track-actions';

                var moreBtn = document.createElement('button');
                moreBtn.className = 'track-action-btn';
                moreBtn.innerHTML = '\u22EF';
                moreBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    AM.openBottomSheet(nameEl.textContent, [
                        {
                            icon: '\u2716',
                            label: 'Remove from Queue',
                            danger: true,
                            action: function () { removeFromQueue(index); }
                        }
                    ]);
                });

                actions.appendChild(moreBtn);
                li.appendChild(actions);
            }

            // Tap to play from this position
            li.addEventListener('click', function () {
                if (index === currentIndex) return;
                currentIndex = index;
                playCurrentTrack(true);
            });

            queueTrackList.appendChild(li);
        });
    }

    // --- Public API ---
    AM.queue = {
        setQueue: setQueue,
        hasNext: hasNext,
        hasPrev: hasPrev,
        playNext: playNext,
        playPrev: playPrev,
        insertNext: insertNext,
        addToEnd: addToEnd,
        removeFromQueue: removeFromQueue,
        removeTrackId: removeTrackId,
        getTrackIds: function () { return trackIds; },
        getCurrentIndex: function () { return currentIndex; },
        getSource: function () { return source; },
        refresh: renderQueue
    };
})();
```

- [ ] After this task, tapping a track in the Library should build a queue and start playback. The Queue tab should show the current queue with now-playing highlight. Prev/Next transport buttons should work.
- [ ] Git commit: `feat: add queue.js with queue management and Queue tab UI`

---

## Chunk 6: Playlists

### Task 7: playlists.js

**Files:**
- Create: `playlists.js`

- [ ] Create `playlists.js` with the following complete content:

```js
// playlists.js — Playlist CRUD, Playlists tab UI
(function () {
    'use strict';

    var AM = window.AM = window.AM || {};
    var storage = AM.storage;
    var library = AM.library;

    // --- State ---
    var playlists = storage.getPlaylists();
    var currentPlaylistId = null; // ID of playlist being viewed inside
    var pendingTrackIdForNew = null; // Track to add after creating a new playlist

    // --- DOM refs ---
    var playlistListView = document.getElementById('playlistListView');
    var playlistInsideView = document.getElementById('playlistInsideView');
    var playlistAddBtn = document.getElementById('playlistAddBtn');
    var playlistNewRow = document.getElementById('playlistNewRow');
    var playlistNewInput = document.getElementById('playlistNewInput');
    var playlistNewConfirm = document.getElementById('playlistNewConfirm');
    var playlistNewCancel = document.getElementById('playlistNewCancel');
    var playlistsEmpty = document.getElementById('playlistsEmpty');
    var playlistCards = document.getElementById('playlistCards');
    var playlistBackBtn = document.getElementById('playlistBackBtn');
    var playlistInsideName = document.getElementById('playlistInsideName');
    var playlistPlayAllBtn = document.getElementById('playlistPlayAllBtn');
    var playlistShuffleBtn = document.getElementById('playlistShuffleBtn');
    var playlistTrackList = document.getElementById('playlistTrackList');

    // --- Init ---
    renderPlaylistList();

    // --- Create playlist ---
    playlistAddBtn.addEventListener('click', function () {
        showNewInputUI(null);
    });

    function showNewInputUI(trackIdToAdd) {
        pendingTrackIdForNew = trackIdToAdd || null;
        playlistNewRow.classList.add('visible');
        playlistNewInput.value = '';
        playlistNewInput.focus();
    }

    playlistNewConfirm.addEventListener('click', function () {
        commitNewPlaylist();
    });

    playlistNewInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') commitNewPlaylist();
    });

    playlistNewCancel.addEventListener('click', function () {
        playlistNewRow.classList.remove('visible');
        pendingTrackIdForNew = null;
    });

    function commitNewPlaylist() {
        var name = playlistNewInput.value.trim();
        if (!name) return;

        var newPlaylist = {
            id: crypto.randomUUID(),
            name: name,
            trackIds: [],
            created: Date.now()
        };

        if (pendingTrackIdForNew) {
            newPlaylist.trackIds.push(pendingTrackIdForNew);
        }

        playlists.push(newPlaylist);
        storage.savePlaylists(playlists);
        playlistNewRow.classList.remove('visible');
        pendingTrackIdForNew = null;
        renderPlaylistList();

        if (newPlaylist.trackIds.length > 0) {
            AM.showToast('Added to ' + name);
        }
    }

    // --- Rename playlist ---
    function renamePlaylist(playlistId) {
        var pl = findPlaylist(playlistId);
        if (!pl) return;

        var newName = prompt('Rename playlist:', pl.name);
        if (newName && newName.trim()) {
            pl.name = newName.trim();
            storage.savePlaylists(playlists);
            renderPlaylistList();
            if (currentPlaylistId === playlistId) {
                playlistInsideName.textContent = pl.name;
            }
        }
    }

    // --- Delete playlist ---
    function deletePlaylist(playlistId) {
        if (!confirm('Delete this playlist?')) return;
        playlists = playlists.filter(function (p) { return p.id !== playlistId; });
        storage.savePlaylists(playlists);
        if (currentPlaylistId === playlistId) {
            currentPlaylistId = null;
            showListView();
        }
        renderPlaylistList();
    }

    // --- Add track to playlist ---
    function addTrackToPlaylist(playlistId, trackId) {
        var pl = findPlaylist(playlistId);
        if (!pl) return;
        pl.trackIds.push(trackId);
        storage.savePlaylists(playlists);
        if (currentPlaylistId === playlistId) {
            renderPlaylistInside(playlistId);
        }
        renderPlaylistList();
    }

    // --- Remove track from playlist ---
    function removeTrackFromPlaylist(playlistId, index) {
        var pl = findPlaylist(playlistId);
        if (!pl) return;
        pl.trackIds.splice(index, 1);
        storage.savePlaylists(playlists);
        renderPlaylistInside(playlistId);
        renderPlaylistList();
    }

    // --- Find playlist ---
    function findPlaylist(id) {
        return playlists.find(function (p) { return p.id === id; });
    }

    // --- Fisher-Yates shuffle ---
    function shuffleArray(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i];
            a[i] = a[j];
            a[j] = tmp;
        }
        return a;
    }

    // --- Get available track IDs for a playlist ---
    function getAvailableTrackIds(pl) {
        return pl.trackIds.filter(function (id) {
            var entry = library.getEntry(id);
            return entry && library.isAvailable(id);
        });
    }

    // --- Count valid tracks (exist in library, even if not available) ---
    function getValidTrackCount(pl) {
        return pl.trackIds.filter(function (id) {
            return library.getEntry(id) !== undefined;
        }).length;
    }

    // --- Play all ---
    playlistPlayAllBtn.addEventListener('click', function () {
        if (!currentPlaylistId) return;
        var pl = findPlaylist(currentPlaylistId);
        if (!pl) return;
        var available = getAvailableTrackIds(pl);
        if (available.length === 0) {
            AM.showToast('No available tracks');
            return;
        }
        AM.queue.setQueue(available, 0, 'playlist:' + pl.id);
    });

    // --- Shuffle ---
    playlistShuffleBtn.addEventListener('click', function () {
        if (!currentPlaylistId) return;
        var pl = findPlaylist(currentPlaylistId);
        if (!pl) return;
        var available = getAvailableTrackIds(pl);
        if (available.length === 0) {
            AM.showToast('No available tracks');
            return;
        }
        var shuffled = shuffleArray(available);
        AM.queue.setQueue(shuffled, 0, 'playlist:' + pl.id);
    });

    // --- Navigate inside ---
    function showListView() {
        playlistListView.style.display = '';
        playlistInsideView.style.display = 'none';
        currentPlaylistId = null;
    }

    function showInsideView(playlistId) {
        currentPlaylistId = playlistId;
        playlistListView.style.display = 'none';
        playlistInsideView.style.display = '';
        renderPlaylistInside(playlistId);
    }

    playlistBackBtn.addEventListener('click', function () {
        showListView();
        renderPlaylistList();
    });

    // --- Rename by tapping name ---
    playlistInsideName.addEventListener('click', function () {
        if (currentPlaylistId) renamePlaylist(currentPlaylistId);
    });

    // --- Touch drag reorder for playlist tracks ---
    var plTouchDragIndex = null;
    var plTouchDragEl = null;
    var plTouchStartY = 0;
    var plTouchRows = [];

    function plHandleTouchStart(index, el, e) {
        plTouchDragIndex = index;
        plTouchDragEl = el;
        plTouchStartY = e.touches[0].clientY;
        el.style.opacity = '0.6';
        el.style.background = '#222';
        plTouchRows = Array.from(playlistTrackList.querySelectorAll('.track-row'));
    }

    function plHandleTouchMove(e) {
        if (plTouchDragIndex === null) return;
        e.preventDefault();
        var touchY = e.touches[0].clientY;
        var diff = touchY - plTouchStartY;
        if (plTouchDragEl) {
            plTouchDragEl.style.transform = 'translateY(' + diff + 'px)';
        }
    }

    function plHandleTouchEnd(e) {
        if (plTouchDragIndex === null || !plTouchDragEl) return;
        var touchY = e.changedTouches[0].clientY;
        var targetIndex = plTouchDragIndex;

        for (var i = 0; i < plTouchRows.length; i++) {
            var rect = plTouchRows[i].getBoundingClientRect();
            if (touchY >= rect.top && touchY <= rect.bottom) {
                targetIndex = parseInt(plTouchRows[i].dataset.index);
                break;
            }
        }

        plTouchDragEl.style.opacity = '1';
        plTouchDragEl.style.background = '';
        plTouchDragEl.style.transform = '';

        if (targetIndex !== plTouchDragIndex && currentPlaylistId) {
            var pl = findPlaylist(currentPlaylistId);
            if (pl) {
                var moved = pl.trackIds[plTouchDragIndex];
                pl.trackIds.splice(plTouchDragIndex, 1);
                pl.trackIds.splice(targetIndex, 0, moved);
                storage.savePlaylists(playlists);
                renderPlaylistInside(currentPlaylistId);
            }
        }

        plTouchDragIndex = null;
        plTouchDragEl = null;
        plTouchRows = [];
    }

    document.addEventListener('touchmove', plHandleTouchMove, { passive: false });
    document.addEventListener('touchend', plHandleTouchEnd);

    // --- Render playlist list ---
    function renderPlaylistList() {
        if (playlists.length === 0) {
            playlistsEmpty.style.display = '';
            playlistCards.innerHTML = '';
            return;
        }

        playlistsEmpty.style.display = 'none';
        playlistCards.innerHTML = '';

        playlists.forEach(function (pl) {
            var card = document.createElement('div');
            card.className = 'playlist-card';

            var info = document.createElement('div');
            info.className = 'playlist-card-info';

            var nameEl = document.createElement('div');
            nameEl.className = 'playlist-card-name';
            nameEl.textContent = pl.name;

            var countEl = document.createElement('div');
            countEl.className = 'playlist-card-count';
            var validCount = getValidTrackCount(pl);
            countEl.textContent = validCount + ' track' + (validCount !== 1 ? 's' : '');

            var previewEl = document.createElement('div');
            previewEl.className = 'playlist-card-preview';
            var previewNames = [];
            for (var i = 0; i < Math.min(3, pl.trackIds.length); i++) {
                var entry = library.getEntry(pl.trackIds[i]);
                if (entry) {
                    previewNames.push(library.getDisplayName(entry.filename));
                }
            }
            previewEl.textContent = previewNames.join(', ');

            info.appendChild(nameEl);
            info.appendChild(countEl);
            info.appendChild(previewEl);

            var moreBtn = document.createElement('button');
            moreBtn.className = 'playlist-card-more';
            moreBtn.innerHTML = '\u22EF';
            moreBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                AM.openBottomSheet(pl.name, [
                    {
                        icon: '\u25B6',
                        label: 'Play All',
                        action: function () {
                            var available = getAvailableTrackIds(pl);
                            if (available.length === 0) {
                                AM.showToast('No available tracks');
                                return;
                            }
                            AM.queue.setQueue(available, 0, 'playlist:' + pl.id);
                        }
                    },
                    {
                        icon: '\u270E',
                        label: 'Rename',
                        action: function () { renamePlaylist(pl.id); }
                    },
                    {
                        icon: '\u2716',
                        label: 'Delete',
                        danger: true,
                        action: function () { deletePlaylist(pl.id); }
                    }
                ]);
            });

            card.appendChild(info);
            card.appendChild(moreBtn);

            card.addEventListener('click', function () {
                showInsideView(pl.id);
            });

            playlistCards.appendChild(card);
        });
    }

    // --- Render inside playlist ---
    function renderPlaylistInside(playlistId) {
        var pl = findPlaylist(playlistId);
        if (!pl) return;

        playlistInsideName.textContent = pl.name;
        playlistTrackList.innerHTML = '';

        pl.trackIds.forEach(function (trackId, index) {
            var entry = library.getEntry(trackId);
            var available = entry && library.isAvailable(trackId);

            var li = document.createElement('li');
            li.className = 'track-row' + (!entry ? ' unavailable' : (available ? '' : ' unavailable'));
            li.dataset.index = index;
            li.draggable = true;

            // Drag handle
            var handle = document.createElement('span');
            handle.className = 'track-drag-handle';
            handle.innerHTML = '\u2630';
            handle.addEventListener('touchstart', function (e) {
                plHandleTouchStart(index, li, e);
            }, { passive: true });

            var info = document.createElement('div');
            info.className = 'track-info';

            var nameEl = document.createElement('div');
            nameEl.className = 'track-name';
            if (entry) {
                nameEl.textContent = library.getDisplayName(entry.filename);
            } else {
                nameEl.textContent = 'Removed track';
            }

            var metaEl = document.createElement('div');
            metaEl.className = 'track-meta';
            if (entry) {
                var subPath = library.getSubfolder(entry.relativePath);
                metaEl.textContent = (subPath ? subPath + ' \u00B7 ' : '') + library.formatDuration(entry.duration);
            } else {
                metaEl.textContent = 'removed from library';
            }

            info.appendChild(nameEl);
            info.appendChild(metaEl);

            li.appendChild(handle);
            li.appendChild(info);

            if (available) {
                var actions = document.createElement('div');
                actions.className = 'track-actions';

                var moreBtn = document.createElement('button');
                moreBtn.className = 'track-action-btn';
                moreBtn.innerHTML = '\u22EF';
                moreBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    AM.openBottomSheet(nameEl.textContent, [
                        {
                            icon: '\u23ED',
                            label: 'Play Next',
                            action: function () {
                                AM.queue.insertNext(trackId);
                                AM.showToast('Playing next');
                            }
                        },
                        {
                            icon: '\u2795',
                            label: 'Add to Queue',
                            action: function () {
                                AM.queue.addToEnd(trackId);
                                AM.showToast('Added to queue');
                            }
                        },
                        {
                            icon: '\u2716',
                            label: 'Remove from Playlist',
                            danger: true,
                            action: function () {
                                removeTrackFromPlaylist(playlistId, index);
                            }
                        }
                    ]);
                });

                actions.appendChild(moreBtn);
                li.appendChild(actions);

                // Tap to play from this playlist position
                li.addEventListener('click', function () {
                    var availableIds = getAvailableTrackIds(pl);
                    var startIdx = availableIds.indexOf(trackId);
                    if (startIdx === -1) startIdx = 0;
                    AM.queue.setQueue(availableIds, startIdx, 'playlist:' + pl.id);
                });
            } else {
                if (!entry) {
                    var badge = document.createElement('span');
                    badge.className = 'unavailable-label';
                    badge.textContent = 'removed';

                    var rmBtn = document.createElement('button');
                    rmBtn.className = 'track-action-btn';
                    rmBtn.innerHTML = '\u2716';
                    rmBtn.style.color = '#ff453a';
                    rmBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        removeTrackFromPlaylist(playlistId, index);
                    });

                    var acts = document.createElement('div');
                    acts.className = 'track-actions';
                    acts.appendChild(rmBtn);

                    li.appendChild(badge);
                    li.appendChild(acts);
                } else {
                    var badge2 = document.createElement('span');
                    badge2.className = 'unavailable-label';
                    badge2.textContent = 'unavailable';
                    li.appendChild(badge2);
                }
            }

            playlistTrackList.appendChild(li);
        });
    }

    // --- Public API ---
    AM.playlists = {
        addTrackToPlaylist: addTrackToPlaylist,
        showNewInput: showNewInputUI,
        refresh: function () {
            playlists = storage.getPlaylists();
            renderPlaylistList();
            if (currentPlaylistId) {
                renderPlaylistInside(currentPlaylistId);
            }
        }
    };
})();
```

- [ ] After this task, the Playlists tab should allow creating/renaming/deleting playlists, adding tracks from Library, viewing inside a playlist, reordering tracks, and playing from a playlist.
- [ ] Git commit: `feat: add playlists.js with playlist CRUD and Playlists tab UI`

---

## Chunk 7: Settings & Service Worker

### Task 8: settings.js

**Files:**
- Create: `settings.js`

- [ ] Create `settings.js` with the following complete content:

```js
// settings.js — Settings tab UI
(function () {
    'use strict';

    var AM = window.AM = window.AM || {};
    var storage = AM.storage;
    var player = AM.player;
    var library = AM.library;

    var settings = player.getSettings();

    // --- DOM refs ---
    var autoplayToggle = document.getElementById('autoplayToggle');
    var eqToggle = document.getElementById('eqToggle');
    var limiterToggle = document.getElementById('limiterToggle');
    var ceilingSlider = document.getElementById('ceilingSlider');
    var ceilingValue = document.getElementById('ceilingValue');
    var ceilingControls = document.getElementById('ceilingControls');
    var boostWarningToggle = document.getElementById('boostWarningToggle');
    var settingsLoadBtn = document.getElementById('settingsLoadBtn');
    var clearLibraryBtn = document.getElementById('clearLibraryBtn');
    var libraryStats = document.getElementById('libraryStats');
    var resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
    var resetEverythingBtn = document.getElementById('resetEverythingBtn');

    // --- Apply settings to UI ---
    function applySettingsToUI() {
        autoplayToggle.checked = settings.autoplay;
        eqToggle.checked = settings.eqEnabled;
        limiterToggle.checked = settings.limiterEnabled;
        ceilingSlider.value = settings.limiterCeiling;
        ceilingValue.textContent = settings.limiterCeiling.toFixed(1) + ' dB';
        ceilingControls.classList.toggle('disabled', !settings.limiterEnabled);
        boostWarningToggle.checked = settings.boostWarning;
    }

    applySettingsToUI();
    updateStats();

    // --- Event listeners ---
    autoplayToggle.addEventListener('change', function () {
        settings.autoplay = autoplayToggle.checked;
        storage.saveSettings(settings);
    });

    eqToggle.addEventListener('change', function () {
        settings.eqEnabled = eqToggle.checked;
        storage.saveSettings(settings);
        player.setSettings(settings);
    });

    limiterToggle.addEventListener('change', function () {
        settings.limiterEnabled = limiterToggle.checked;
        ceilingControls.classList.toggle('disabled', !settings.limiterEnabled);
        storage.saveSettings(settings);
        player.updateAudioChain();
    });

    ceilingSlider.addEventListener('input', function () {
        var val = parseFloat(ceilingSlider.value);
        settings.limiterCeiling = val;
        ceilingValue.textContent = val.toFixed(1) + ' dB';
        storage.saveSettings(settings);
        player.updateAudioChain();
    });

    boostWarningToggle.addEventListener('change', function () {
        settings.boostWarning = boostWarningToggle.checked;
        storage.saveSettings(settings);
        player.updateBoostWarning();
    });

    // --- Load folder from settings ---
    settingsLoadBtn.addEventListener('click', function () {
        library.triggerFileInput();
    });

    // --- Clear library ---
    clearLibraryBtn.addEventListener('click', function () {
        if (!confirm('Clear all library entries? Playlists will be preserved but tracks will show as removed.')) return;
        library.clearLibrary();
        player.stopPlayback();
        player.hideMiniPlayer();
        updateStats();
        AM.showToast('Library cleared');
    });

    // --- Stats ---
    function updateStats() {
        var entries = library.getEntries();
        var fileMap = library.getFileMap();
        var total = entries.length;
        var available = 0;
        entries.forEach(function (e) {
            if (fileMap.has(e.id)) available++;
        });
        var bytes = storage.getStorageUsed();
        var sizeStr;
        if (bytes < 1024) {
            sizeStr = bytes + ' B';
        } else if (bytes < 1024 * 1024) {
            sizeStr = (bytes / 1024).toFixed(1) + ' KB';
        } else {
            sizeStr = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }
        libraryStats.textContent = total + ' tracks | ' + available + ' available | ' + sizeStr + ' used';
    }

    // --- Reset to defaults ---
    resetDefaultsBtn.addEventListener('click', function () {
        if (!confirm('Reset all settings to defaults? Library and playlists are preserved.')) return;
        settings = storage.getDefaultSettings();
        storage.saveSettings(settings);
        player.setSettings(settings);
        applySettingsToUI();
        AM.showToast('Settings reset');
    });

    // --- Reset everything ---
    resetEverythingBtn.addEventListener('click', function () {
        if (!confirm('Reset EVERYTHING? This will clear settings, library, and all playlists.')) return;
        storage.clearAll();
        settings = storage.getDefaultSettings();
        player.setSettings(settings);
        player.stopPlayback();
        player.hideMiniPlayer();
        library.clearLibrary();
        if (AM.playlists) AM.playlists.refresh();
        if (AM.queue) AM.queue.refresh();
        applySettingsToUI();
        updateStats();
        AM.showToast('Everything reset');
    });

    // --- Observe library changes for stats (call after folder load) ---
    var origRefresh = library.refresh;
    library.refresh = function () {
        origRefresh();
        updateStats();
    };

    // --- Public API ---
    AM.settings = {
        refresh: function () {
            settings = player.getSettings();
            applySettingsToUI();
            updateStats();
        }
    };
})();
```

- [ ] After this task, the Settings tab should have all working toggles, sliders, Clear Library, Reset to Defaults, and Reset Everything buttons. Library stats should update after folder loads.
- [ ] Git commit: `feat: add settings.js with Settings tab UI and all controls`

---

### Task 9: sw.js update

**Files:**
- Modify: `sw.js`

- [ ] Replace the entire contents of `sw.js` with:

```js
const CACHE_NAME = 'audio-manipulator-v11';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './storage.js',
    './player.js',
    './library.js',
    './queue.js',
    './playlists.js',
    './settings.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
```

- [ ] After this task, the PWA should work offline with all new files cached.
- [ ] Git commit: `feat: update sw.js to cache all new app files`

---

## Chunk 8: Verification & Final Commit

### Task 10: End-to-end manual verification

**Files:**
- None (verification only)

- [ ] Open the app in a browser. Verify the four tabs render: Library, Playlists, Queue, Settings.
- [ ] Tap "Load Folder" on the Library tab. Select a folder with .wav files. Verify tracks appear in the Library list.
- [ ] Tap a track in the Library. Verify:
  - Mini player appears at bottom with track name and play/pause button
  - Audio playback starts
  - Queue tab shows the queue with now-playing highlight
- [ ] Tap the mini player to open Now Playing overlay. Verify:
  - Seek bar, transport controls (prev/play-pause/next), speed/pitch slider with semitone buttons, EQ, and volume all work
  - Tap "Done" to dismiss
- [ ] Test speed/pitch: drag slider, tap semitone +/- buttons. Verify playback rate changes.
- [ ] Test EQ: move sliders, tap "Flat" to reset. Verify frequency label colors change.
- [ ] Test volume: drag slider above 100%, verify orange/red warning colors.
- [ ] Navigate to Playlists tab. Create a new playlist. Go back to Library, tap "+" on a track to add to the playlist. Verify it appears.
- [ ] Open the playlist. Tap "Play All". Verify queue updates and playback starts.
- [ ] Tap "Shuffle" on a playlist. Verify queue is randomized.
- [ ] On Queue tab, verify drag reorder works (use drag handle).
- [ ] On Queue tab, tap "Clear Queue". Verify tracks after current are removed.
- [ ] On Settings tab, toggle autoplay off. Verify next track does not auto-play when current ends.
- [ ] On Settings tab, toggle limiter, EQ, and boost warning. Verify they take effect.
- [ ] On Settings tab, tap "Clear Library". Confirm. Verify library is empty. Playlists still exist but show "removed" for tracks.
- [ ] On Settings tab, tap "Reset Everything". Confirm. Verify everything is cleared.
- [ ] Reload the app. Verify library persists (after folder reload to reconnect files).
- [ ] Test on iPhone Safari if available: verify tab bar safe area padding, mini player positioning, and touch interactions.
- [ ] Git commit: `chore: complete music manager implementation`
