// player.js — Audio engine, Now Playing UI, mini player updates
(function () {
    'use strict';

    var AM = window.AM = window.AM || {};

    // --- Debug flags (runtime, not persisted) ---
    var debugFlags = {
        disableBpm: false,
        disableAutoLevel: false,
        disableSpectrum: false,
        disableMeter: false,
        disablePreload: false,
        bypassEq: false,
        debounceChain: false,
        bypassChain: false,
        throttleUI: false,
        disconnectAnalyser: false
    };

    // --- Performance profiler ---
    var perfData = {
        lastFrameT: 0,
        frameTime: 0,
        peakFrame: 0,
        drops: 0,
        bpmTime: '—',
        autoLvlTime: '—',
        spectrumTime: '—',
        meterTime: '—',
        chainTime: '—',
        preloadTime: '—',
        overlayVisible: false
    };

    AM.debugFlags = debugFlags;
    AM.perfData = perfData;

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
    var pannerNode = null;       // StereoPannerNode for L/R pan
    var monoNode = null;         // ChannelMergerNode for mono downmix
    var mediaStreamDest = null;  // MediaStreamAudioDestinationNode for iOS mute-switch bypass
    var outputAudioEl = null;    // <audio> element that plays the stream
    var isPlaying = false;
    var segmentStartTime = 0;
    var bufferOffset = 0;
    var currentRate = 1.0;
    var isSeeking = false;
    var animFrameId = null;
    var semitones = 0;
    var SEMITONE = Math.pow(2, 1 / 12);
    var miniPlayerVisible = false;
    var isReversed = false;
    var originalBuffer = null;    // Stores the original AudioBuffer when reversed
    var abLoopA = -1;            // A/B loop point A (seconds)
    var abLoopB = -1;            // A/B loop point B (seconds)
    var abLoopState = 0;         // 0=off, 1=A set, 2=looping
    var isNormalized = false;
    var preNormalizeVolume = 0;
    var bitcrusherNode = null;     // ScriptProcessorNode for bitcrusher
    var bitcrusherBits = 16;       // 2-16
    var bitcrusherCrush = 1;       // 1-40 (sample hold factor)
    var distortionNode = null;     // WaveShaperNode for distortion/saturation
    var distortionDrive = 0;       // 0 = off, 1-100 = drive amount
    var ringModGain = null;        // GainNode modulated by carrier oscillator
    var ringModOsc = null;         // OscillatorNode carrier for ring modulation
    var ringModFreq = 0;           // 0 = off, 1-2000 Hz
    var fadeGainNode = null;       // GainNode for fade in/out (separate from user volume)
    var lpFilterNode = null;       // BiquadFilterNode lowpass
    var hpFilterNode = null;       // BiquadFilterNode highpass
    var stereoWidthNode = null;    // ScriptProcessorNode for M/S stereo width
    var stereoWidthValue = 1.0;    // 0=mono, 1=normal, 2=extra wide
    var analyserNode = null;      // AnalyserNode for clip detection
    var analyserData = null;      // Float32Array for time-domain data
    var clipIndicatorEl = null;
    var clipHoldTimer = null;
    var loudnessValueEl = null;
    var loudnessBarEl = null;
    var chorusDelay = null;        // DelayNode for chorus/flanger
    var chorusLfo = null;          // OscillatorNode LFO
    var chorusLfoGain = null;      // GainNode controlling LFO depth
    var chorusWet = null;          // GainNode for wet mix
    var chorusActive = false;      // whether chorus is enabled
    var delayNode = null;          // DelayNode for echo effect
    var delayFeedback = null;      // GainNode for feedback
    var delayWet = null;           // GainNode for wet signal
    var delayTime = 0;             // 0 = off, >0 = delay in seconds
    var delayFeedbackVal = 0.4;    // 0-0.9
    var crossfadeTriggered = false; // prevents re-triggering during same track

    // Preloaded next track for gapless playback
    var preloadedBuffer = null;
    var preloadedTrackId = null;
    var preloadedTrackName = '';
    var preloadedTrackSub = '';

    // Current track metadata (from library entry)
    var currentTrackId = null;
    var currentTrackName = '';
    var currentTrackSub = '';

    // --- Settings ref ---
    var settings = AM.storage.getSettings();

    // --- DOM refs ---
    var playBtn = document.getElementById('playBtn');
    var playIcon = document.getElementById('playIcon');
    var restartBtn = document.getElementById('restartBtn');
    var prevBtn = document.getElementById('prevBtn');
    var repeatBtn = document.getElementById('repeatBtn');
    var repeatIcon = document.getElementById('repeatIcon');
    var nextBtn = document.getElementById('nextBtn');
    var reverseBtn = document.getElementById('reverseBtn');
    var abLoopBtn = document.getElementById('abLoopBtn');
    var abLoopLabel = document.getElementById('abLoopLabel');
    var normalizeBtn = document.getElementById('normalizeBtn');
    var rateSlider = document.getElementById('rateSlider');
    var rateValue = document.getElementById('rateValue');
    var volumeSlider = document.getElementById('volumeSlider');
    var volumeValue = document.getElementById('volumeValue');
    var volumeGroup = document.getElementById('volumeGroup');
    var seekSlider = document.getElementById('seekSlider');
    var waveformCanvas = document.getElementById('waveformCanvas');
    var waveformCtx = waveformCanvas ? waveformCanvas.getContext('2d') : null;
    var waveformProgress = document.getElementById('waveformProgress');
    var spectrumCanvas = document.getElementById('spectrumCanvas');
    var spectrumCtx = spectrumCanvas ? spectrumCanvas.getContext('2d') : null;
    var spectrumSection = document.getElementById('spectrumSection');
    var spectrumToggleBtn = document.getElementById('spectrumToggle');
    var spectrumModeSelect = document.getElementById('spectrumMode');
    var spectrumVisible = true;
    var spectrumFreqData = null; // Uint8Array for frequency data
    var currentTimeEl = document.getElementById('currentTime');
    var totalTimeEl = document.getElementById('totalTime');
    var semitoneUp = document.getElementById('semitoneUp');
    var semitoneDown = document.getElementById('semitoneDown');
    var semitoneValue = document.getElementById('semitoneValue');
    var eqGroup = document.getElementById('eqGroup');
    var eqSlidersContainer = document.getElementById('eqSliders');
    var eqFreqLabels = document.getElementById('eqFreqLabels');
    var eqResetBtn = document.getElementById('eqReset');
    var panSlider = document.getElementById('panSlider');
    var panValueEl = document.getElementById('panValue');
    var stereoWidthSlider = document.getElementById('stereoWidthSlider');
    var stereoWidthValueEl = document.getElementById('stereoWidthValue');
    var bitcrusherBitsSlider = document.getElementById('bitcrusherBits');
    var bitcrusherBitsValue = document.getElementById('bitcrusherBitsValue');
    var bitcrusherCrushSlider = document.getElementById('bitcrusherCrush');
    var bitcrusherCrushValue = document.getElementById('bitcrusherCrushValue');
    var distortionSlider = document.getElementById('distortionSlider');
    var distortionValueEl = document.getElementById('distortionValue');
    var lpFilterSlider = document.getElementById('lpFilterSlider');
    var lpFilterFreqEl = document.getElementById('lpFilterFreq');
    var hpFilterSlider = document.getElementById('hpFilterSlider');
    var hpFilterFreqEl = document.getElementById('hpFilterFreq');

    // Mini player DOM
    var miniPlayer = document.getElementById('miniPlayer');
    var miniPlayerTitle = document.getElementById('miniPlayerTitle');
    var miniPlayerTime = document.getElementById('miniPlayerTime');
    var miniPlayerPlayBtn = document.getElementById('miniPlayerPlayBtn');
    var miniPlayerPlayIcon = document.getElementById('miniPlayerPlayIcon');
    var miniPlayerProgress = document.getElementById('miniPlayerProgress');
    var miniWaveformCanvas = document.getElementById('miniWaveformCanvas');
    var miniWaveformCtx = miniWaveformCanvas ? miniWaveformCanvas.getContext('2d') : null;

    // Now Playing DOM
    var npTrackName = document.getElementById('npTrackName');
    var npTrackSub = document.getElementById('npTrackSub');
    var npAlbumArt = document.getElementById('npAlbumArt');
    var currentArtworkUrl = null; // Object URL for current album art

    // Floating strip DOM
    var floatingStrip = document.getElementById('floatingStrip');
    var floatingPlayBtn = document.getElementById('floatingPlayBtn');
    var floatingTime = document.getElementById('floatingTime');
    var floatingStripFill = document.getElementById('floatingStripFill');
    var floatingTrack = document.getElementById('floatingTrack');
    var npOverlayEl = document.getElementById('nowPlayingOverlay');

    // --- Cached accent color (avoid getComputedStyle in rAF loop) ---
    var cachedAccent = '#0a84ff';
    function refreshAccentColor() {
        cachedAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a84ff';
    }
    refreshAccentColor();

    // --- Build EQ sliders ---
    var eqSliderEls = [];

    // EQ tooltip
    var eqTooltip = document.createElement('div');
    eqTooltip.className = 'eq-tooltip';
    eqTooltip.style.display = 'none';
    document.body.appendChild(eqTooltip);

    var eqTooltipTimer = null;

    function showEqTooltip(slider, freq, val) {
        var sign = val > 0 ? '+' : '';
        eqTooltip.textContent = formatFreq(freq) + ': ' + sign + val.toFixed(1) + ' dB';
        eqTooltip.style.display = '';

        var rect = slider.getBoundingClientRect();
        eqTooltip.style.left = (rect.left + rect.width / 2) + 'px';
        eqTooltip.style.top = (rect.top - 28) + 'px';

        clearTimeout(eqTooltipTimer);
    }

    function hideEqTooltip() {
        eqTooltipTimer = setTimeout(function () {
            eqTooltip.style.display = 'none';
        }, 800);
    }

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
            showEqTooltip(slider, freq, val);
            AM.storage.saveSettings(settings);
        });

        slider.addEventListener('change', hideEqTooltip);
        slider.addEventListener('touchend', hideEqTooltip);

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

    // --- Parametric EQ (Q sliders) ---
    var eqParametricBtn = document.getElementById('eqParametricBtn');
    var eqQRow = document.getElementById('eqQRow');
    var eqQSlidersContainer = document.getElementById('eqQSliders');
    var eqQSliderEls = [];

    // Initialize Q values from settings
    if (!settings.eqQ || settings.eqQ.length !== 10) {
        settings.eqQ = [0, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 0];
    }

    EQ_FREQUENCIES.forEach(function (freq, i) {
        var qSlider = document.createElement('input');
        qSlider.type = 'range';
        qSlider.min = '0.25';
        qSlider.max = '12';
        qSlider.step = '0.25';
        qSlider.value = settings.eqQ[i] || 1.4;
        // Shelving bands (first/last) don't use Q the same way but still allow adjustment
        qSlider.addEventListener('input', function () {
            var val = parseFloat(qSlider.value);
            settings.eqQ[i] = val;
            if (eqFilters[i]) {
                eqFilters[i].Q.value = val;
            }
            AM.storage.saveSettings(settings);
        });
        eqQSlidersContainer.appendChild(qSlider);
        eqQSliderEls.push(qSlider);
    });

    function applyParametricMode(enabled) {
        settings.eqParametric = enabled;
        eqQRow.style.display = enabled ? 'flex' : 'none';
        eqParametricBtn.classList.toggle('eq-parametric-active', enabled);
    }

    applyParametricMode(settings.eqParametric);

    eqParametricBtn.addEventListener('click', function (e) {
        if (e.target.classList.contains('info-btn')) return; // don't toggle on info button
        settings.eqParametric = !settings.eqParametric;
        AM.storage.saveSettings(settings);
        applyParametricMode(settings.eqParametric);
    });

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
                }
                filter.frequency.value = freq;
                filter.gain.value = settings.eqBands[i];
                var qVal = settings.eqQ && settings.eqQ[i] !== undefined ? settings.eqQ[i] : 1.4;
                filter.Q.value = qVal;
                eqFilters.push(filter);
            });

            limiterNode = audioCtx.createDynamicsCompressor();
            limiterNode.threshold.value = settings.limiterCeiling;
            limiterNode.knee.value = 0;
            limiterNode.ratio.value = 20;
            limiterNode.attack.value = 0.003;
            limiterNode.release.value = 0.25;

            // Stereo pan node
            pannerNode = audioCtx.createStereoPanner();
            pannerNode.pan.value = settings.panValue || 0;

            // Mono downmix node — forces output to 1 channel
            monoNode = audioCtx.createChannelMerger(1);

            // Bitcrusher — created lazily in ensureBitcrusher()

            // Ring modulator — a GainNode whose gain is driven by an OscillatorNode
            ringModGain = audioCtx.createGain();
            ringModGain.gain.value = 0; // silent until activated
            ringModOsc = audioCtx.createOscillator();
            ringModOsc.type = 'sine';
            ringModOsc.frequency.value = 440;
            ringModOsc.connect(ringModGain.gain);
            ringModOsc.start();

            // Delay / echo
            delayNode = audioCtx.createDelay(2.0);
            delayNode.delayTime.value = 0.3;
            delayFeedback = audioCtx.createGain();
            delayFeedback.gain.value = 0.4;
            delayWet = audioCtx.createGain();
            delayWet.gain.value = 0.5;
            // Feedback loop: delay → feedback → delay
            delayNode.connect(delayFeedback);
            delayFeedback.connect(delayNode);
            // Wet output: delay → wet gain → (will be connected to chain)
            delayNode.connect(delayWet);

            // Chorus/Flanger — modulated delay
            chorusDelay = audioCtx.createDelay(0.1);
            chorusDelay.delayTime.value = 0.015;
            chorusLfo = audioCtx.createOscillator();
            chorusLfo.type = 'sine';
            chorusLfo.frequency.value = 1.5;
            chorusLfoGain = audioCtx.createGain();
            chorusLfoGain.gain.value = 0.005; // depth in seconds
            chorusLfo.connect(chorusLfoGain);
            chorusLfoGain.connect(chorusDelay.delayTime);
            chorusLfo.start();
            chorusWet = audioCtx.createGain();
            chorusWet.gain.value = 0.5;
            chorusDelay.connect(chorusWet);

            // Distortion / saturation
            distortionNode = audioCtx.createWaveShaper();
            distortionNode.oversample = '4x';

            // Fade gain node (separate from user volume)
            fadeGainNode = audioCtx.createGain();
            fadeGainNode.gain.value = 1.0;

            // LP/HP sweep filters
            lpFilterNode = audioCtx.createBiquadFilter();
            lpFilterNode.type = 'lowpass';
            lpFilterNode.frequency.value = 20000;
            lpFilterNode.Q.value = 0.707;

            hpFilterNode = audioCtx.createBiquadFilter();
            hpFilterNode.type = 'highpass';
            hpFilterNode.frequency.value = 20;
            hpFilterNode.Q.value = 0.707;

            // Stereo width — created lazily in ensureStereoWidth()

            // Analyser for clipping detection + spectrum
            analyserNode = audioCtx.createAnalyser();
            analyserNode.fftSize = 2048;
            analyserNode.smoothingTimeConstant = 0.8;
            analyserData = new Float32Array(analyserNode.fftSize);
            spectrumFreqData = new Uint8Array(analyserNode.frequencyBinCount);
            clipIndicatorEl = document.getElementById('clipIndicator');

            // Loudness meter
            loudnessValueEl = document.getElementById('loudnessValue');
            loudnessBarEl = document.getElementById('loudnessBar');

            // MediaStreamDest bypass for iOS mute switch (opt-in, can cause crackling)
            // On modern iOS (14+), AudioContext from user gesture already bypasses mute.
            // Only create the bypass if the setting is enabled.
            if (settings.muteBypass) {
                mediaStreamDest = audioCtx.createMediaStreamDestination();
                outputAudioEl = new Audio();
                outputAudioEl.setAttribute('playsinline', '');
                outputAudioEl.srcObject = mediaStreamDest.stream;
            }

            updateAudioChain();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // Pre-warm AudioContext on first user interaction (iOS requirement).
    // iOS Safari only allows AudioContext creation/resume inside a user gesture.
    // By creating it on the first tap anywhere in the app, it's already running
    // by the time the async decode completes later.
    var audioUnlocked = false;

    function warmUpAudioContext() {
        if (audioUnlocked) return;
        audioUnlocked = true;

        ensureAudioContext();

        // Prime the output <audio> element from a user gesture so iOS allows
        // it to play later without requiring another gesture.
        if (outputAudioEl) {
            outputAudioEl.play().catch(function () {});
        }

        document.removeEventListener('touchstart', warmUpAudioContext, true);
        document.removeEventListener('click', warmUpAudioContext, true);
    }
    document.addEventListener('touchstart', warmUpAudioContext, true);
    document.addEventListener('click', warmUpAudioContext, true);

    function ensureBitcrusher() {
        if (bitcrusherNode || !audioCtx) return;
        bitcrusherNode = audioCtx.createScriptProcessor(4096, 2, 2);
        var bcLastL = 0, bcLastR = 0, bcCount = 0;
        bitcrusherNode.onaudioprocess = function (e) {
            var inL = e.inputBuffer.getChannelData(0);
            var inR = e.inputBuffer.getChannelData(1);
            var outL = e.outputBuffer.getChannelData(0);
            var outR = e.outputBuffer.getChannelData(1);
            var steps = Math.pow(2, bitcrusherBits);
            var crush = bitcrusherCrush;
            for (var i = 0; i < inL.length; i++) {
                bcCount++;
                if (bcCount >= crush) {
                    bcCount = 0;
                    bcLastL = Math.round(inL[i] * steps) / steps;
                    bcLastR = Math.round(inR[i] * steps) / steps;
                }
                outL[i] = bcLastL;
                outR[i] = bcLastR;
            }
        };
    }

    function ensureStereoWidth() {
        if (stereoWidthNode || !audioCtx) return;
        stereoWidthNode = audioCtx.createScriptProcessor(4096, 2, 2);
        stereoWidthNode.onaudioprocess = function (e) {
            var inputL = e.inputBuffer.getChannelData(0);
            var inputR = e.inputBuffer.getChannelData(1);
            var outputL = e.outputBuffer.getChannelData(0);
            var outputR = e.outputBuffer.getChannelData(1);
            var w = stereoWidthValue;
            for (var s = 0; s < inputL.length; s++) {
                var mid = (inputL[s] + inputR[s]) * 0.5;
                var side = (inputL[s] - inputR[s]) * 0.5;
                outputL[s] = mid + side * w;
                outputR[s] = mid - side * w;
            }
        };
    }

    var _chainDebounceTimer = null;

    function updateAudioChain() {
        if (!gainNode || !audioCtx) return;

        // Debounce: if flag is on, throttle to max 4 calls/sec
        if (debugFlags.debounceChain) {
            if (_chainDebounceTimer) return;
            _chainDebounceTimer = setTimeout(function () { _chainDebounceTimer = null; }, 250);
        }

        var _cT0 = performance.now();

        gainNode.disconnect();
        if (fadeGainNode) fadeGainNode.disconnect();
        if (pannerNode) pannerNode.disconnect();
        eqFilters.forEach(function (f) { f.disconnect(); });
        if (distortionNode) distortionNode.disconnect();
        if (bitcrusherNode) bitcrusherNode.disconnect();
        if (ringModGain) ringModGain.disconnect();
        if (delayNode) { delayNode.disconnect(); delayNode.connect(delayFeedback); delayNode.connect(delayWet); }
        if (delayWet) delayWet.disconnect();
        if (chorusDelay) { chorusDelay.disconnect(); chorusDelay.connect(chorusWet); }
        if (chorusWet) chorusWet.disconnect();
        if (lpFilterNode) lpFilterNode.disconnect();
        if (hpFilterNode) hpFilterNode.disconnect();
        if (limiterNode) limiterNode.disconnect();
        if (monoNode) monoNode.disconnect();
        if (stereoWidthNode) stereoWidthNode.disconnect();
        if (analyserNode) analyserNode.disconnect();

        // BYPASS: source → gain → destination (no processing nodes at all)
        if (debugFlags.bypassChain) {
            var dest = mediaStreamDest || audioCtx.destination;
            gainNode.connect(dest);
            perfData.chainTime = (performance.now() - _cT0).toFixed(2);
            return;
        }

        // Use mediaStreamDest if available (iOS mute-switch bypass), else fallback
        var destination = mediaStreamDest || audioCtx.destination;

        // Smart chain: only connect nodes that are actively processing
        var lastNode = gainNode;

        // fadeGain: only when fade/crossfade is configured or actively fading
        if (fadeGainNode && (fadeGainNode.gain.value !== 1.0 || settings.crossfade > 0 || settings.fadeIn > 0 || settings.fadeOut > 0)) {
            lastNode.connect(fadeGainNode);
            lastNode = fadeGainNode;
        }

        // pan: only when not centered
        if (pannerNode && (settings.panValue || 0) !== 0) {
            pannerNode.pan.value = settings.panValue;
            lastNode.connect(pannerNode);
            lastNode = pannerNode;
        }

        // EQ: only connect bands with non-zero gain (skip flat bands)
        if (settings.eqEnabled && !debugFlags.bypassEq && eqFilters.length > 0) {
            var activeEq = [];
            for (var ei = 0; ei < eqFilters.length; ei++) {
                if (eqFilters[ei].gain.value !== 0) activeEq.push(eqFilters[ei]);
            }
            if (activeEq.length > 0) {
                lastNode.connect(activeEq[0]);
                for (var i = 0; i < activeEq.length - 1; i++) {
                    activeEq[i].connect(activeEq[i + 1]);
                }
                lastNode = activeEq[activeEq.length - 1];
            }
        }

        // Distortion (only when drive > 0)
        if (distortionNode && distortionDrive > 0) {
            lastNode.connect(distortionNode);
            lastNode = distortionNode;
        }

        // Bitcrusher (only when bits < 16 or crush > 1)
        if (bitcrusherBits < 16 || bitcrusherCrush > 1) {
            ensureBitcrusher();
            if (bitcrusherNode) {
                lastNode.connect(bitcrusherNode);
                lastNode = bitcrusherNode;
            }
        }

        // Ring modulator (only when freq > 0)
        if (ringModGain && ringModFreq > 0) {
            lastNode.connect(ringModGain);
            lastNode = ringModGain;
        }

        // LP/HP sweep filters (only when active)
        if (lpFilterNode && lpFilterNode.frequency.value < 19999) {
            lastNode.connect(lpFilterNode);
            lastNode = lpFilterNode;
        }
        if (hpFilterNode && hpFilterNode.frequency.value > 21) {
            lastNode.connect(hpFilterNode);
            lastNode = hpFilterNode;
        }

        if (settings.limiterEnabled && limiterNode) {
            limiterNode.threshold.value = settings.limiterCeiling;
            lastNode.connect(limiterNode);
            lastNode = limiterNode;
        }

        // Stereo width (only when not 100% / 1.0)
        if (stereoWidthValue !== 1.0) {
            ensureStereoWidth();
            if (stereoWidthNode) {
                lastNode.connect(stereoWidthNode);
                lastNode = stereoWidthNode;
            }
        }

        // Delay send (parallel wet path to destination)
        if (delayNode && delayWet && delayTime > 0) {
            lastNode.connect(delayNode);
            delayWet.connect(destination);
        }

        // Chorus/Flanger send (parallel wet path)
        if (chorusDelay && chorusWet && chorusActive) {
            lastNode.connect(chorusDelay);
            chorusWet.connect(destination);
        }

        // Analyser: only connect when spectrum is visible or meter is not disabled
        var needAnalyser = analyserNode && !debugFlags.disconnectAnalyser &&
            (spectrumVisible || !debugFlags.disableMeter);

        if (settings.monoEnabled && monoNode) {
            lastNode.connect(monoNode, 0, 0);
            monoNode.connect(destination);
            if (needAnalyser) monoNode.connect(analyserNode);
        } else {
            lastNode.connect(destination);
            if (needAnalyser) lastNode.connect(analyserNode);
        }

        perfData.chainTime = (performance.now() - _cT0).toFixed(2);
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

    // --- Waveform ---
    function drawWaveform(buffer) {
        if (!waveformCanvas || !waveformCtx) return;
        var wrap = waveformCanvas.parentElement;
        var dpr = window.devicePixelRatio || 1;
        var w = wrap.clientWidth;
        var h = wrap.clientHeight;
        waveformCanvas.width = w * dpr;
        waveformCanvas.height = h * dpr;
        waveformCtx.scale(dpr, dpr);

        // Mix channels down to mono peaks
        var numBars = Math.floor(w / 2); // ~2px per bar with 1px gap
        var ch0 = buffer.getChannelData(0);
        var ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
        var samplesPerBar = Math.floor(ch0.length / numBars);
        var peaks = new Float32Array(numBars);
        var maxPeak = 0;

        for (var i = 0; i < numBars; i++) {
            var start = i * samplesPerBar;
            var end = start + samplesPerBar;
            var peak = 0;
            for (var j = start; j < end && j < ch0.length; j++) {
                var val = (Math.abs(ch0[j]) + Math.abs(ch1[j])) * 0.5;
                if (val > peak) peak = val;
            }
            peaks[i] = peak;
            if (peak > maxPeak) maxPeak = peak;
        }

        // Normalize
        if (maxPeak > 0) {
            for (var i = 0; i < numBars; i++) peaks[i] /= maxPeak;
        }

        // Draw bars
        var accent = cachedAccent;
        waveformCtx.clearRect(0, 0, w, h);
        var barWidth = 1.5;
        var gap = (w / numBars) - barWidth;
        if (gap < 0.5) gap = 0.5;
        var step = barWidth + gap;
        var midY = h / 2;

        for (var i = 0; i < numBars; i++) {
            var barH = Math.max(1, peaks[i] * midY * 0.9);
            var x = i * step;
            waveformCtx.fillStyle = accent;
            waveformCtx.globalAlpha = 0.5;
            waveformCtx.fillRect(x, midY - barH, barWidth, barH * 2);
        }
        waveformCtx.globalAlpha = 1.0;

        // Draw cue markers
        if (currentTrackId && buffer.duration > 0) {
            var trackCues = (AM.storage.getCues()[currentTrackId]) || [];
            trackCues.forEach(function (cue) {
                var cx = (cue.time / buffer.duration) * w;
                waveformCtx.fillStyle = '#ff9f0a';
                waveformCtx.globalAlpha = 0.9;
                waveformCtx.fillRect(cx - 0.5, 0, 1.5, h);
                // Small triangle marker at top
                waveformCtx.beginPath();
                waveformCtx.moveTo(cx - 3, 0);
                waveformCtx.lineTo(cx + 3, 0);
                waveformCtx.lineTo(cx, 5);
                waveformCtx.closePath();
                waveformCtx.fill();
            });

            // A/B loop markers
            if (abLoopA >= 0) {
                var ax = (abLoopA / buffer.duration) * w;
                waveformCtx.fillStyle = '#30d158';
                waveformCtx.globalAlpha = 0.9;
                waveformCtx.fillRect(ax - 0.5, 0, 1.5, h);
            }
            if (abLoopB >= 0) {
                var bx = (abLoopB / buffer.duration) * w;
                waveformCtx.fillStyle = '#ff453a';
                waveformCtx.globalAlpha = 0.9;
                waveformCtx.fillRect(bx - 0.5, 0, 1.5, h);
                // Shade the loop region
                if (abLoopA >= 0) {
                    var ax2 = (abLoopA / buffer.duration) * w;
                    waveformCtx.fillStyle = '#30d158';
                    waveformCtx.globalAlpha = 0.08;
                    waveformCtx.fillRect(ax2, 0, bx - ax2, h);
                }
            }
            waveformCtx.globalAlpha = 1.0;
        }
    }

    function drawMiniWaveform(buffer) {
        if (!miniWaveformCanvas || !miniWaveformCtx) return;
        var dpr = window.devicePixelRatio || 1;
        var w = 80;
        var h = 24;
        miniWaveformCanvas.width = w * dpr;
        miniWaveformCanvas.height = h * dpr;
        miniWaveformCtx.scale(dpr, dpr);

        var numBars = 40;
        var ch0 = buffer.getChannelData(0);
        var samplesPerBar = Math.floor(ch0.length / numBars);
        var peaks = new Float32Array(numBars);
        var maxPeak = 0;

        for (var i = 0; i < numBars; i++) {
            var start = i * samplesPerBar;
            var end = start + samplesPerBar;
            var peak = 0;
            for (var j = start; j < end && j < ch0.length; j++) {
                var val = Math.abs(ch0[j]);
                if (val > peak) peak = val;
            }
            peaks[i] = peak;
            if (peak > maxPeak) maxPeak = peak;
        }

        if (maxPeak > 0) {
            for (var i = 0; i < numBars; i++) peaks[i] /= maxPeak;
        }

        miniWaveformCtx.clearRect(0, 0, w, h);
        var accent = cachedAccent;
        var barW = 1;
        var gap = (w / numBars) - barW;
        var step = barW + gap;
        var midY = h / 2;

        for (var i = 0; i < numBars; i++) {
            var barH = Math.max(0.5, peaks[i] * midY * 0.85);
            miniWaveformCtx.fillStyle = accent;
            miniWaveformCtx.fillRect(i * step, midY - barH, barW, barH * 2);
        }
    }

    // --- Seek UI ---
    function getCurrentBufferPosition() {
        if (!isPlaying) return bufferOffset;
        var wallElapsed = audioCtx.currentTime - segmentStartTime;
        var pos = bufferOffset + wallElapsed * currentRate;
        return audioBuffer ? Math.min(pos, audioBuffer.duration) : pos;
    }

    // Frame counter for throttling expensive operations
    var uiFrameCount = 0;

    function updateSeekUI() {
        if (!audioBuffer) return;

        // --- Perf: frame timing ---
        var now = performance.now();
        if (perfData.lastFrameT > 0) {
            perfData.frameTime = now - perfData.lastFrameT;
            if (perfData.frameTime > perfData.peakFrame) perfData.peakFrame = perfData.frameTime;
            if (perfData.frameTime > 32) perfData.drops++;
        }
        perfData.lastFrameT = now;

        uiFrameCount++;

        // Debug throttle: skip 5 of every 6 frames (~10fps)
        if (debugFlags.throttleUI && uiFrameCount % 6 !== 0) {
            if (isPlaying) animFrameId = requestAnimationFrame(updateSeekUI);
            return;
        }
        var pos = getCurrentBufferPosition();
        var pctDone = pos / audioBuffer.duration;

        // --- Progress bar updates (every frame for smooth visual) ---
        if (waveformProgress) {
            waveformProgress.style.width = (pctDone * 100) + '%';
        }
        miniPlayerProgress.style.width = (pctDone * 100) + '%';
        if (!isSeeking) {
            seekSlider.value = Math.round(pctDone * 1000);
        }

        // --- Text DOM updates (every 4 frames ~15fps — text changes don't need 60fps) ---
        if (uiFrameCount % 4 === 0) {
            currentTimeEl.textContent = formatTime(pos);
            miniPlayerTime.textContent = formatTime(pos);
        }

        // --- Floating strip updates (every 8 frames ~7fps) ---
        if (uiFrameCount % 8 === 0) {
            if (floatingTime) floatingTime.textContent = formatTime(pos);
            if (floatingStripFill) floatingStripFill.style.width = (pctDone * 100) + '%';
            if (floatingTrack) floatingTrack.textContent = currentTrackName;
        }

        // --- Lock screen position state (every 60 frames ~1/sec) ---
        if (uiFrameCount % 60 === 0) {
            if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
                try {
                    navigator.mediaSession.setPositionState({
                        duration: audioBuffer.duration,
                        playbackRate: currentRate,
                        position: Math.min(pos, audioBuffer.duration)
                    });
                } catch (e) {}
            }
        }

        // --- Timing-critical checks (every frame, cheap math only) ---

        // Crossfade: start next track early with volume ramp
        var crossfadeDur = settings.crossfade || 0;
        if (isPlaying && crossfadeDur > 0 && !crossfadeTriggered && abLoopState !== 2 &&
            pos >= audioBuffer.duration - crossfadeDur && settings.autoplay && AM.queue && AM.queue.hasNext()) {
            crossfadeTriggered = true;
            if (fadeGainNode) {
                fadeGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
                fadeGainNode.gain.setValueAtTime(fadeGainNode.gain.value, audioCtx.currentTime);
                fadeGainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + crossfadeDur);
            }
            AM.queue.playNext();
        }

        // Outro skip: trigger end early
        var outroSkip = settings.outroSkip || 0;
        if (isPlaying && outroSkip > 0 && abLoopState !== 2 && pos >= audioBuffer.duration - outroSkip) {
            sourceNode.onended = null;
            sourceNode.stop();
            sourceNode = null;
            isPlaying = false;
            bufferOffset = 0;
            updatePlayIcons(false);
            if (animFrameId) cancelAnimationFrame(animFrameId);
            if (settings.repeatMode === 'one') {
                var introSkipR = settings.introSkip || 0;
                bufferOffset = introSkipR;
                startPlayback();
            } else if (settings.autoplay && AM.queue) {
                if (AM.queue.hasNext()) {
                    AM.queue.playNext();
                } else if (settings.repeatMode === 'all') {
                    AM.queue.playFirst();
                }
            }
            return;
        }

        // A/B loop: jump back to A when reaching B
        if (isPlaying && abLoopState === 2 && pos >= abLoopB) {
            sourceNode.onended = null;
            sourceNode.stop();
            sourceNode = null;
            isPlaying = false;
            bufferOffset = abLoopA;
            startPlayback();
            return;
        }

        // --- Expensive metering (every 4 frames ~15fps) ---
        if (isPlaying && !debugFlags.disableMeter && uiFrameCount % 4 === 0 && analyserNode && analyserData) {
            var _mT0 = performance.now();
            analyserNode.getFloatTimeDomainData(analyserData);
            var clipping = false;
            var sumSq = 0;
            for (var ci = 0; ci < analyserData.length; ci++) {
                var sample = analyserData[ci];
                if (Math.abs(sample) >= 1.0) clipping = true;
                sumSq += sample * sample;
            }
            if (clipping && clipIndicatorEl) {
                clipIndicatorEl.classList.add('active');
                clearTimeout(clipHoldTimer);
                clipHoldTimer = setTimeout(function () {
                    if (clipIndicatorEl) clipIndicatorEl.classList.remove('active');
                }, 500);
            }
            var rms = Math.sqrt(sumSq / analyserData.length);
            var dbfs = rms > 0 ? 20 * Math.log10(rms) : -100;
            if (loudnessValueEl) {
                loudnessValueEl.textContent = dbfs > -100 ? dbfs.toFixed(1) + ' dB' : '-\u221E dB';
            }
            if (loudnessBarEl) {
                var pct = Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
                loudnessBarEl.style.width = pct + '%';
                loudnessBarEl.style.background = dbfs > -3 ? '#ff453a' : dbfs > -14 ? '#ff9f0a' : '#30d158';
            }
            perfData.meterTime = (performance.now() - _mT0).toFixed(1);
        }

        // --- Spectrum analyzer (every 2 frames ~30fps) ---
        if (isPlaying && !debugFlags.disableSpectrum && uiFrameCount % 2 === 0 && analyserNode && spectrumFreqData && spectrumCanvas && spectrumCtx && spectrumVisible) {
            var _sT0 = performance.now();
            analyserNode.getByteFrequencyData(spectrumFreqData);
            drawSpectrum();
            perfData.spectrumTime = (performance.now() - _sT0).toFixed(1);
        }

        // --- Update perf overlay (every 10 frames) ---
        if (perfData.overlayVisible && uiFrameCount % 10 === 0) {
            updatePerfOverlay();
        }

        if (isPlaying) {
            animFrameId = requestAnimationFrame(updateSeekUI);
        }
    }

    function updatePerfOverlay() {
        var el = document.getElementById('perfOverlay');
        if (!el) return;
        var ft = document.getElementById('perfFrameTime');
        var pk = document.getElementById('perfPeak');
        var dr = document.getElementById('perfDrops');
        var cs = document.getElementById('perfCtxState');
        if (ft) ft.textContent = perfData.frameTime.toFixed(1);
        if (pk) pk.textContent = perfData.peakFrame.toFixed(0);
        if (dr) dr.textContent = perfData.drops;
        if (cs) cs.textContent = audioCtx ? audioCtx.state : '—';
        var bt = document.getElementById('perfBpmTime');
        var al = document.getElementById('perfAutoLvl');
        var st = document.getElementById('perfSpecTime');
        var mt = document.getElementById('perfMeterTime');
        var ct = document.getElementById('perfChainTime');
        var pl = document.getElementById('perfPreload');
        if (bt) bt.textContent = perfData.bpmTime;
        if (al) al.textContent = perfData.autoLvlTime;
        if (st) st.textContent = perfData.spectrumTime;
        if (mt) mt.textContent = perfData.meterTime;
        if (ct) ct.textContent = perfData.chainTime;
        if (pl) pl.textContent = perfData.preloadTime;
        // Color-code frame time
        if (ft) {
            ft.className = perfData.frameTime > 32 ? 'perf-bad' : perfData.frameTime > 20 ? 'perf-warn' : '';
        }
    }

    function drawSpectrum() {
        if (!spectrumCanvas || !spectrumCtx || !spectrumFreqData) return;
        var wrap = spectrumCanvas.parentElement;
        var dpr = window.devicePixelRatio || 1;
        var w = wrap.clientWidth;
        var h = 80;
        if (spectrumCanvas.width !== w * dpr || spectrumCanvas.height !== h * dpr) {
            spectrumCanvas.width = w * dpr;
            spectrumCanvas.height = h * dpr;
            spectrumCtx.scale(dpr, dpr);
        }

        spectrumCtx.clearRect(0, 0, w, h);

        var accent = cachedAccent;
        // Use only lower ~60% of bins (above that is mostly silence for music)
        var usableBins = Math.floor(spectrumFreqData.length * 0.6);
        var mode = spectrumModeSelect ? spectrumModeSelect.value : 'bars';

        if (mode === 'line') {
            spectrumCtx.beginPath();
            spectrumCtx.strokeStyle = accent;
            spectrumCtx.lineWidth = 1.5;
            for (var i = 0; i < usableBins; i++) {
                var x = (i / usableBins) * w;
                var val = spectrumFreqData[i] / 255;
                var y = h - val * h * 0.9;
                if (i === 0) spectrumCtx.moveTo(x, y);
                else spectrumCtx.lineTo(x, y);
            }
            spectrumCtx.stroke();
            // Fill under the line
            spectrumCtx.lineTo(w, h);
            spectrumCtx.lineTo(0, h);
            spectrumCtx.closePath();
            spectrumCtx.fillStyle = accent;
            spectrumCtx.globalAlpha = 0.15;
            spectrumCtx.fill();
            spectrumCtx.globalAlpha = 1.0;
        } else {
            var numBars = 64;
            var binsPerBar = Math.floor(usableBins / numBars);
            var barW = (w / numBars) * 0.7;
            var gap = (w / numBars) * 0.3;

            for (var i = 0; i < numBars; i++) {
                var sum = 0;
                for (var j = 0; j < binsPerBar; j++) {
                    sum += spectrumFreqData[i * binsPerBar + j];
                }
                var avg = sum / binsPerBar / 255;
                var barH = Math.max(1, avg * h * 0.9);
                var x = i * (barW + gap);

                // Color gradient: accent at bottom, brighter at top
                spectrumCtx.fillStyle = accent;
                spectrumCtx.globalAlpha = 0.4 + avg * 0.6;
                spectrumCtx.fillRect(x, h - barH, barW, barH);
            }
            spectrumCtx.globalAlpha = 1.0;
        }
    }

    // --- Playback controls ---
    function startPlayback() {
        if (!audioBuffer || !audioCtx) return;

        // iOS Safari requires resume() close to the actual .start() call.
        // The original resume in ensureAudioContext may have been too early
        // (before async FileReader + decodeAudioData), so resume again here.
        var resumePromise = (audioCtx.state === 'suspended')
            ? audioCtx.resume()
            : Promise.resolve();

        resumePromise.then(function () {
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

                    // Repeat one: restart the same track
                    if (settings.repeatMode === 'one') {
                        startPlayback();
                        return;
                    }

                    // Auto-advance to next track in queue
                    if (settings.autoplay && AM.queue) {
                        if (AM.queue.hasNext()) {
                            AM.queue.playNext();
                        } else if (settings.repeatMode === 'all') {
                            AM.queue.playFirst();
                        }
                    }
                }
            };

            sourceNode.start(0, bufferOffset);
            segmentStartTime = audioCtx.currentTime;
            isPlaying = true;

            // Apply fade-in
            var fadeIn = settings.fadeIn || 0;
            if (fadeIn > 0 && fadeGainNode && bufferOffset < fadeIn) {
                fadeGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
                fadeGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
                fadeGainNode.gain.linearRampToValueAtTime(1.0, audioCtx.currentTime + (fadeIn - bufferOffset));
            } else if (fadeGainNode) {
                fadeGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
                fadeGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
            }

            // Schedule fade-out
            var fadeOut = settings.fadeOut || 0;
            if (fadeOut > 0 && fadeGainNode && audioBuffer) {
                var remaining = audioBuffer.duration - bufferOffset;
                if (remaining > fadeOut) {
                    var fadeStartTime = audioCtx.currentTime + (remaining - fadeOut) / currentRate;
                    fadeGainNode.gain.setValueAtTime(1.0, fadeStartTime);
                    fadeGainNode.gain.linearRampToValueAtTime(0, fadeStartTime + fadeOut / currentRate);
                }
            }

            updatePlayIcons(true);
            showMiniPlayer();
            updateSeekUI();

            // Kick the <audio> output element — iOS requires play() from user gesture
            if (outputAudioEl) {
                outputAudioEl.play().catch(function () {});
            }
        });
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
            if (floatingPlayBtn) floatingPlayBtn.innerHTML = '&#9646;&#9646;';
        } else {
            playIcon.innerHTML = '&#9654;';
            miniPlayerPlayIcon.innerHTML = '&#9654;';
            if (floatingPlayBtn) floatingPlayBtn.innerHTML = '&#9654;';
        }
        updateMediaSessionState(playing);
    }

    // --- Media Session API (lock screen controls) ---
    function updateMediaSession(trackName, trackSub) {
        if (!('mediaSession' in navigator)) return;
        var metaOpts = {
            title: trackName,
            artist: trackSub || 'Audio Manipulator'
        };
        if (currentArtworkUrl) {
            metaOpts.artwork = [{ src: currentArtworkUrl, sizes: '512x512', type: 'image/jpeg' }];
        }
        navigator.mediaSession.metadata = new MediaMetadata(metaOpts);
    }

    function updateMediaSessionState(playing) {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }

    function setupMediaSessionHandlers() {
        if (!('mediaSession' in navigator)) return;

        navigator.mediaSession.setActionHandler('play', function () {
            if (audioBuffer && !isPlaying) startPlayback();
        });
        navigator.mediaSession.setActionHandler('pause', function () {
            if (isPlaying) pausePlayback();
        });
        navigator.mediaSession.setActionHandler('previoustrack', function () {
            if (AM.queue && AM.queue.hasPrev()) {
                AM.queue.playPrev();
            } else if (audioBuffer) {
                var wasPlaying = isPlaying;
                stopPlayback();
                bufferOffset = 0;
                if (wasPlaying) startPlayback();
            }
        });
        navigator.mediaSession.setActionHandler('nexttrack', function () {
            if (AM.queue && AM.queue.hasNext()) {
                AM.queue.playNext();
            }
        });

        // iOS may show seek-forward/backward buttons on the lock screen.
        // Wire them to next/prev so they're functional regardless.
        try {
            navigator.mediaSession.setActionHandler('seekforward', function () {
                if (AM.queue && AM.queue.hasNext()) {
                    AM.queue.playNext();
                }
            });
        } catch (e) {}
        try {
            navigator.mediaSession.setActionHandler('seekbackward', function () {
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
                    if (wasPlaying) startPlayback();
                } else if (AM.queue && AM.queue.hasPrev()) {
                    AM.queue.playPrev();
                }
            });
        } catch (e) {}
    }

    setupMediaSessionHandlers();

    // --- Repeat mode button ---
    function updateRepeatUI() {
        repeatBtn.classList.remove('active', 'active-one');
        if (settings.repeatMode === 'all') {
            repeatBtn.classList.add('active');
            repeatIcon.innerHTML = '&#128257;';  // 🔁
        } else if (settings.repeatMode === 'one') {
            repeatBtn.classList.add('active-one');
            repeatIcon.innerHTML = '&#128258;';  // 🔂
        } else {
            repeatIcon.innerHTML = '&#128257;';  // 🔁
        }
    }

    updateRepeatUI();

    repeatBtn.addEventListener('click', function () {
        if (AM.haptic) AM.haptic();
        if (settings.repeatMode === 'off') {
            settings.repeatMode = 'all';
        } else if (settings.repeatMode === 'all') {
            settings.repeatMode = 'one';
        } else {
            settings.repeatMode = 'off';
        }
        AM.storage.saveSettings(settings);
        updateRepeatUI();
    });

    function showMiniPlayer() {
        if (!miniPlayerVisible) {
            miniPlayer.classList.add('visible');
            miniPlayerVisible = true;
        }
    }

    // --- Load a track by File object and metadata ---
    function onBufferReady(buffer, trackId, trackName, trackSub, autoplay) {
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

        // Update lock screen metadata
        updateMediaSession(trackName, trackSub);

        // Write duration back to library entry
        if (AM.library && AM.library.updateDuration) {
            AM.library.updateDuration(trackId, buffer.duration);
        }

        // Render waveform, mini waveform, spectrum, cues and queue peek
        drawWaveform(buffer);
        drawMiniWaveform(buffer);
        if (spectrumSection) spectrumSection.style.display = '';
        renderCues();
        renderQueuePeek();

        // Auto-level (replay gain)
        if (settings.autoLevel && !debugFlags.disableAutoLevel && buffer) {
            var _alT0 = performance.now();
            var sumSq = 0;
            var totalSamples = 0;
            for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
                var data = buffer.getChannelData(ch);
                for (var si = 0; si < data.length; si++) {
                    sumSq += data[si] * data[si];
                }
                totalSamples += data.length;
            }
            var rms = Math.sqrt(sumSq / totalSamples);
            var dbfs = rms > 0 ? 20 * Math.log10(rms) : -100;
            var targetDb = -14; // target loudness
            var adjust = targetDb - dbfs;
            var gain = Math.pow(10, adjust / 20);
            gain = Math.max(0.1, Math.min(gain, 3.0)); // clamp
            volumeSlider.value = gain;
            volumeSlider.dispatchEvent(new Event('input'));
            perfData.autoLvlTime = (performance.now() - _alT0).toFixed(0) + 'ms';
        }

        // Apply intro skip
        var introSkip = settings.introSkip || 0;
        if (introSkip > 0 && introSkip < buffer.duration) {
            bufferOffset = introSkip;
            seekSlider.value = Math.round((introSkip / buffer.duration) * 1000);
            currentTimeEl.textContent = formatTime(introSkip);
        }

        if (autoplay) {
            startPlayback();
        }

        // Detect BPM
        if (!debugFlags.disableBpm) {
            detectBPM(buffer);
        }

        // Preload next track for gapless playback
        if (!debugFlags.disablePreload) {
            preloadNextTrack();
        }
    }

    // --- BPM Detection ---
    var npTrackBpm = document.getElementById('npTrackBpm');

    function detectBPM(buffer) {
        if (!npTrackBpm) return;
        npTrackBpm.style.display = 'none';

        // Run async to avoid blocking UI
        setTimeout(function () {
            try {
                var _bpmT0 = performance.now();
                var sr = buffer.sampleRate;
                var data = buffer.getChannelData(0);

                // Downsample to ~11kHz for efficiency
                var factor = Math.max(1, Math.floor(sr / 11025));
                var len = Math.floor(data.length / factor);
                var downsampled = new Float32Array(len);
                for (var i = 0; i < len; i++) {
                    downsampled[i] = data[i * factor];
                }
                var dsSr = sr / factor;

                // Compute energy in short windows (~23ms)
                var winSize = Math.floor(dsSr * 0.023);
                var numWins = Math.floor(downsampled.length / winSize);
                var energy = new Float32Array(numWins);
                for (var w = 0; w < numWins; w++) {
                    var sum = 0;
                    var offset = w * winSize;
                    for (var j = 0; j < winSize; j++) {
                        sum += downsampled[offset + j] * downsampled[offset + j];
                    }
                    energy[w] = sum / winSize;
                }

                // Compute energy flux (onset detection)
                var flux = new Float32Array(numWins);
                for (var w = 1; w < numWins; w++) {
                    var diff = energy[w] - energy[w - 1];
                    flux[w] = diff > 0 ? diff : 0;
                }

                // Adaptive threshold: find peaks in flux
                var threshWin = 8;
                var peaks = [];
                for (var w = threshWin; w < flux.length - threshWin; w++) {
                    var localMean = 0;
                    for (var k = w - threshWin; k <= w + threshWin; k++) localMean += flux[k];
                    localMean /= (threshWin * 2 + 1);
                    if (flux[w] > localMean * 1.5 && flux[w] > flux[w - 1] && flux[w] > flux[w + 1]) {
                        peaks.push(w);
                    }
                }

                if (peaks.length < 4) {
                    npTrackBpm.textContent = 'BPM: —';
                    npTrackBpm.style.display = '';
                    return;
                }

                // Compute intervals between peaks in seconds
                var intervals = [];
                for (var p = 1; p < peaks.length; p++) {
                    var interval = (peaks[p] - peaks[p - 1]) * winSize / dsSr;
                    if (interval > 0.25 && interval < 2.0) { // 30-240 BPM range
                        intervals.push(interval);
                    }
                }

                if (intervals.length < 3) {
                    npTrackBpm.textContent = 'BPM: —';
                    npTrackBpm.style.display = '';
                    return;
                }

                // Cluster intervals and find dominant
                intervals.sort(function (a, b) { return a - b; });
                var bestCount = 0;
                var bestInterval = 0;
                var tolerance = 0.03; // 30ms

                for (var i = 0; i < intervals.length; i++) {
                    var count = 0;
                    var sum = 0;
                    for (var j = 0; j < intervals.length; j++) {
                        if (Math.abs(intervals[j] - intervals[i]) < tolerance) {
                            count++;
                            sum += intervals[j];
                        }
                    }
                    if (count > bestCount) {
                        bestCount = count;
                        bestInterval = sum / count;
                    }
                }

                if (bestInterval > 0) {
                    var bpm = Math.round(60 / bestInterval);
                    // Normalize to 60-200 range
                    while (bpm > 200) bpm = Math.round(bpm / 2);
                    while (bpm < 60) bpm *= 2;
                    npTrackBpm.textContent = bpm + ' BPM';
                    npTrackBpm.style.display = '';
                    // Store BPM in metadata for library display
                    if (currentTrackId && AM.library && AM.library.setMetadataField) {
                        AM.library.setMetadataField(currentTrackId, 'bpm', bpm);
                    }
                } else {
                    npTrackBpm.textContent = 'BPM: —';
                    npTrackBpm.style.display = '';
                }
                perfData.bpmTime = (performance.now() - _bpmT0).toFixed(0) + 'ms';
            } catch (e) {
                perfData.bpmTime = 'err';
                console.warn('BPM detection error:', e);
            }
        }, 100);
    }

    function preloadNextTrack() {
        if (!AM.queue || !AM.queue.hasNext()) return;
        var nextInfo = AM.queue.getNextTrackInfo();
        if (!nextInfo || !nextInfo.file) return;
        var _plT0 = performance.now();
        perfData.preloadTime = 'loading';
        var reader = new FileReader();
        reader.onload = function (event) {
            if (!audioCtx) return;
            perfData.preloadTime = 'decoding';
            audioCtx.decodeAudioData(event.target.result)
                .then(function (buffer) {
                    preloadedBuffer = buffer;
                    preloadedTrackId = nextInfo.trackId;
                    preloadedTrackName = nextInfo.trackName;
                    preloadedTrackSub = nextInfo.trackSub;
                    perfData.preloadTime = (performance.now() - _plT0).toFixed(0) + 'ms';
                })
                .catch(function () {
                    preloadedBuffer = null;
                    preloadedTrackId = null;
                    perfData.preloadTime = 'err';
                });
        };
        reader.readAsArrayBuffer(nextInfo.file);
    }

    // --- ID3v2 Album Art Extraction ---
    function extractAlbumArt(arrayBuffer) {
        try {
            var view = new DataView(arrayBuffer);
            // Check for ID3v2 header: "ID3"
            if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
                return null;
            }
            var version = view.getUint8(3); // 2, 3, or 4
            var flags = view.getUint8(5);
            // Syncsafe integer for tag size
            var tagSize = (view.getUint8(6) << 21) | (view.getUint8(7) << 14) |
                          (view.getUint8(8) << 7) | view.getUint8(9);
            var offset = 10;
            // Skip extended header if present (ID3v2.3+)
            if (version >= 3 && (flags & 0x40)) {
                var extSize = view.getUint32(offset);
                offset += extSize;
            }

            var frameHeaderSize = version === 2 ? 6 : 10;
            var apicTag = version === 2 ? 'PIC' : 'APIC';
            var end = Math.min(10 + tagSize, arrayBuffer.byteLength);

            while (offset + frameHeaderSize < end) {
                var frameId = '';
                var frameSize;
                if (version === 2) {
                    frameId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2));
                    frameSize = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
                } else {
                    frameId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1),
                                                   view.getUint8(offset + 2), view.getUint8(offset + 3));
                    if (version === 4) {
                        // ID3v2.4 uses syncsafe integers for frame size
                        frameSize = (view.getUint8(offset + 4) << 21) | (view.getUint8(offset + 5) << 14) |
                                    (view.getUint8(offset + 6) << 7) | view.getUint8(offset + 7);
                    } else {
                        frameSize = view.getUint32(offset + 4);
                    }
                }

                if (frameSize === 0 || frameId === '\0\0\0\0' || frameId === '\0\0\0') break;

                if (frameId === apicTag) {
                    var dataStart = offset + frameHeaderSize;
                    var d = dataStart;

                    if (version === 2) {
                        // PIC: encoding(1) + image_format(3) + pic_type(1) + description(null-term) + data
                        d += 1 + 3 + 1; // skip encoding, format, pic type
                        while (d < dataStart + frameSize && view.getUint8(d) !== 0) d++;
                        d++; // skip null terminator
                        var mimeType = 'image/jpeg';
                    } else {
                        // APIC: encoding(1) + mime_type(null-term) + pic_type(1) + description(null-term) + data
                        var encoding = view.getUint8(d);
                        d++;
                        var mimeBytes = [];
                        while (d < dataStart + frameSize && view.getUint8(d) !== 0) {
                            mimeBytes.push(view.getUint8(d));
                            d++;
                        }
                        d++; // skip null terminator
                        var mimeType = String.fromCharCode.apply(null, mimeBytes) || 'image/jpeg';
                        d++; // skip picture type byte
                        // Skip description (null-terminated, encoding-dependent)
                        if (encoding === 1 || encoding === 2) {
                            // UTF-16: look for double null
                            while (d + 1 < dataStart + frameSize) {
                                if (view.getUint8(d) === 0 && view.getUint8(d + 1) === 0) { d += 2; break; }
                                d += 2;
                            }
                        } else {
                            while (d < dataStart + frameSize && view.getUint8(d) !== 0) d++;
                            d++;
                        }
                    }

                    var imgLen = frameSize - (d - dataStart);
                    if (imgLen > 0) {
                        var imgData = new Uint8Array(arrayBuffer, d, imgLen);
                        return new Blob([imgData], { type: mimeType });
                    }
                }

                offset += frameHeaderSize + frameSize;
            }
        } catch (e) {
            // Silently fail — album art is optional
        }
        return null;
    }

    function showAlbumArt(blob) {
        if (currentArtworkUrl) {
            URL.revokeObjectURL(currentArtworkUrl);
            currentArtworkUrl = null;
        }
        if (!npAlbumArt) return;
        var trackInfo = npAlbumArt.parentElement;
        if (!blob) {
            npAlbumArt.style.display = 'none';
            npAlbumArt.innerHTML = '';
            if (trackInfo) trackInfo.classList.remove('has-art');
            return;
        }
        currentArtworkUrl = URL.createObjectURL(blob);
        npAlbumArt.innerHTML = '';
        var img = document.createElement('img');
        img.src = currentArtworkUrl;
        img.alt = 'Album Art';
        npAlbumArt.appendChild(img);
        npAlbumArt.style.display = '';
        if (trackInfo) trackInfo.classList.add('has-art');
    }

    function loadTrack(file, trackId, trackName, trackSub, autoplay) {
        ensureAudioContext();
        stopPlayback();
        audioBuffer = null;
        originalBuffer = null;
        isReversed = false;
        reverseBtn.classList.remove('active');
        isNormalized = false;
        preNormalizeVolume = 0;
        normalizeBtn.classList.remove('active');
        clearAbLoop();
        playBtn.disabled = true;
        seekSlider.disabled = true;
        currentTrackId = trackId;
        currentTrackName = trackName;
        currentTrackSub = trackSub || '';
        crossfadeTriggered = false;

        npTrackName.textContent = 'Loading...';
        npTrackSub.textContent = '';
        miniPlayerTitle.textContent = 'Loading...';

        // Check for preloaded buffer (gapless playback)
        if (preloadedBuffer && preloadedTrackId === trackId) {
            onBufferReady(preloadedBuffer, trackId, trackName, trackSub, autoplay);
            preloadedBuffer = null;
            preloadedTrackId = null;
            return;
        }
        preloadedBuffer = null;
        preloadedTrackId = null;

        // Clear previous album art
        showAlbumArt(null);

        var reader = new FileReader();
        reader.onload = function (event) {
            var rawBuf = event.target.result;

            // Extract album art from ID3v2 tags (non-blocking)
            var artBlob = extractAlbumArt(rawBuf);
            showAlbumArt(artBlob);

            audioCtx.decodeAudioData(rawBuf)
                .then(function (buffer) {
                    onBufferReady(buffer, trackId, trackName, trackSub, autoplay);
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
        restartBtn.disabled = !audioBuffer;
        if (AM.queue) {
            prevBtn.disabled = !AM.queue.hasPrev();
            nextBtn.disabled = !AM.queue.hasNext();
        } else {
            prevBtn.disabled = true;
            nextBtn.disabled = true;
        }
    }

    // --- Floating strip ---
    if (npOverlayEl && floatingStrip) {
        npOverlayEl.addEventListener('scroll', function () {
            // Show floating strip when scrolled past the transport controls (~300px)
            var show = npOverlayEl.scrollTop > 300;
            floatingStrip.classList.toggle('visible', show);
        });

        if (floatingPlayBtn) {
            floatingPlayBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (!audioBuffer) return;
                if (isPlaying) {
                    pausePlayback();
                } else {
                    startPlayback();
                }
            });
        }
    }

    // --- Draggable floating mini player (#89) ---
    if (floatingStrip) {
        var dragStartY = 0;
        var stripStartTop = 0;
        var isDragging = false;

        floatingStrip.addEventListener('touchstart', function (e) {
            // Only start drag if not tapping a button
            if (e.target.tagName === 'BUTTON') return;
            dragStartY = e.touches[0].clientY;
            var rect = floatingStrip.getBoundingClientRect();
            stripStartTop = rect.top;
            isDragging = false;
        });

        floatingStrip.addEventListener('touchmove', function (e) {
            if (dragStartY === 0) return;
            var dy = e.touches[0].clientY - dragStartY;
            if (Math.abs(dy) > 8) isDragging = true;
            if (!isDragging) return;
            e.preventDefault();
            var newTop = stripStartTop + dy;
            // Clamp to viewport
            var minTop = 40;
            var maxTop = window.innerHeight - floatingStrip.offsetHeight - 10;
            newTop = Math.max(minTop, Math.min(maxTop, newTop));
            floatingStrip.style.position = 'fixed';
            floatingStrip.style.top = newTop + 'px';
            floatingStrip.style.bottom = 'auto';
        }, { passive: false });

        floatingStrip.addEventListener('touchend', function () {
            dragStartY = 0;
            isDragging = false;
        });
    }

    // --- Spectrum toggle ---
    if (spectrumToggleBtn) {
        spectrumToggleBtn.addEventListener('click', function () {
            spectrumVisible = !spectrumVisible;
            spectrumCanvas.style.display = spectrumVisible ? 'block' : 'none';
            spectrumToggleBtn.textContent = spectrumVisible ? 'Hide' : 'Show';
            if (!spectrumVisible && spectrumCtx) {
                var dpr = window.devicePixelRatio || 1;
                spectrumCtx.clearRect(0, 0, spectrumCanvas.width / dpr, 80);
            }
        });
    }

    // --- Event listeners ---

    // Play/Pause
    playBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
        if (AM.haptic) AM.haptic();
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
        if (AM.haptic) AM.haptic();
        if (isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    });

    // Restart track from beginning
    restartBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
        if (AM.haptic) AM.haptic();
        var wasPlaying = isPlaying;
        stopPlayback();
        bufferOffset = 0;
        seekSlider.value = 0;
        currentTimeEl.textContent = '0:00';
        miniPlayerProgress.style.width = '0%';
        if (wasPlaying) {
            startPlayback();
        }
    });

    // Prev track
    prevBtn.addEventListener('click', function () {
        if (AM.haptic) AM.haptic();
        if (AM.queue && AM.queue.hasPrev()) {
            AM.queue.playPrev();
        }
    });

    // Next
    nextBtn.addEventListener('click', function () {
        if (AM.haptic) AM.haptic();
        if (AM.queue && AM.queue.hasNext()) {
            AM.queue.playNext();
        }
    });

    // --- Gesture controls on track info ---
    (function () {
        var trackInfoEl = document.querySelector('.np-track-info');
        if (!trackInfoEl) return;
        var startX = 0, startY = 0, startTime = 0;
        var lastTap = 0;

        trackInfoEl.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            startX = t.clientX;
            startY = t.clientY;
            startTime = Date.now();
        }, { passive: true });

        trackInfoEl.addEventListener('touchend', function (e) {
            var t = e.changedTouches[0];
            var dx = t.clientX - startX;
            var dy = t.clientY - startY;
            var elapsed = Date.now() - startTime;
            var absDx = Math.abs(dx);
            var absDy = Math.abs(dy);

            // Swipe detection (min 60px, max 400ms, horizontal dominant)
            if (elapsed < 400 && absDx > 60 && absDx > absDy * 1.5) {
                if (dx < 0 && AM.queue && AM.queue.hasNext()) {
                    // Swipe left = next track
                    AM.queue.playNext();
                    if (AM.haptic) AM.haptic();
                } else if (dx > 0) {
                    // Swipe right = prev / restart
                    if (AM.haptic) AM.haptic();
                    if (audioBuffer && getCurrentBufferPosition() > 3 || !AM.queue || !AM.queue.hasPrev()) {
                        // Restart
                        var wasPlaying = isPlaying;
                        stopPlayback();
                        bufferOffset = 0;
                        seekSlider.value = 0;
                        currentTimeEl.textContent = '0:00';
                        if (wasPlaying) startPlayback();
                    } else {
                        AM.queue.playPrev();
                    }
                }
                return;
            }

            // Double-tap = play/pause
            var now = Date.now();
            if (now - lastTap < 300) {
                if (audioBuffer) {
                    if (isPlaying) pausePlayback(); else startPlayback();
                    if (AM.haptic) AM.haptic();
                }
                lastTap = 0;
                return;
            }
            lastTap = now;
        }, { passive: true });
    })();

    // Waveform tap-to-seek
    if (waveformCanvas) {
        waveformCanvas.addEventListener('click', function (e) {
            if (!audioBuffer) return;
            var rect = waveformCanvas.getBoundingClientRect();
            var fraction = (e.clientX - rect.left) / rect.width;
            fraction = Math.max(0, Math.min(1, fraction));
            var pos = fraction * audioBuffer.duration;
            bufferOffset = pos;
            seekSlider.value = Math.round(fraction * 1000);
            currentTimeEl.textContent = formatTime(pos);
            if (isPlaying) {
                sourceNode.onended = null;
                sourceNode.stop();
                sourceNode = null;
                isPlaying = false;
                startPlayback();
            }
        });
    }

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

    // Speed ramp
    var speedRampTargetEl = document.getElementById('speedRampTarget');
    var speedRampDurationEl = document.getElementById('speedRampDuration');
    var speedRampBtn = document.getElementById('speedRampBtn');
    var speedRampTimer = null;

    speedRampBtn.addEventListener('click', function () {
        if (speedRampTimer) {
            // Cancel active ramp
            clearInterval(speedRampTimer);
            speedRampTimer = null;
            speedRampBtn.textContent = 'Go';
            return;
        }
        var targetPct = parseInt(speedRampTargetEl.value);
        var duration = parseFloat(speedRampDurationEl.value) * 1000; // ms
        var startPct = parseInt(rateSlider.value);
        if (targetPct === startPct) return;

        var startTime = Date.now();
        var stepInterval = 30; // ms per frame
        speedRampBtn.textContent = 'Stop';

        speedRampTimer = setInterval(function () {
            var elapsed = Date.now() - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var currentPct = Math.round(startPct + (targetPct - startPct) * progress);
            rateSlider.value = currentPct;
            rateSlider.dispatchEvent(new Event('input'));

            if (progress >= 1) {
                clearInterval(speedRampTimer);
                speedRampTimer = null;
                speedRampBtn.textContent = 'Go';
            }
        }, stepInterval);
    });

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

    // Pan
    function formatPan(val) {
        if (val === 0) return 'C';
        return val < 0 ? 'L' + Math.abs(val) : 'R' + val;
    }

    panSlider.value = Math.round((settings.panValue || 0) * 100);
    panValueEl.textContent = formatPan(Math.round((settings.panValue || 0) * 100));

    panSlider.addEventListener('input', function () {
        var intVal = parseInt(panSlider.value);
        var floatVal = intVal / 100;
        panValueEl.textContent = formatPan(intVal);
        settings.panValue = floatVal;
        if (pannerNode) {
            pannerNode.pan.value = floatVal;
        }
        AM.storage.saveSettings(settings);
    });

    // Stereo width
    stereoWidthSlider.value = Math.round((settings.stereoWidth || 1.0) * 100);
    stereoWidthValue = settings.stereoWidth || 1.0;
    stereoWidthValueEl.textContent = Math.round(stereoWidthValue * 100) + '%';

    stereoWidthSlider.addEventListener('input', function () {
        var pct = parseInt(stereoWidthSlider.value);
        stereoWidthValue = pct / 100;
        stereoWidthValueEl.textContent = pct + '%';
        settings.stereoWidth = stereoWidthValue;
        AM.storage.saveSettings(settings);
        updateAudioChain();
    });

    // Distortion / saturation
    function makeDistortionCurve(amount) {
        var samples = 44100;
        var curve = new Float32Array(samples);
        var deg = Math.PI / 180;
        var k = amount;
        for (var i = 0; i < samples; i++) {
            var x = (i * 2) / samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    distortionSlider.addEventListener('input', function () {
        distortionDrive = parseInt(distortionSlider.value);
        distortionValueEl.textContent = distortionDrive === 0 ? 'Off' : distortionDrive + '%';
        if (distortionNode) {
            if (distortionDrive > 0) {
                distortionNode.curve = makeDistortionCurve(distortionDrive * 4);
            } else {
                distortionNode.curve = null;
            }
        }
        updateAudioChain();
    });

    // Bitcrusher controls
    var bitcrusherLabelEl = document.getElementById('bitcrusherLabel');
    bitcrusherBitsSlider.addEventListener('input', function () {
        bitcrusherBits = parseInt(bitcrusherBitsSlider.value);
        bitcrusherBitsValue.textContent = bitcrusherBits;
        var active = bitcrusherBits < 16 || bitcrusherCrush > 1;
        bitcrusherLabelEl.textContent = active ? bitcrusherBits + 'b / ' + bitcrusherCrush + 'x' : 'Off';
        updateAudioChain();
    });

    bitcrusherCrushSlider.addEventListener('input', function () {
        bitcrusherCrush = parseInt(bitcrusherCrushSlider.value);
        bitcrusherCrushValue.textContent = bitcrusherCrush + 'x';
        var active = bitcrusherBits < 16 || bitcrusherCrush > 1;
        bitcrusherLabelEl.textContent = active ? bitcrusherBits + 'b / ' + bitcrusherCrush + 'x' : 'Off';
        updateAudioChain();
    });

    // Ring modulator controls
    var ringModSlider = document.getElementById('ringModSlider');
    var ringModFreqEl = document.getElementById('ringModFreqValue');
    var ringModLabelEl = document.getElementById('ringModLabel');

    ringModSlider.addEventListener('input', function () {
        ringModFreq = parseInt(ringModSlider.value);
        if (ringModFreq === 0) {
            ringModFreqEl.textContent = '0';
            ringModLabelEl.textContent = 'Off';
        } else {
            ringModFreqEl.textContent = ringModFreq + ' Hz';
            ringModLabelEl.textContent = ringModFreq + ' Hz';
        }
        if (ringModOsc) {
            ringModOsc.frequency.value = ringModFreq;
        }
        updateAudioChain();
    });

    // Delay / echo controls
    var delayTimeSlider = document.getElementById('delayTimeSlider');
    var delayTimeValueEl = document.getElementById('delayTimeValue');
    var delayFeedbackSlider = document.getElementById('delayFeedbackSlider');
    var delayFeedbackValueEl = document.getElementById('delayFeedbackValue');
    var delayMixSlider = document.getElementById('delayMixSlider');
    var delayMixValueEl = document.getElementById('delayMixValue');
    var delayLabelEl = document.getElementById('delayLabel');

    delayTimeSlider.addEventListener('input', function () {
        var ms = parseInt(delayTimeSlider.value);
        delayTime = ms / 1000;
        delayTimeValueEl.textContent = ms + ' ms';
        delayLabelEl.textContent = ms === 0 ? 'Off' : ms + ' ms';
        if (delayNode) delayNode.delayTime.value = delayTime || 0.001;
        updateAudioChain();
    });

    delayFeedbackSlider.addEventListener('input', function () {
        delayFeedbackVal = parseInt(delayFeedbackSlider.value) / 100;
        delayFeedbackValueEl.textContent = delayFeedbackSlider.value + '%';
        if (delayFeedback) delayFeedback.gain.value = delayFeedbackVal;
    });

    delayMixSlider.addEventListener('input', function () {
        var mix = parseInt(delayMixSlider.value) / 100;
        delayMixValueEl.textContent = delayMixSlider.value + '%';
        if (delayWet) delayWet.gain.value = mix;
    });

    // Chorus / Flanger controls
    var chorusModeSelect = document.getElementById('chorusModeSelect');
    var chorusRateSlider = document.getElementById('chorusRateSlider');
    var chorusRateValueEl = document.getElementById('chorusRateValue');
    var chorusDepthSlider = document.getElementById('chorusDepthSlider');
    var chorusDepthValueEl = document.getElementById('chorusDepthValue');
    var chorusLabelEl = document.getElementById('chorusLabel');

    chorusModeSelect.addEventListener('change', function () {
        var mode = chorusModeSelect.value;
        chorusActive = mode !== 'off';
        chorusLabelEl.textContent = chorusActive ? mode.charAt(0).toUpperCase() + mode.slice(1) : 'Off';
        if (mode === 'chorus') {
            if (chorusDelay) chorusDelay.delayTime.value = 0.015;
            if (chorusLfo) chorusLfo.frequency.value = 1.5;
            if (chorusLfoGain) chorusLfoGain.gain.value = 0.005;
            chorusRateSlider.value = 15;
            chorusRateValueEl.textContent = '1.5 Hz';
            chorusDepthSlider.value = 50;
            chorusDepthValueEl.textContent = '50%';
        } else if (mode === 'flanger') {
            if (chorusDelay) chorusDelay.delayTime.value = 0.003;
            if (chorusLfo) chorusLfo.frequency.value = 0.5;
            if (chorusLfoGain) chorusLfoGain.gain.value = 0.002;
            chorusRateSlider.value = 5;
            chorusRateValueEl.textContent = '0.5 Hz';
            chorusDepthSlider.value = 20;
            chorusDepthValueEl.textContent = '20%';
        }
        updateAudioChain();
    });

    chorusRateSlider.addEventListener('input', function () {
        var rate = parseInt(chorusRateSlider.value) / 10;
        chorusRateValueEl.textContent = rate.toFixed(1) + ' Hz';
        if (chorusLfo) chorusLfo.frequency.value = rate;
    });

    chorusDepthSlider.addEventListener('input', function () {
        var pct = parseInt(chorusDepthSlider.value);
        chorusDepthValueEl.textContent = pct + '%';
        var isFlanger = chorusModeSelect.value === 'flanger';
        var maxDepth = isFlanger ? 0.004 : 0.01;
        if (chorusLfoGain) chorusLfoGain.gain.value = maxDepth * (pct / 100);
    });

    // LP/HP filter sweeps
    function sliderToFreq(val) {
        // Logarithmic: 0→20Hz, 1000→20000Hz
        return 20 * Math.pow(1000, val / 1000);
    }

    function formatFilterFreq(hz) {
        if (hz >= 10000) return (hz / 1000).toFixed(0) + 'k';
        if (hz >= 1000) return (hz / 1000).toFixed(1) + 'k';
        return Math.round(hz) + '';
    }

    lpFilterSlider.addEventListener('input', function () {
        var freq = sliderToFreq(parseInt(lpFilterSlider.value));
        lpFilterFreqEl.textContent = formatFilterFreq(freq);
        if (lpFilterNode) lpFilterNode.frequency.value = freq;
        updateAudioChain();
    });

    hpFilterSlider.addEventListener('input', function () {
        var freq = sliderToFreq(parseInt(hpFilterSlider.value));
        hpFilterFreqEl.textContent = formatFilterFreq(freq);
        if (hpFilterNode) hpFilterNode.frequency.value = freq;
        updateAudioChain();
    });

    // EQ Reset
    eqResetBtn.addEventListener('click', function () {
        applyEqPreset([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        eqPresetSelect.value = 'flat';
    });

    // EQ Presets
    // Bands: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k
    var EQ_PRESETS = {
        flat:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        bass:       [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
        treble:     [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
        vocal:      [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
        rock:       [4, 3, 1, 0, -1, 0, 1, 3, 4, 4],
        electronic: [5, 4, 2, 0, -1, 0, 1, 3, 4, 5],
        classical:  [3, 2, 0, 0, 0, 0, 0, 1, 2, 3],
        loudness:   [4, 3, 0, 0, -1, 0, -1, 0, 3, 4],
        hiphop:     [5, 4, 2, 1, 0, -1, 0, 1, 2, 3],
        acoustic:   [2, 1, 0, 1, 2, 1, 1, 2, 2, 1]
    };

    var eqPresetSelect = document.getElementById('eqPresetSelect');

    function applyEqPreset(bands) {
        settings.eqBands = bands.slice();
        eqSliderEls.forEach(function (slider, i) {
            slider.value = bands[i];
            if (eqFilters[i]) eqFilters[i].gain.value = bands[i];
        });
        updateFreqLabelColors();
        AM.storage.saveSettings(settings);
    }

    eqPresetSelect.addEventListener('change', function () {
        var key = eqPresetSelect.value;
        if (key && EQ_PRESETS[key]) {
            applyEqPreset(EQ_PRESETS[key]);
        }
    });

    // --- Reverse playback ---
    function createReversedBuffer(buffer) {
        var reversed = audioCtx.createBuffer(
            buffer.numberOfChannels,
            buffer.length,
            buffer.sampleRate
        );
        for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
            var src = buffer.getChannelData(ch);
            var dst = reversed.getChannelData(ch);
            for (var i = 0; i < src.length; i++) {
                dst[i] = src[src.length - 1 - i];
            }
        }
        return reversed;
    }

    // --- A/B Loop ---
    function clearAbLoop() {
        abLoopA = -1;
        abLoopB = -1;
        abLoopState = 0;
        abLoopBtn.classList.remove('active');
        abLoopLabel.childNodes[0].textContent = 'A/B ';
        if (audioBuffer) drawWaveform(audioBuffer);
    }

    abLoopBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
        if (AM.haptic) AM.haptic();
        var pos = getCurrentBufferPosition();

        if (abLoopState === 0) {
            // Set point A
            abLoopA = pos;
            abLoopState = 1;
            abLoopBtn.classList.add('active');
            abLoopLabel.childNodes[0].textContent = 'A: ' + formatTime(abLoopA) + ' → ? ';
            if (audioBuffer) drawWaveform(audioBuffer);
        } else if (abLoopState === 1) {
            // Set point B
            if (pos <= abLoopA) {
                AM.showToast('Point B must be after A');
                return;
            }
            abLoopB = pos;
            abLoopState = 2;
            abLoopLabel.childNodes[0].textContent = formatTime(abLoopA) + ' → ' + formatTime(abLoopB) + ' ';
            if (audioBuffer) drawWaveform(audioBuffer);
        } else {
            // Clear loop
            clearAbLoop();
        }
    });

    // --- Audio Normalization ---
    normalizeBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
        if (AM.haptic) AM.haptic();

        if (isNormalized) {
            // Restore original volume
            volumeSlider.value = preNormalizeVolume;
            volumeValue.textContent = Math.round(preNormalizeVolume * 100) + '%';
            if (gainNode) gainNode.gain.value = preNormalizeVolume;
            isNormalized = false;
            normalizeBtn.classList.remove('active');
            updateBoostWarning();
            AM.showToast('Normalization off');
            return;
        }

        // Scan all channels for peak amplitude
        var peak = 0;
        for (var ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
            var data = audioBuffer.getChannelData(ch);
            for (var i = 0; i < data.length; i++) {
                var abs = Math.abs(data[i]);
                if (abs > peak) peak = abs;
            }
        }

        if (peak === 0) {
            AM.showToast('Silent track — cannot normalize');
            return;
        }

        // Compute gain to bring peak to 0 dBFS
        var normalizeGain = 1.0 / peak;

        // Save current volume, apply normalized volume
        preNormalizeVolume = parseFloat(volumeSlider.value);
        var newVol = Math.min(preNormalizeVolume * normalizeGain, 3.0); // cap at 300%

        volumeSlider.value = newVol;
        volumeValue.textContent = Math.round(newVol * 100) + '%';
        if (gainNode) gainNode.gain.value = newVol;

        isNormalized = true;
        normalizeBtn.classList.add('active');
        updateBoostWarning();

        var peakDb = (20 * Math.log10(peak)).toFixed(1);
        AM.showToast('Normalized (peak: ' + peakDb + ' dB)');
    });

    // --- Audio Export ---
    var exportBtn = document.getElementById('exportBtn');
    exportBtn.addEventListener('click', function () {
        if (!audioBuffer) { AM.showToast('No track loaded'); return; }
        if (AM.haptic) AM.haptic();

        var sr = audioBuffer.sampleRate;
        var ch = audioBuffer.numberOfChannels;
        var len = audioBuffer.length;
        var offline = new OfflineAudioContext(ch, len, sr);

        // Source
        var src = offline.createBufferSource();
        src.buffer = audioBuffer;
        src.playbackRate.value = currentRate;

        // Build a simplified effect chain in the offline context
        var lastNode = src;

        // Volume
        var vol = offline.createGain();
        vol.gain.value = parseFloat(volumeSlider.value);
        lastNode.connect(vol);
        lastNode = vol;

        // EQ
        if (settings.eqEnabled && settings.eqBands) {
            var offEqFilters = [];
            for (var i = 0; i < EQ_FREQUENCIES.length; i++) {
                var f = offline.createBiquadFilter();
                f.type = i === 0 ? 'lowshelf' : (i === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking');
                f.frequency.value = EQ_FREQUENCIES[i];
                f.gain.value = settings.eqBands[i] || 0;
                f.Q.value = settings.eqQ && settings.eqQ[i] !== undefined ? settings.eqQ[i] : 1.4;
                lastNode.connect(f);
                lastNode = f;
                offEqFilters.push(f);
            }
        }

        // Distortion
        if (distortionDrive > 0 && distortionNode) {
            var offDist = offline.createWaveShaper();
            offDist.curve = distortionNode.curve;
            offDist.oversample = '4x';
            lastNode.connect(offDist);
            lastNode = offDist;
        }

        // LP filter
        if (lpFilterNode && lpFilterNode.frequency.value < 20000) {
            var offLP = offline.createBiquadFilter();
            offLP.type = 'lowpass';
            offLP.frequency.value = lpFilterNode.frequency.value;
            offLP.Q.value = lpFilterNode.Q.value;
            lastNode.connect(offLP);
            lastNode = offLP;
        }

        // HP filter
        if (hpFilterNode && hpFilterNode.frequency.value > 20) {
            var offHP = offline.createBiquadFilter();
            offHP.type = 'highpass';
            offHP.frequency.value = hpFilterNode.frequency.value;
            offHP.Q.value = hpFilterNode.Q.value;
            lastNode.connect(offHP);
            lastNode = offHP;
        }

        // Limiter
        if (settings.limiterEnabled) {
            var offLim = offline.createDynamicsCompressor();
            offLim.threshold.value = settings.limiterCeiling || -1;
            offLim.knee.value = 0;
            offLim.ratio.value = 20;
            offLim.attack.value = 0.001;
            offLim.release.value = 0.1;
            lastNode.connect(offLim);
            lastNode = offLim;
        }

        lastNode.connect(offline.destination);
        src.start(0);

        AM.showToast('Exporting...');
        exportBtn.disabled = true;

        offline.startRendering().then(function (rendered) {
            // Encode to WAV
            var wavData = encodeWAV(rendered);
            var blob = new Blob([wavData], { type: 'audio/wav' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            var name = currentTrackName || 'export';
            a.download = name.replace(/\.[^.]+$/, '') + '_fx.wav';
            a.click();
            URL.revokeObjectURL(url);
            exportBtn.disabled = false;
            AM.showToast('Export complete');
        }).catch(function (err) {
            console.error('Export error:', err);
            exportBtn.disabled = false;
            AM.showToast('Export failed');
        });
    });

    function encodeWAV(buffer) {
        var numCh = buffer.numberOfChannels;
        var sr = buffer.sampleRate;
        var len = buffer.length;
        var bytesPerSample = 2; // 16-bit
        var blockAlign = numCh * bytesPerSample;
        var dataSize = len * blockAlign;
        var headerSize = 44;
        var arrayBuf = new ArrayBuffer(headerSize + dataSize);
        var view = new DataView(arrayBuf);

        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // chunk size
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, numCh, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true); // bits per sample
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Interleave channels and write 16-bit PCM
        var channels = [];
        for (var c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
        var offset = 44;
        for (var i = 0; i < len; i++) {
            for (var c = 0; c < numCh; c++) {
                var sample = Math.max(-1, Math.min(1, channels[c][i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }
        return arrayBuf;
    }

    function writeString(view, offset, str) {
        for (var i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    reverseBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
        if (AM.haptic) AM.haptic();

        var wasPlaying = isPlaying;
        var pos = getCurrentBufferPosition();
        if (wasPlaying) {
            sourceNode.onended = null;
            sourceNode.stop();
            sourceNode = null;
            isPlaying = false;
        }

        if (!isReversed) {
            originalBuffer = audioBuffer;
            audioBuffer = createReversedBuffer(originalBuffer);
            isReversed = true;
        } else {
            audioBuffer = originalBuffer;
            originalBuffer = null;
            isReversed = false;
        }

        // Mirror playback position
        bufferOffset = audioBuffer.duration - pos;
        if (bufferOffset < 0) bufferOffset = 0;

        reverseBtn.classList.toggle('active', isReversed);
        drawWaveform(audioBuffer);

        if (wasPlaying) {
            startPlayback();
        } else {
            // Update seek UI to reflect mirrored position
            seekSlider.value = Math.round((bufferOffset / audioBuffer.duration) * 1000);
            currentTimeEl.textContent = formatTime(bufferOffset);
        }
    });

    // --- Cue Points ---
    var cueSection = document.getElementById('cueSection');
    var cueAddBtn = document.getElementById('cueAddBtn');
    var cueChipsEl = document.getElementById('cueChips');
    var allCues = AM.storage.getCues();

    function renderCues() {
        if (!currentTrackId) {
            cueSection.style.display = 'none';
            return;
        }
        cueSection.style.display = '';
        var trackCues = allCues[currentTrackId] || [];
        cueChipsEl.innerHTML = '';
        trackCues.sort(function (a, b) { return a.time - b.time; });
        trackCues.forEach(function (cue, idx) {
            var chip = document.createElement('div');
            chip.className = 'cue-chip';

            var nameSpan = document.createElement('span');
            nameSpan.textContent = cue.name;
            chip.appendChild(nameSpan);

            var timeSpan = document.createElement('span');
            timeSpan.className = 'cue-time';
            timeSpan.textContent = formatTime(cue.time);
            chip.appendChild(timeSpan);

            var delBtn = document.createElement('span');
            delBtn.className = 'cue-del';
            delBtn.textContent = '\u2716';
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                trackCues.splice(idx, 1);
                if (trackCues.length === 0) {
                    delete allCues[currentTrackId];
                } else {
                    allCues[currentTrackId] = trackCues;
                }
                AM.storage.saveCues(allCues);
                renderCues();
                if (audioBuffer) drawWaveform(audioBuffer);
            });
            chip.appendChild(delBtn);

            // Tap to jump
            chip.addEventListener('click', function () {
                if (!audioBuffer) return;
                var wasPlaying = isPlaying;
                if (wasPlaying) {
                    sourceNode.onended = null;
                    sourceNode.stop();
                    sourceNode = null;
                    isPlaying = false;
                }
                bufferOffset = cue.time;
                seekSlider.value = Math.round((cue.time / audioBuffer.duration) * 1000);
                currentTimeEl.textContent = formatTime(cue.time);
                if (wasPlaying) startPlayback();
            });

            cueChipsEl.appendChild(chip);
        });
    }

    cueAddBtn.addEventListener('click', function () {
        if (!audioBuffer || !currentTrackId) return;
        var pos = getCurrentBufferPosition();
        var name = prompt('Cue name:', 'Cue ' + ((allCues[currentTrackId] || []).length + 1));
        if (!name || !name.trim()) return;
        if (!allCues[currentTrackId]) allCues[currentTrackId] = [];
        allCues[currentTrackId].push({ name: name.trim(), time: pos });
        AM.storage.saveCues(allCues);
        renderCues();
        AM.showToast('Cue added at ' + formatTime(pos));
    });

    // --- Noise Generator ---
    var noiseNode = null;
    var noiseGainNode = null;
    var currentNoiseType = 'off';
    var pinkState = [0, 0, 0, 0, 0, 0, 0]; // Pink noise state

    var noiseVolSlider = document.getElementById('noiseVolumeSlider');
    var noiseVolValue = document.getElementById('noiseVolumeValue');
    var noiseTypeBtns = document.querySelectorAll('.noise-type-btn');

    function startNoise(type) {
        stopNoise();
        if (type === 'off') {
            currentNoiseType = 'off';
            updateNoiseButtons();
            return;
        }
        ensureAudioContext();
        currentNoiseType = type;

        noiseGainNode = audioCtx.createGain();
        noiseGainNode.gain.value = parseInt(noiseVolSlider.value) / 100;

        var destination = mediaStreamDest || audioCtx.destination;
        noiseGainNode.connect(destination);

        noiseNode = audioCtx.createScriptProcessor(4096, 0, 1);
        pinkState = [0, 0, 0, 0, 0, 0, 0];
        var brownLast = 0;

        noiseNode.onaudioprocess = function (e) {
            var output = e.outputBuffer.getChannelData(0);
            for (var i = 0; i < output.length; i++) {
                if (currentNoiseType === 'white') {
                    output[i] = Math.random() * 2 - 1;
                } else if (currentNoiseType === 'pink') {
                    // Voss-McCartney approximation
                    var white = Math.random() * 2 - 1;
                    pinkState[0] = 0.99886 * pinkState[0] + white * 0.0555179;
                    pinkState[1] = 0.99332 * pinkState[1] + white * 0.0750759;
                    pinkState[2] = 0.96900 * pinkState[2] + white * 0.1538520;
                    pinkState[3] = 0.86650 * pinkState[3] + white * 0.3104856;
                    pinkState[4] = 0.55000 * pinkState[4] + white * 0.5329522;
                    pinkState[5] = -0.7616 * pinkState[5] - white * 0.0168980;
                    output[i] = (pinkState[0] + pinkState[1] + pinkState[2] + pinkState[3] + pinkState[4] + pinkState[5] + pinkState[6] + white * 0.5362) * 0.11;
                    pinkState[6] = white * 0.115926;
                } else if (currentNoiseType === 'brown') {
                    var w = Math.random() * 2 - 1;
                    brownLast = (brownLast + (0.02 * w)) / 1.02;
                    output[i] = brownLast * 3.5;
                }
            }
        };

        noiseNode.connect(noiseGainNode);
        updateNoiseButtons();
    }

    function stopNoise() {
        if (noiseNode) {
            noiseNode.disconnect();
            noiseNode = null;
        }
        if (noiseGainNode) {
            noiseGainNode.disconnect();
            noiseGainNode = null;
        }
    }

    function updateNoiseButtons() {
        noiseTypeBtns.forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.noise === currentNoiseType);
        });
    }

    noiseTypeBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            startNoise(btn.dataset.noise);
        });
    });

    noiseVolSlider.addEventListener('input', function () {
        var val = parseInt(noiseVolSlider.value);
        noiseVolValue.textContent = val + '%';
        if (noiseGainNode) noiseGainNode.gain.value = val / 100;
    });

    updateNoiseButtons();

    // --- Queue Peek (Up Next) ---
    var queuePeekEl = document.getElementById('queuePeek');
    var queuePeekListEl = document.getElementById('queuePeekList');
    var PEEK_COUNT = 3;

    function renderQueuePeek() {
        if (!AM.queue) { queuePeekEl.style.display = 'none'; return; }
        var ids = AM.queue.getTrackIds();
        var idx = AM.queue.getCurrentIndex();
        var upcoming = ids.slice(idx + 1, idx + 1 + PEEK_COUNT);
        if (upcoming.length === 0) {
            queuePeekEl.style.display = 'none';
            return;
        }
        queuePeekEl.style.display = '';
        queuePeekListEl.innerHTML = '';
        var entries = AM.library ? AM.library.getEntries() : [];
        upcoming.forEach(function (trackId, offset) {
            var entry = entries.find(function (e) { return e.id === trackId; });
            var name = entry ? entry.name : trackId;
            var row = document.createElement('div');
            row.className = 'queue-peek-item';
            row.textContent = (offset + 1) + '. ' + name;
            row.addEventListener('click', function () {
                // Skip to this track
                var targetIdx = idx + 1 + offset;
                AM.queue.playAt(targetIdx);
            });
            queuePeekListEl.appendChild(row);
        });
    }

    // --- Playback Presets ---
    var presetSaveBtn = document.getElementById('presetSaveBtn');
    var presetsListEl = document.getElementById('presetsList');

    function capturePreset() {
        return {
            rate: parseInt(rateSlider.value),
            volume: parseFloat(volumeSlider.value),
            eqBands: settings.eqBands.slice(),
            panValue: settings.panValue || 0,
            stereoWidth: settings.stereoWidth || 1.0,
            lpFilter: parseInt(lpFilterSlider.value),
            hpFilter: parseInt(hpFilterSlider.value)
        };
    }

    function applyPreset(p) {
        // Speed
        rateSlider.value = p.rate;
        rateSlider.dispatchEvent(new Event('input'));
        // Volume
        volumeSlider.value = p.volume;
        volumeSlider.dispatchEvent(new Event('input'));
        // EQ
        applyEqPreset(p.eqBands);
        // Pan
        panSlider.value = Math.round(p.panValue * 100);
        panSlider.dispatchEvent(new Event('input'));
        // Stereo width
        stereoWidthSlider.value = Math.round(p.stereoWidth * 100);
        stereoWidthSlider.dispatchEvent(new Event('input'));
        // LP/HP
        lpFilterSlider.value = p.lpFilter;
        lpFilterSlider.dispatchEvent(new Event('input'));
        hpFilterSlider.value = p.hpFilter;
        hpFilterSlider.dispatchEvent(new Event('input'));

        AM.showToast('Preset applied');
    }

    var presetSortSelect = document.getElementById('presetSortSelect');

    function getSortedPresets() {
        var presets = AM.storage.getPlaybackPresets();
        var sort = presetSortSelect.value;
        if (sort === 'az') {
            presets.sort(function (a, b) { return a.name.localeCompare(b.name); });
        } else if (sort === 'za') {
            presets.sort(function (a, b) { return b.name.localeCompare(a.name); });
        } else if (sort === 'newest') {
            presets.sort(function (a, b) { return (b.id || '').localeCompare(a.id || ''); });
        } else if (sort === 'oldest') {
            presets.sort(function (a, b) { return (a.id || '').localeCompare(b.id || ''); });
        }
        return presets;
    }

    presetSortSelect.addEventListener('change', function () { renderPresets(); });

    function renderPresets() {
        var presets = getSortedPresets();
        presetsListEl.innerHTML = '';
        presets.forEach(function (p) {
            var chip = document.createElement('div');
            chip.className = 'preset-chip';

            var nameSpan = document.createElement('span');
            nameSpan.textContent = p.name;
            chip.appendChild(nameSpan);

            var delBtn = document.createElement('span');
            delBtn.className = 'preset-delete';
            delBtn.textContent = '\u2716';
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var all = AM.storage.getPlaybackPresets();
                var i = all.findIndex(function (x) { return x.id === p.id; });
                if (i >= 0) all.splice(i, 1);
                AM.storage.savePlaybackPresets(all);
                renderPresets();
                AM.showToast('Preset deleted');
            });
            chip.appendChild(delBtn);

            // Tap to apply
            chip.addEventListener('click', function () {
                applyPreset(p.data);
            });

            // Long-press to rename
            var lpTimer = null;
            chip.addEventListener('touchstart', function (e) {
                lpTimer = setTimeout(function () {
                    lpTimer = null;
                    e.preventDefault();
                    var newName = prompt('Rename preset:', p.name);
                    if (!newName || !newName.trim()) return;
                    var all = AM.storage.getPlaybackPresets();
                    var match = all.find(function (x) { return x.id === p.id; });
                    if (match) match.name = newName.trim();
                    AM.storage.savePlaybackPresets(all);
                    renderPresets();
                    AM.showToast('Preset renamed');
                }, 600);
            });
            chip.addEventListener('touchend', function () {
                if (lpTimer) clearTimeout(lpTimer);
                lpTimer = null;
            });
            chip.addEventListener('touchmove', function () {
                if (lpTimer) clearTimeout(lpTimer);
                lpTimer = null;
            });

            presetsListEl.appendChild(chip);
        });
    }

    presetSaveBtn.addEventListener('click', function () {
        var name = prompt('Preset name:');
        if (!name || !name.trim()) return;
        var presets = AM.storage.getPlaybackPresets();
        presets.push({
            id: crypto.randomUUID(),
            name: name.trim(),
            data: capturePreset()
        });
        AM.storage.savePlaybackPresets(presets);
        renderPresets();
        AM.showToast('Preset saved: ' + name.trim());
    });

    renderPresets();

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
            updateRepeatUI();
        },
        updateAudioChain: updateAudioChain,
        updateBoostWarning: updateBoostWarning,
        updateRepeatUI: updateRepeatUI,
        renderQueuePeek: renderQueuePeek,
        hideMiniPlayer: function () {
            miniPlayer.classList.remove('visible');
            miniPlayerVisible = false;
        },
        formatTime: formatTime,
        EQ_FREQUENCIES: EQ_FREQUENCIES,
        refreshAccentColor: refreshAccentColor
    };

    // Expose diagnostics getters
    AM.getDiagnostics = function () {
        return {
            audioCtx: audioCtx,
            audioBuffer: audioBuffer,
            currentRate: currentRate,
            mediaStreamDest: mediaStreamDest,
            distortionDrive: distortionDrive,
            bitcrusherBits: bitcrusherBits,
            bitcrusherCrush: bitcrusherCrush,
            ringModFreq: ringModFreq,
            stereoWidthValue: stereoWidthValue
        };
    };
})();
