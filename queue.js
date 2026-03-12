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
