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
    var distortionNode = null;     // WaveShaperNode for distortion/saturation
    var distortionDrive = 0;       // 0 = off, 1-100 = drive amount
    var fadeGainNode = null;       // GainNode for fade in/out (separate from user volume)
    var lpFilterNode = null;       // BiquadFilterNode lowpass
    var hpFilterNode = null;       // BiquadFilterNode highpass
    var stereoWidthNode = null;    // ScriptProcessorNode for M/S stereo width
    var stereoWidthValue = 1.0;    // 0=mono, 1=normal, 2=extra wide
    var analyserNode = null;      // AnalyserNode for clip detection
    var analyserData = null;      // Float32Array for time-domain data
    var clipIndicatorEl = null;
    var clipHoldTimer = null;

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

    // Now Playing DOM
    var npTrackName = document.getElementById('npTrackName');
    var npTrackSub = document.getElementById('npTrackSub');

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

            // Stereo pan node
            pannerNode = audioCtx.createStereoPanner();
            pannerNode.pan.value = settings.panValue || 0;

            // Mono downmix node — forces output to 1 channel
            monoNode = audioCtx.createChannelMerger(1);

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

            // Stereo width processor (Mid/Side)
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

            // Analyser for clipping detection
            analyserNode = audioCtx.createAnalyser();
            analyserNode.fftSize = 2048;
            analyserData = new Float32Array(analyserNode.fftSize);
            clipIndicatorEl = document.getElementById('clipIndicator');

            // Route all audio through an <audio> element via MediaStreamDestination.
            // This forces iOS into "playback" audio session — bypasses mute switch.
            mediaStreamDest = audioCtx.createMediaStreamDestination();
            outputAudioEl = new Audio();
            outputAudioEl.setAttribute('playsinline', '');
            outputAudioEl.srcObject = mediaStreamDest.stream;

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

    function updateAudioChain() {
        if (!gainNode || !audioCtx) return;

        gainNode.disconnect();
        if (fadeGainNode) fadeGainNode.disconnect();
        if (pannerNode) pannerNode.disconnect();
        eqFilters.forEach(function (f) { f.disconnect(); });
        if (distortionNode) distortionNode.disconnect();
        if (lpFilterNode) lpFilterNode.disconnect();
        if (hpFilterNode) hpFilterNode.disconnect();
        if (limiterNode) limiterNode.disconnect();
        if (monoNode) monoNode.disconnect();
        if (stereoWidthNode) stereoWidthNode.disconnect();
        if (analyserNode) analyserNode.disconnect();

        // Use mediaStreamDest if available (iOS mute-switch bypass), else fallback
        var destination = mediaStreamDest || audioCtx.destination;

        // Chain: gain → fadeGain → pan → EQ → filters → limiter → stereoWidth → mono → destination
        var lastNode = gainNode;

        if (fadeGainNode) {
            lastNode.connect(fadeGainNode);
            lastNode = fadeGainNode;
        }

        if (pannerNode) {
            pannerNode.pan.value = settings.panValue || 0;
            lastNode.connect(pannerNode);
            lastNode = pannerNode;
        }

        if (settings.eqEnabled && eqFilters.length > 0) {
            lastNode.connect(eqFilters[0]);
            for (var i = 0; i < eqFilters.length - 1; i++) {
                eqFilters[i].connect(eqFilters[i + 1]);
            }
            lastNode = eqFilters[eqFilters.length - 1];
        }

        // Distortion (only when drive > 0)
        if (distortionNode && distortionDrive > 0) {
            lastNode.connect(distortionNode);
            lastNode = distortionNode;
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
        if (stereoWidthNode && stereoWidthValue !== 1.0) {
            lastNode.connect(stereoWidthNode);
            lastNode = stereoWidthNode;
        }

        if (settings.monoEnabled && monoNode) {
            lastNode.connect(monoNode, 0, 0);
            monoNode.connect(destination);
            if (analyserNode) monoNode.connect(analyserNode);
        } else {
            lastNode.connect(destination);
            if (analyserNode) lastNode.connect(analyserNode);
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

        // Update lock screen progress bar
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            try {
                navigator.mediaSession.setPositionState({
                    duration: audioBuffer.duration,
                    playbackRate: currentRate,
                    position: Math.min(pos, audioBuffer.duration)
                });
            } catch (e) {}
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
            // Trigger next track logic (same as natural end)
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

        // Clipping detection
        if (isPlaying && analyserNode && analyserData && clipIndicatorEl) {
            analyserNode.getFloatTimeDomainData(analyserData);
            var clipping = false;
            for (var ci = 0; ci < analyserData.length; ci++) {
                if (Math.abs(analyserData[ci]) >= 1.0) { clipping = true; break; }
            }
            if (clipping) {
                clipIndicatorEl.classList.add('active');
                clearTimeout(clipHoldTimer);
                clipHoldTimer = setTimeout(function () {
                    if (clipIndicatorEl) clipIndicatorEl.classList.remove('active');
                }, 500);
            }
        }

        if (isPlaying) {
            animFrameId = requestAnimationFrame(updateSeekUI);
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
        } else {
            playIcon.innerHTML = '&#9654;';
            miniPlayerPlayIcon.innerHTML = '&#9654;';
        }
        updateMediaSessionState(playing);
    }

    // --- Media Session API (lock screen controls) ---
    function updateMediaSession(trackName, trackSub) {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: trackName,
            artist: trackSub || 'Audio Manipulator'
        });
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

                    // Update lock screen metadata
                    updateMediaSession(trackName, trackSub);

                    // Write duration back to library entry
                    if (AM.library && AM.library.updateDuration) {
                        AM.library.updateDuration(trackId, buffer.duration);
                    }

                    // Render cue points for this track
                    renderCues();

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
        } else if (abLoopState === 1) {
            // Set point B
            if (pos <= abLoopA) {
                AM.showToast('Point B must be after A');
                return;
            }
            abLoopB = pos;
            abLoopState = 2;
            abLoopLabel.childNodes[0].textContent = formatTime(abLoopA) + ' → ' + formatTime(abLoopB) + ' ';
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

    function renderPresets() {
        var presets = AM.storage.getPlaybackPresets();
        presetsListEl.innerHTML = '';
        presets.forEach(function (p, idx) {
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
                all.splice(idx, 1);
                AM.storage.savePlaybackPresets(all);
                renderPresets();
                AM.showToast('Preset deleted');
            });
            chip.appendChild(delBtn);

            chip.addEventListener('click', function () {
                applyPreset(p.data);
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
        hideMiniPlayer: function () {
            miniPlayer.classList.remove('visible');
            miniPlayerVisible = false;
        },
        formatTime: formatTime,
        EQ_FREQUENCIES: EQ_FREQUENCIES
    };
})();
