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
    var introSkipSelect = document.getElementById('introSkipSelect');
    var outroSkipSelect = document.getElementById('outroSkipSelect');
    var fadeInSelect = document.getElementById('fadeInSelect');
    var fadeOutSelect = document.getElementById('fadeOutSelect');
    var crossfadeSelect = document.getElementById('crossfadeSelect');
    var folderDepthSelect = document.getElementById('folderDepthSelect');
    var settingsLoadBtn = document.getElementById('settingsLoadBtn');
    var clearLibraryBtn = document.getElementById('clearLibraryBtn');
    var libraryStats = document.getElementById('libraryStats');
    var resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
    var resetEverythingBtn = document.getElementById('resetEverythingBtn');
    var themeSelect = document.getElementById('themeSelect');
    var animatedBgToggle = document.getElementById('animatedBgToggle');
    var largeTouchToggle = document.getElementById('largeTouchToggle');
    var reduceMotionToggle = document.getElementById('reduceMotionToggle');
    var highContrastToggle = document.getElementById('highContrastToggle');

    // --- Accessibility ---
    function applyAccessibility() {
        var html = document.documentElement;
        if (settings.largeTouchTargets) html.setAttribute('data-large-touch', '');
        else html.removeAttribute('data-large-touch');
        if (settings.reduceMotion) html.setAttribute('data-reduce-motion', '');
        else html.removeAttribute('data-reduce-motion');
        if (settings.highContrast) html.setAttribute('data-high-contrast', '');
        else html.removeAttribute('data-high-contrast');
    }

    applyAccessibility();

    largeTouchToggle.addEventListener('change', function () {
        settings.largeTouchTargets = largeTouchToggle.checked;
        storage.saveSettings(settings);
        applyAccessibility();
    });

    reduceMotionToggle.addEventListener('change', function () {
        settings.reduceMotion = reduceMotionToggle.checked;
        storage.saveSettings(settings);
        applyAccessibility();
        // Also disable animated bg if reduce motion is on
        if (settings.reduceMotion && settings.animatedBg) {
            settings.animatedBg = false;
            storage.saveSettings(settings);
            animatedBgToggle.checked = false;
            applyAnimatedBg(false);
        }
    });

    highContrastToggle.addEventListener('change', function () {
        settings.highContrast = highContrastToggle.checked;
        storage.saveSettings(settings);
        applyAccessibility();
    });

    // --- Animated Background ---
    var npOverlay = document.getElementById('nowPlayingOverlay');

    function applyAnimatedBg(enabled) {
        if (npOverlay) npOverlay.classList.toggle('animated-bg', !!enabled);
    }

    applyAnimatedBg(settings.animatedBg);

    animatedBgToggle.addEventListener('change', function () {
        settings.animatedBg = animatedBgToggle.checked;
        storage.saveSettings(settings);
        applyAnimatedBg(settings.animatedBg);
    });

    // --- Theme ---
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme || 'dark');
        // Update meta theme-color for status bar
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            var colors = { dark: '#0a0a0a', midnight: '#0a0e1a', light: '#f2f2f7' };
            meta.content = colors[theme] || colors.dark;
        }
    }

    applyTheme(settings.theme);

    themeSelect.addEventListener('change', function () {
        settings.theme = themeSelect.value;
        storage.saveSettings(settings);
        applyTheme(settings.theme);
        if (player.refreshAccentColor) player.refreshAccentColor();
    });

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
        introSkipSelect.value = settings.introSkip || 0;
        outroSkipSelect.value = settings.outroSkip || 0;
        fadeInSelect.value = settings.fadeIn || 0;
        fadeOutSelect.value = settings.fadeOut || 0;
        crossfadeSelect.value = settings.crossfade || 0;
        folderDepthSelect.value = settings.folderDepth || 0;
        themeSelect.value = settings.theme || 'dark';
        applyTheme(settings.theme);
        animatedBgToggle.checked = settings.animatedBg;
        applyAnimatedBg(settings.animatedBg);
        autoLevelToggle.checked = settings.autoLevel;
        muteBypassToggle.checked = settings.muteBypass;
        largeTouchToggle.checked = settings.largeTouchTargets;
        reduceMotionToggle.checked = settings.reduceMotion;
        highContrastToggle.checked = settings.highContrast;
        applyAccessibility();
        renderLibraryColumns();
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

    var autoLevelToggle = document.getElementById('autoLevelToggle');
    autoLevelToggle.addEventListener('change', function () {
        settings.autoLevel = autoLevelToggle.checked;
        storage.saveSettings(settings);
    });

    var muteBypassToggle = document.getElementById('muteBypassToggle');
    muteBypassToggle.addEventListener('change', function () {
        settings.muteBypass = muteBypassToggle.checked;
        storage.saveSettings(settings);
        AM.showToast('Reload page for mute bypass change to take effect');
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

    fadeInSelect.addEventListener('change', function () {
        settings.fadeIn = parseInt(fadeInSelect.value);
        storage.saveSettings(settings);
    });

    fadeOutSelect.addEventListener('change', function () {
        settings.fadeOut = parseInt(fadeOutSelect.value);
        storage.saveSettings(settings);
    });

    crossfadeSelect.addEventListener('change', function () {
        settings.crossfade = parseInt(crossfadeSelect.value);
        storage.saveSettings(settings);
    });

    folderDepthSelect.addEventListener('change', function () {
        settings.folderDepth = parseInt(folderDepthSelect.value);
        storage.saveSettings(settings);
    });

    introSkipSelect.addEventListener('change', function () {
        settings.introSkip = parseInt(introSkipSelect.value);
        storage.saveSettings(settings);
    });

    outroSkipSelect.addEventListener('change', function () {
        settings.outroSkip = parseInt(outroSkipSelect.value);
        storage.saveSettings(settings);
    });

    // --- Control Visibility Manager ---
    var CONTROL_GROUPS = [
        { id: 'speed', label: 'Speed / Pitch' },
        { id: 'eq', label: 'Equalizer' },
        { id: 'volume', label: 'Volume' },
        { id: 'pan', label: 'Pan' },
        { id: 'stereowidth', label: 'Stereo Width' },
        { id: 'distortion', label: 'Distortion' },
        { id: 'bitcrusher', label: 'Bitcrusher' },
        { id: 'ringmod', label: 'Ring Modulator' },
        { id: 'delay', label: 'Delay / Echo' },
        { id: 'chorus', label: 'Chorus / Flanger' },
        { id: 'filters', label: 'Filters' },
        { id: 'noise', label: 'Noise Generator' }
    ];

    var controlVisListEl = document.getElementById('controlVisibilityList');

    function renderControlVisibility() {
        controlVisListEl.innerHTML = '';
        var hidden = settings.hiddenGroups || [];
        CONTROL_GROUPS.forEach(function (group) {
            var row = document.createElement('div');
            row.className = 'setting-row';

            var label = document.createElement('span');
            label.className = 'setting-label';
            label.textContent = group.label;

            var toggle = document.createElement('label');
            toggle.className = 'toggle-switch';
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = hidden.indexOf(group.id) === -1;
            var slider = document.createElement('span');
            slider.className = 'toggle-slider';
            toggle.appendChild(input);
            toggle.appendChild(slider);

            input.addEventListener('change', function () {
                var h = settings.hiddenGroups || [];
                if (input.checked) {
                    h = h.filter(function (g) { return g !== group.id; });
                } else {
                    if (h.indexOf(group.id) === -1) h.push(group.id);
                }
                settings.hiddenGroups = h;
                storage.saveSettings(settings);
                applyControlVisibility();
            });

            row.appendChild(label);
            row.appendChild(toggle);
            controlVisListEl.appendChild(row);
        });
    }

    function applyControlVisibility() {
        var hidden = settings.hiddenGroups || [];
        CONTROL_GROUPS.forEach(function (group) {
            var el = document.querySelector('.control-group[data-group="' + group.id + '"]');
            if (el) {
                el.style.display = hidden.indexOf(group.id) >= 0 ? 'none' : '';
            }
        });
    }

    renderControlVisibility();
    applyControlVisibility();

    // --- Library Columns ---
    var LIBRARY_COLUMNS = [
        { id: 'subfolder', label: 'Subfolder' },
        { id: 'duration', label: 'Duration' },
        { id: 'playcount', label: 'Play Count' },
        { id: 'note', label: 'Notes' },
        { id: 'bpm', label: 'BPM' },
        { id: 'artist', label: 'Artist' }
    ];

    var libraryColumnsListEl = document.getElementById('libraryColumnsList');

    function renderLibraryColumns() {
        if (!libraryColumnsListEl) return;
        libraryColumnsListEl.innerHTML = '';
        var cols = settings.libraryColumns || ['subfolder', 'duration', 'playcount', 'note'];
        LIBRARY_COLUMNS.forEach(function (col) {
            var row = document.createElement('div');
            row.className = 'setting-row';

            var label = document.createElement('span');
            label.className = 'setting-label';
            label.textContent = col.label;

            var toggle = document.createElement('label');
            toggle.className = 'toggle-switch';
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = cols.indexOf(col.id) !== -1;
            var slider = document.createElement('span');
            slider.className = 'toggle-slider';
            toggle.appendChild(input);
            toggle.appendChild(slider);

            input.addEventListener('change', function () {
                var c = settings.libraryColumns || [];
                if (input.checked) {
                    if (c.indexOf(col.id) === -1) c.push(col.id);
                } else {
                    c = c.filter(function (x) { return x !== col.id; });
                }
                settings.libraryColumns = c;
                storage.saveSettings(settings);
                if (library.refresh) library.refresh();
            });

            row.appendChild(label);
            row.appendChild(toggle);
            libraryColumnsListEl.appendChild(row);
        });
    }

    renderLibraryColumns();

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
            notes: storage.getNotes(),
            savedQueues: storage.getSavedQueues(),
            cues: storage.getCues(),
            tags: storage.getTags(),
            metadata: storage.getMetadata()
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
                storage.saveSavedQueues(data.savedQueues || []);
                storage.saveCues(data.cues || {});
                storage.saveTags(data.tags || {});
                storage.saveMetadata(data.metadata || {});

                // Reload state
                settings = storage.getSettings();
                player.setSettings(settings);
                applySettingsToUI();
                renderControlVisibility();
                applyControlVisibility();
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
        renderControlVisibility();
        applyControlVisibility();
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
        renderControlVisibility();
        applyControlVisibility();
        updateStats();
        AM.showToast('Everything reset');
    });

    // --- Observe library changes for stats (call after folder load) ---
    var origRefresh = library.refresh;
    library.refresh = function () {
        origRefresh();
        updateStats();
    };

    // --- Diagnostics ---
    var diagRefreshBtn = document.getElementById('diagRefreshBtn');

    function updateDiagnostics() {
        var diag = AM.getDiagnostics ? AM.getDiagnostics() : {};
        var audioCtx = diag.audioCtx || null;
        var buf = diag.audioBuffer || null;

        document.getElementById('diagCtxState').textContent = audioCtx ? audioCtx.state : 'not created';
        document.getElementById('diagSampleRate').textContent = audioCtx ? audioCtx.sampleRate + ' Hz' : '—';
        document.getElementById('diagChannels').textContent = buf ? buf.numberOfChannels : '—';
        document.getElementById('diagDuration').textContent = buf ? buf.duration.toFixed(2) + 's' : '—';
        document.getElementById('diagLatency').textContent = audioCtx && audioCtx.baseLatency !== undefined ? (audioCtx.baseLatency * 1000).toFixed(1) + ' ms' : '—';
        document.getElementById('diagRate').textContent = diag.currentRate ? diag.currentRate.toFixed(2) + 'x' : '—';

        // Active effects
        var effects = [];
        var s = player.getSettings();
        if (s.eqEnabled) effects.push('EQ');
        if (s.limiterEnabled) effects.push('Limiter');
        if (s.monoEnabled) effects.push('Mono');
        if (diag.distortionDrive > 0) effects.push('Distortion');
        if (diag.bitcrusherBits < 16 || diag.bitcrusherCrush > 1) effects.push('Bitcrusher');
        if (diag.ringModFreq > 0) effects.push('Ring Mod');
        if (diag.stereoWidthValue !== 1.0) effects.push('Stereo W');
        document.getElementById('diagEffects').textContent = effects.length > 0 ? effects.join(', ') : 'None';

        // Storage
        var bytes = storage.getStorageUsed();
        var sizeStr;
        if (bytes < 1024) sizeStr = bytes + ' B';
        else if (bytes < 1024 * 1024) sizeStr = (bytes / 1024).toFixed(1) + ' KB';
        else sizeStr = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        document.getElementById('diagStorage').textContent = sizeStr;

        document.getElementById('diagEntries').textContent = library.getEntries().length;
        document.getElementById('diagBypass').textContent = diag.mediaStreamDest ? 'Active' : 'Inactive';
    }

    diagRefreshBtn.addEventListener('click', updateDiagnostics);

    // --- Performance Profiler toggles ---
    var perfOverlayToggle = document.getElementById('perfOverlayToggle');
    var perfOverlayEl = document.getElementById('perfOverlay');

    perfOverlayToggle.addEventListener('change', function () {
        var show = perfOverlayToggle.checked;
        if (perfOverlayEl) perfOverlayEl.style.display = show ? '' : 'none';
        if (AM.perfData) AM.perfData.overlayVisible = show;
        if (show) AM.perfData.peakFrame = 0;  // reset peak on show
    });

    // Feature flag toggles — wire each checkbox to AM.debugFlags
    var flagMap = {
        flagDisableBpm: 'disableBpm',
        flagDisableAutoLevel: 'disableAutoLevel',
        flagDisableSpectrum: 'disableSpectrum',
        flagDisableMeter: 'disableMeter',
        flagDisablePreload: 'disablePreload',
        flagBypassEq: 'bypassEq',
        flagDebounceChain: 'debounceChain'
    };

    Object.keys(flagMap).forEach(function (elId) {
        var checkbox = document.getElementById(elId);
        if (!checkbox) return;
        var flagKey = flagMap[elId];
        checkbox.addEventListener('change', function () {
            if (AM.debugFlags) AM.debugFlags[flagKey] = checkbox.checked;
            // Bypass EQ and debounce require chain rebuild
            if (flagKey === 'bypassEq') player.updateAudioChain();
        });
    });

    // --- Public API ---
    AM.settings = {
        refresh: function () {
            settings = player.getSettings();
            applySettingsToUI();
            updateStats();
        }
    };
})();
