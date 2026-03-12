// library.js — Library data model, file matching, Library tab UI
(function () {
    'use strict';

    var AM = window.AM = window.AM || {};
    var storage = AM.storage;

    // --- Runtime state ---
    var libraryEntries = storage.getLibrary(); // Array of LibraryEntry objects
    var fileMap = new Map(); // Map<entryId, File>
    var settings = AM.player.getSettings();

    // --- DOM refs ---
    var fileInput = document.getElementById('fileInput');
    var libraryEmpty = document.getElementById('libraryEmpty');
    var libraryContent = document.getElementById('libraryContent');
    var libraryLoadBtn = document.getElementById('libraryLoadBtn');
    var libraryLoadBtnLarge = document.getElementById('libraryLoadBtnLarge');
    var librarySearch = document.getElementById('librarySearch');
    var filterToggleBtn = document.getElementById('filterToggleBtn');
    var filterPopover = document.getElementById('filterPopover');
    var filterFolder = document.getElementById('filterFolder');
    var sortSelect = document.getElementById('sortSelect');
    var trackCountLabel = document.getElementById('trackCountLabel');
    var libraryTrackList = document.getElementById('libraryTrackList');

    // Filter state
    var currentAvailFilter = 'all';
    var currentFolderFilter = '';

    // --- Init UI state ---
    sortSelect.value = settings.sortOrder;
    updateLibraryUI();

    // --- File input triggers ---
    function triggerFileInput() {
        fileInput.click();
    }

    libraryLoadBtnLarge.addEventListener('click', triggerFileInput);
    libraryLoadBtn.addEventListener('click', triggerFileInput);

    // --- Folder load ---
    fileInput.addEventListener('change', function (e) {
        var SUPPORTED_EXT = /\.(wav|mp3|flac|ogg|aac|m4a|opus|wma|aiff|aif)$/i;
        var files = Array.from(e.target.files).filter(function (f) {
            return SUPPORTED_EXT.test(f.name);
        });

        if (files.length === 0) {
            AM.showToast('No supported audio files found');
            return;
        }

        matchAndMerge(files);
        storage.saveLibrary(libraryEntries);
        updateLibraryUI();
        AM.showToast(files.length + ' file(s) loaded');

        // Reset the input so the same folder can be re-selected
        fileInput.value = '';
    });

    // --- Multi-layer file matching ---
    function matchAndMerge(files) {
        var matched = new Set(); // entry IDs that got matched

        files.forEach(function (file) {
            var relPath = file.webkitRelativePath || '';
            // Strip the root folder name from relativePath to get subfolder path
            var pathParts = relPath.split('/');
            var cleanPath = pathParts.length > 1 ? pathParts.slice(1).join('/') : '';
            var matchedEntry = null;

            // Step 1: Exact relativePath match
            if (cleanPath) {
                for (var i = 0; i < libraryEntries.length; i++) {
                    var entry = libraryEntries[i];
                    if (!matched.has(entry.id) && entry.relativePath === cleanPath) {
                        matchedEntry = entry;
                        break;
                    }
                }
            }

            // Step 2: Filename + fileSize match
            if (!matchedEntry) {
                var candidates = libraryEntries.filter(function (entry) {
                    return !matched.has(entry.id) && entry.filename === file.name && entry.fileSize === file.size;
                });
                if (candidates.length === 1) {
                    matchedEntry = candidates[0];
                }
            }

            // Step 3: Filename match (any size)
            if (!matchedEntry) {
                var candidates2 = libraryEntries.filter(function (entry) {
                    return !matched.has(entry.id) && entry.filename === file.name;
                });
                if (candidates2.length === 1) {
                    matchedEntry = candidates2[0];
                }
                // Step 4: Multiple matches = ambiguous, skip
            }

            if (matchedEntry) {
                // Reconnect: update file map and possibly update relativePath/fileSize
                matched.add(matchedEntry.id);
                fileMap.set(matchedEntry.id, file);
                if (cleanPath && !matchedEntry.relativePath) {
                    matchedEntry.relativePath = cleanPath;
                }
                matchedEntry.fileSize = file.size;
            } else {
                // Step 5: New entry
                var newEntry = {
                    id: crypto.randomUUID(),
                    filename: file.name,
                    relativePath: cleanPath,
                    fileSize: file.size,
                    duration: 0,
                    dateAdded: Date.now(),
                    lastPlayed: 0
                };
                libraryEntries.push(newEntry);
                fileMap.set(newEntry.id, file);
            }
        });
    }

    // --- Sort ---
    function sortEntries(entries, order) {
        var sorted = entries.slice();
        switch (order) {
            case 'az':
                sorted.sort(function (a, b) { return a.filename.localeCompare(b.filename); });
                break;
            case 'za':
                sorted.sort(function (a, b) { return b.filename.localeCompare(a.filename); });
                break;
            case 'oldest':
                sorted.sort(function (a, b) { return a.dateAdded - b.dateAdded; });
                break;
            case 'newest':
                sorted.sort(function (a, b) { return b.dateAdded - a.dateAdded; });
                break;
        }
        return sorted;
    }

    sortSelect.addEventListener('change', function () {
        settings.sortOrder = sortSelect.value;
        AM.storage.saveSettings(settings);
        renderTrackList();
    });

    // --- Search ---
    librarySearch.addEventListener('input', function () {
        renderTrackList();
    });

    // --- Filter ---
    filterToggleBtn.addEventListener('click', function () {
        filterPopover.classList.toggle('open');
        filterToggleBtn.classList.toggle('active-filter',
            currentAvailFilter !== 'all' || currentFolderFilter !== '');
    });

    document.getElementById('filterAvailability').addEventListener('click', function (e) {
        var option = e.target.closest('.filter-option');
        if (!option) return;
        document.querySelectorAll('#filterAvailability .filter-option').forEach(function (o) {
            o.classList.remove('selected');
        });
        option.classList.add('selected');
        currentAvailFilter = option.dataset.value;
        filterToggleBtn.classList.toggle('active-filter',
            currentAvailFilter !== 'all' || currentFolderFilter !== '');
        renderTrackList();
    });

    filterFolder.addEventListener('change', function () {
        currentFolderFilter = filterFolder.value;
        filterToggleBtn.classList.toggle('active-filter',
            currentAvailFilter !== 'all' || currentFolderFilter !== '');
        renderTrackList();
    });

    // --- Get filtered & sorted entries ---
    function getFilteredEntries() {
        var query = librarySearch.value.trim().toLowerCase();
        var filtered = libraryEntries.filter(function (entry) {
            // Search filter
            if (query) {
                var searchText = (entry.filename + ' ' + entry.relativePath).toLowerCase();
                if (searchText.indexOf(query) === -1) return false;
            }
            // Availability filter
            var available = fileMap.has(entry.id);
            if (currentAvailFilter === 'available' && !available) return false;
            if (currentAvailFilter === 'unavailable' && available) return false;
            // Folder filter
            if (currentFolderFilter) {
                var subfolder = getSubfolder(entry.relativePath);
                if (subfolder !== currentFolderFilter) return false;
            }
            return true;
        });
        return sortEntries(filtered, settings.sortOrder);
    }

    function getSubfolder(relativePath) {
        if (!relativePath) return '';
        var parts = relativePath.split('/');
        return parts.length > 1 ? parts[0] : '';
    }

    function getDisplayName(filename) {
        return filename.replace(/\.(wav|mp3|flac|ogg|aac|m4a|opus|wma|aiff|aif)$/i, '');
    }

    function formatDuration(seconds) {
        if (!seconds || seconds === 0) return '\u2014';
        return AM.player.formatTime(seconds);
    }

    // --- Build folder filter options ---
    function updateFolderFilter() {
        var folders = new Set();
        libraryEntries.forEach(function (entry) {
            var subfolder = getSubfolder(entry.relativePath);
            if (subfolder) folders.add(subfolder);
        });
        filterFolder.innerHTML = '<option value="">All Folders</option>';
        Array.from(folders).sort().forEach(function (folder) {
            var opt = document.createElement('option');
            opt.value = folder;
            opt.textContent = folder;
            filterFolder.appendChild(opt);
        });
        filterFolder.value = currentFolderFilter;
    }

    // --- Render ---
    function updateLibraryUI() {
        if (libraryEntries.length === 0) {
            libraryEmpty.style.display = '';
            libraryContent.style.display = 'none';
            libraryLoadBtn.style.display = 'none';
        } else {
            libraryEmpty.style.display = 'none';
            libraryContent.style.display = '';
            libraryLoadBtn.style.display = '';
            updateFolderFilter();
            renderTrackList();
        }
    }

    function renderTrackList() {
        var filtered = getFilteredEntries();
        trackCountLabel.textContent = filtered.length + ' of ' + libraryEntries.length + ' tracks';

        libraryTrackList.innerHTML = '';

        filtered.forEach(function (entry) {
            var available = fileMap.has(entry.id);
            var li = document.createElement('li');
            li.className = 'track-row' + (available ? '' : ' unavailable');

            var currentId = AM.player.getCurrentTrackId();
            if (entry.id === currentId) {
                li.classList.add('now-playing-row');
            }

            var info = document.createElement('div');
            info.className = 'track-info';

            var name = document.createElement('div');
            name.className = 'track-name';
            name.textContent = getDisplayName(entry.filename);

            var meta = document.createElement('div');
            meta.className = 'track-meta';
            var subPath = getSubfolder(entry.relativePath);
            meta.textContent = (subPath ? subPath + ' \u00B7 ' : '') + formatDuration(entry.duration);

            info.appendChild(name);
            info.appendChild(meta);

            li.appendChild(info);

            if (available) {
                var actions = document.createElement('div');
                actions.className = 'track-actions';

                // Add to playlist button
                var addBtn = document.createElement('button');
                addBtn.className = 'track-action-btn';
                addBtn.innerHTML = '+';
                addBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    AM.openPlaylistPicker(entry.id);
                });

                // More button
                var moreBtn = document.createElement('button');
                moreBtn.className = 'track-action-btn';
                moreBtn.innerHTML = '\u22EF';
                moreBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    AM.openBottomSheet(getDisplayName(entry.filename), [
                        {
                            icon: '\u23ED',
                            label: 'Play Next',
                            action: function () {
                                if (AM.queue) AM.queue.insertNext(entry.id);
                                AM.showToast('Playing next');
                            }
                        },
                        {
                            icon: '\u2795',
                            label: 'Add to Queue',
                            action: function () {
                                if (AM.queue) AM.queue.addToEnd(entry.id);
                                AM.showToast('Added to queue');
                            }
                        },
                        {
                            icon: '\u2716',
                            label: 'Remove from Library',
                            danger: true,
                            action: function () {
                                removeEntry(entry.id);
                            }
                        }
                    ]);
                });

                actions.appendChild(addBtn);
                actions.appendChild(moreBtn);
                li.appendChild(actions);

                // Tap to play
                li.addEventListener('click', function () {
                    playFromLibrary(entry.id);
                });
            } else {
                var badge = document.createElement('span');
                badge.className = 'unavailable-label';
                badge.textContent = 'unavailable';
                li.appendChild(badge);
            }

            libraryTrackList.appendChild(li);
        });
    }

    // --- Play from library ---
    function playFromLibrary(entryId) {
        var filtered = getFilteredEntries().filter(function (e) { return fileMap.has(e.id); });
        if (filtered.length === 0) return;

        var trackIds = filtered.map(function (e) { return e.id; });
        var startIndex = trackIds.indexOf(entryId);
        if (startIndex === -1) startIndex = 0;

        if (AM.queue) {
            AM.queue.setQueue(trackIds, startIndex, 'library');
        }
    }

    // --- Remove entry ---
    function removeEntry(entryId) {
        libraryEntries = libraryEntries.filter(function (e) { return e.id !== entryId; });
        fileMap.delete(entryId);
        storage.saveLibrary(libraryEntries);
        if (AM.queue) AM.queue.removeTrackId(entryId);
        updateLibraryUI();
    }

    // --- Update duration (called by player after decode) ---
    function updateDuration(entryId, duration) {
        for (var i = 0; i < libraryEntries.length; i++) {
            if (libraryEntries[i].id === entryId) {
                if (libraryEntries[i].duration === 0) {
                    libraryEntries[i].duration = duration;
                    storage.saveLibrary(libraryEntries);
                }
                break;
            }
        }
    }

    // --- Update lastPlayed ---
    function markPlayed(entryId) {
        for (var i = 0; i < libraryEntries.length; i++) {
            if (libraryEntries[i].id === entryId) {
                libraryEntries[i].lastPlayed = Date.now();
                storage.saveLibrary(libraryEntries);
                break;
            }
        }
    }

    // --- Public API ---
    AM.library = {
        getEntries: function () { return libraryEntries; },
        getFileMap: function () { return fileMap; },
        getEntry: function (id) {
            return libraryEntries.find(function (e) { return e.id === id; });
        },
        getFile: function (id) {
            return fileMap.get(id);
        },
        isAvailable: function (id) {
            return fileMap.has(id);
        },
        getDisplayName: getDisplayName,
        formatDuration: formatDuration,
        getSubfolder: getSubfolder,
        updateDuration: updateDuration,
        markPlayed: markPlayed,
        triggerFileInput: triggerFileInput,
        refresh: updateLibraryUI,
        clearLibrary: function () {
            libraryEntries = [];
            fileMap.clear();
            storage.clearLibrary();
            updateLibraryUI();
        }
    };
})();
