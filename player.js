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
        if (pannerNode) pannerNode.disconnect();
        eqFilters.forEach(function (f) { f.disconnect(); });
        if (limiterNode) limiterNode.disconnect();
        if (monoNode) monoNode.disconnect();

        // Use mediaStreamDest if available (iOS mute-switch bypass), else fallback
        var destination = mediaStreamDest || audioCtx.destination;

        // Chain: gain → pan → EQ → limiter → mono → destination
        var lastNode = gainNode;

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

        if (settings.limiterEnabled && limiterNode) {
            limiterNode.threshold.value = settings.limiterCeiling;
            lastNode.connect(limiterNode);
            lastNode = limiterNode;
        }

        if (settings.monoEnabled && monoNode) {
            lastNode.connect(monoNode, 0, 0);
            monoNode.connect(destination);
        } else {
            lastNode.connect(destination);
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
