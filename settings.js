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
    var monoToggle = document.getElementById('monoToggle');
    var hapticToggle = document.getElementById('hapticToggle');
    var repeatSelect = document.getElementById('repeatSelect');
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
        monoToggle.checked = settings.monoEnabled;
        hapticToggle.checked = settings.hapticEnabled;
        repeatSelect.value = settings.repeatMode;
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

    monoToggle.addEventListener('change', function () {
        settings.monoEnabled = monoToggle.checked;
        storage.saveSettings(settings);
        player.updateAudioChain();
    });

    hapticToggle.addEventListener('change', function () {
        settings.hapticEnabled = hapticToggle.checked;
        storage.saveSettings(settings);
        if (settings.hapticEnabled) AM.haptic(15); // test vibration on enable
    });

    repeatSelect.addEventListener('change', function () {
        settings.repeatMode = repeatSelect.value;
        storage.saveSettings(settings);
        player.updateRepeatUI();
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

    // --- Export/Import ---
    var exportDataBtn = document.getElementById('exportDataBtn');
    var importDataBtn = document.getElementById('importDataBtn');
    var importFileInput = document.getElementById('importFileInput');

    exportDataBtn.addEventListener('click', function () {
        var data = {
            version: 1,
            exportDate: new Date().toISOString(),
            library: storage.getLibrary(),
            playlists: storage.getPlaylists(),
            settings: storage.getSettings(),
            favorites: storage.getFavorites(),
            notes: storage.getNotes()
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'audio-manipulator-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        AM.showToast('Data exported');
    });

    importDataBtn.addEventListener('click', function () {
        importFileInput.click();
    });

    importFileInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
            try {
                var data = JSON.parse(ev.target.result);
                if (!data.library || !data.settings) {
                    AM.showToast('Invalid backup file');
                    return;
                }
                if (!confirm('Import will replace all current data. Continue?')) return;
                storage.saveLibrary(data.library || []);
                storage.savePlaylists(data.playlists || []);
                storage.saveSettings(data.settings);
                storage.saveFavorites(data.favorites || []);
                storage.saveNotes(data.notes || {});

                // Reload state
                settings = storage.getSettings();
                player.setSettings(settings);
                applySettingsToUI();
                library.refresh();
                if (AM.playlists) AM.playlists.refresh();
                if (AM.queue) AM.queue.refresh();
                updateStats();
                AM.showToast('Data imported — reload folder to reconnect files');
            } catch (err) {
                AM.showToast('Error reading backup file');
            }
        };
        reader.readAsText(file);
        importFileInput.value = '';
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
