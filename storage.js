// storage.js — localStorage abstraction with am- prefix keys
(function () {
    'use strict';

    const KEYS = {
        library: 'am-library',
        playlists: 'am-playlists',
        settings: 'am-settings',
        favorites: 'am-favorites'
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
        monoEnabled: false,
        repeatMode: 'off',
        hapticEnabled: false
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

        clearAll: function () {
            safeRemove(KEYS.library);
            safeRemove(KEYS.playlists);
            safeRemove(KEYS.settings);
            safeRemove(KEYS.favorites);
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
