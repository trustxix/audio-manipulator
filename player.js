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
        eqFilters.forEach(function (f) { f.disconnect(); });
        if (limiterNode) limiterNode.disconnect();

        // Use mediaStreamDest if available (iOS mute-switch bypass), else fallback
        var destination = mediaStreamDest || audioCtx.destination;

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
            limiterNode.connect(destination);
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
                if (AM.queue && AM.queue.hasPrev()) {
                    AM.queue.playPrev();
                } else if (audioBuffer) {
                    var wasPlaying = isPlaying;
                    stopPlayback();
                    bufferOffset = 0;
                    if (wasPlaying) startPlayback();
                }
            });
        } catch (e) {}
    }

    setupMediaSessionHandlers();

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

    // Restart track from beginning
    restartBtn.addEventListener('click', function () {
        if (!audioBuffer) return;
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
        if (AM.queue && AM.queue.hasPrev()) {
            AM.queue.playPrev();
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
