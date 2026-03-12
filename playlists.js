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
    var playlistSearch = document.getElementById('playlistSearch');

    // --- Init ---
    renderPlaylistList();

    playlistSearch.addEventListener('input', function () {
        if (currentPlaylistId) renderPlaylistInside(currentPlaylistId);
    });

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
        playlistSearch.value = '';
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
                    previewNames.push(library.getDisplayName(entry.filename, entry.id));
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

        var searchQuery = playlistSearch.value.trim().toLowerCase();

        pl.trackIds.forEach(function (trackId, index) {
            var entry = library.getEntry(trackId);
            var available = entry && library.isAvailable(trackId);

            // Filter by search query
            if (searchQuery && entry) {
                var text = (entry.filename + ' ' + (entry.relativePath || '')).toLowerCase();
                if (text.indexOf(searchQuery) === -1) return;
            }

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
                nameEl.textContent = library.getDisplayName(entry.filename, entry.id);
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
