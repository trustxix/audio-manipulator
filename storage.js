// storage.js — localStorage abstraction with am- prefix keys
(function () {
    'use strict';

    const KEYS = {
        library: 'am-library',
        playlists: 'am-playlists',
        settings: 'am-settings',
        favorites: 'am-favorites',
        notes: 'am-notes',
        savedQueues: 'am-savedQueues',
        playbackPresets: 'am-playbackPresets',
        cues: 'am-cues',
        tags: 'am-tags',
        metadata: 'am-metadata'
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
        eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        eqQ: [0, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 0],
        eqParametric: false,
        monoEnabled: false,
        repeatMode: 'off',
        hapticEnabled: false,
        panValue: 0,
        stereoWidth: 1.0,
        introSkip: 0,
        outroSkip: 0,
        fadeIn: 0,
        fadeOut: 0,
        collapsedGroups: [],
        hiddenGroups: [],
        theme: 'dark',
        animatedBg: false,
        autoLevel: false,
        crossfade: 0,
        folderDepth: 0,
        controlOrder: [],
        largeTouchTargets: false,
        reduceMotion: false,
        highContrast: false,
        libraryColumns: ['subfolder', 'duration', 'playcount', 'note'],
        muteBypass: false
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

        getFavorites: function () {
            return safeGet(KEYS.favorites, []);
        },

        saveFavorites: function (ids) {
            return safeSet(KEYS.favorites, ids);
        },

        getNotes: function () {
            return safeGet(KEYS.notes, {});
        },

        saveNotes: function (notes) {
            return safeSet(KEYS.notes, notes);
        },

        getSavedQueues: function () {
            return safeGet(KEYS.savedQueues, []);
        },

        saveSavedQueues: function (queues) {
            return safeSet(KEYS.savedQueues, queues);
        },

        getPlaybackPresets: function () {
            return safeGet(KEYS.playbackPresets, []);
        },

        savePlaybackPresets: function (presets) {
            return safeSet(KEYS.playbackPresets, presets);
        },

        getCues: function () {
            return safeGet(KEYS.cues, {});
        },

        saveCues: function (cues) {
            return safeSet(KEYS.cues, cues);
        },

        getTags: function () {
            return safeGet(KEYS.tags, {});
        },

        saveTags: function (tags) {
            return safeSet(KEYS.tags, tags);
        },

        getMetadata: function () {
            return safeGet(KEYS.metadata, {});
        },

        saveMetadata: function (meta) {
            return safeSet(KEYS.metadata, meta);
        },

        clearAll: function () {
            safeRemove(KEYS.library);
            safeRemove(KEYS.playlists);
            safeRemove(KEYS.settings);
            safeRemove(KEYS.favorites);
            safeRemove(KEYS.notes);
            safeRemove(KEYS.savedQueues);
            safeRemove(KEYS.playbackPresets);
            safeRemove(KEYS.cues);
            safeRemove(KEYS.tags);
            safeRemove(KEYS.metadata);
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
