# Audio Manipulator — Music Manager Design Spec

## Overview

Expand the Audio Manipulator PWA from a single-folder player into a unified music manager with a persistent library, user-created playlists, a playback queue, and tab-based navigation. All existing audio manipulation features (speed/pitch, EQ, limiter, volume boost) are preserved.

## Problem

The current app loads one folder per session with no memory of previous files. There's no way to organize tracks into playlists, manage a play queue, or browse a persistent library. Each session starts from scratch.

## Solution

A tab-based music manager with four views (Library, Playlists, Queue, Settings), a persistent mini player, and an expandable full Now Playing screen. The library persists metadata across sessions via localStorage; actual audio files are reconnected each session via folder loading with multi-layered file matching.

## Architecture

### File Structure

```
audio-manipulator/
├── index.html          # App shell: tab bar, mini player, Now Playing overlay, view containers
├── styles.css          # All styles
├── player.js           # Audio engine, Now Playing UI, mini player
├── library.js          # Library data model, file matching, Library tab UI
├── playlists.js        # Playlist CRUD, Playlists tab UI
├── queue.js            # Queue management, Queue tab UI
├── settings.js         # Settings tab UI
├── storage.js          # localStorage abstraction
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (caches app shell files only; bumped on each deploy)
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

### Audio Pipeline (unchanged)

```
AudioBufferSourceNode (playbackRate)
  → GainNode (volume, 0-200%)
  → BiquadFilterNode x10 (EQ bands)
  → DynamicsCompressorNode (limiter)
  → AudioContext.destination
```

## Data Model

### LibraryEntry

```
{
    id:           string    // crypto.randomUUID()
    filename:     string    // "song.wav"
    relativePath: string    // "Rock/song.wav" (empty string if webkitRelativePath unavailable)
    fileSize:     number    // bytes, used for matching
    duration:     number    // seconds, 0 if not yet decoded
    dateAdded:    number    // timestamp when first seen
    lastPlayed:   number    // timestamp, 0 if never played
}
```

### Playlist

```
{
    id:       string    // crypto.randomUUID()
    name:     string    // user-defined
    trackIds: string[]  // ordered list of LibraryEntry IDs
    created:  number    // timestamp
}
```

### QueueState (runtime only, not persisted)

```
{
    trackIds:     string[]  // ordered list of LibraryEntry IDs
    currentIndex: number    // index of currently playing track (-1 if empty)
    source:       string    // "library", "playlist:<id>", or "manual"
}
```

### Runtime File Map

A `Map<string, File>` mapping LibraryEntry IDs to actual File objects. Populated on folder load, cleared on app close. A track is "available" if its ID exists in this map.

## Storage Layer (`storage.js`)

All persistence through localStorage with `am-` prefixed keys:

- `am-library` — Array of LibraryEntry objects
- `am-playlists` — Array of Playlist objects
- `am-settings` — Settings object

Each save is a full overwrite of the key. Estimated storage: ~300 bytes per LibraryEntry, ~100 bytes per playlist track reference. 1000 tracks + 10 playlists ≈ ~350 KB, well under iOS Safari's ~5MB limit. All `setItem` calls should be wrapped in try/catch to handle `QuotaExceededError` — on failure, show a brief warning but don't crash.

The queue is not persisted — it's runtime only since audio files aren't available across sessions.

API:
- `storage.getLibrary()` / `storage.saveLibrary(entries)`
- `storage.getPlaylists()` / `storage.savePlaylists(playlists)`
- `storage.getSettings()` / `storage.saveSettings(settings)`

## File Matching on Folder Load (`library.js`)

When the user loads a folder, the app receives File objects and matches them to existing LibraryEntry records using a multi-layered approach:

```
For each .wav file in the loaded folder:
    1. Exact relativePath match (skip if relativePath is empty) → reconnect
    2. Filename + fileSize match → exactly one library entry matching both → reconnect
    3. Filename match (any size) → exactly one library entry with that filename → reconnect
    4. If steps 2-3 produce multiple matches, skip (leave ambiguous entries unmatched)
    5. No match → create new LibraryEntry, add to library

Unmatched LibraryEntries remain unavailable (no File in fileMap).
```

Step 2 now checks filename + fileSize first (strongest signal after exact path), preventing wrong-file reconnections when a file with the same name has changed.

If `webkitRelativePath` is not available (older iOS versions), step 1 is skipped and matching falls through to filename-based steps. The `relativePath` field stores an empty string in this case.

Duration is populated lazily — when a track is first decoded for playback, the duration is written back to the LibraryEntry and saved.

## Navigation

### Tab Bar (bottom, fixed)

Four tabs: Library | Playlists | Queue | Settings

- Active tab highlighted in blue (#4a9eff)
- Fixed to bottom of screen
- Each tab has its own `<div>` container; switching tabs toggles `display: none`

### Mini Player Bar (above tab bar, fixed)

- Hidden on app launch. Becomes visible once audio playback has successfully started (i.e., AudioContext is running and a source node is playing — not just when a track is queued)
- Shows: track name, play/pause button, progress bar, current time
- Tapping the bar (not the play/pause button) opens the full Now Playing view
- Remains visible after pausing (hides only on app restart or queue clear with nothing playing)

### Now Playing View (full-screen overlay)

- Slides up from the bottom over the current tab
- Contains all audio controls: seek bar, transport (prev/restart/play-pause/next), speed/pitch slider with semitone buttons (-12 to +12), 10-band EQ, volume (0-200%)
- Down-arrow or "Done" button at top to dismiss

### Prev/Restart Transport Button Behavior

- If current playback position is **more than 3 seconds** into the track: restart the current track from the beginning
- If current playback position is **3 seconds or less** into the track: go to previous track in queue
- If already at the first track in queue and ≤3 seconds in: restart from beginning

## Library Tab (`library.js`)

### Empty State

When the library has no entries, show a centered message: "No tracks yet" with a prominent "Load Folder" button below it. No search, filter, or sort controls shown in empty state.

### Layout (top to bottom, when library has entries)

1. **"Load Folder" button** — smaller button in the top-right header area
2. **Search bar** — filters track list in real-time, matches against filename and subfolder path, case-insensitive
3. **Filter button** — next to search bar, opens filter options:
   - Availability: All / Available Only / Unavailable Only
   - Folder: dropdown of subfolder names in the library
   - Filters combine with search
4. **Sort dropdown** — A-Z, Z-A, Oldest First, Newest First (stored in Settings as `sortOrder`)
5. **Track count** — reflects filtered results (e.g., "12 of 47 tracks")
6. **Scrollable track list** — each row:
   - Track name (filename without .wav extension)
   - Subfolder path + duration (smaller, grey text; shows "—" if duration not yet known)
   - "+" button — opens quick playlist picker to add track
   - "..." button — bottom sheet: Play Next, Add to Queue, Remove from Library (removing a track also removes it from the current queue if present; playlists retain the track ID but show it as "removed")
   - Unavailable tracks: dimmed, no action buttons, "unavailable" label

### Playing from Library

Tapping a track row plays it: replaces the queue with all available library tracks matching the current search/filter in current sort order, starting from the tapped track. Begins playback immediately (interrupts current playback if any). Queue source = "library". If no tracks are available (folder not loaded), tapping is disabled and a prompt suggests loading a folder.

## Playlists Tab (`playlists.js`)

### Playlist List View

1. **Header** — "Playlists" title with "+" button
2. **Playlist rows** — each shows:
   - Playlist name
   - Track count (e.g., "12 tracks") — counts only tracks whose IDs still exist in the library; silently skips removed IDs
   - Preview of first 2-3 track names (smaller, grey text)
   - "..." button — Rename, Delete, Play All

### Creating a Playlist

Tap "+" → text input appears at top of list → type name → confirm. Starts empty.

### Inside a Playlist (tap to open)

- Back button to return to playlist list
- Playlist name as header (tappable to rename)
- "Play All" and "Shuffle" buttons
- Track list: same row format as Library (name, duration, action buttons)
- "..." per track: Play Next, Add to Queue, Remove from Playlist
- Drag handle on left of each row to reorder
- Tracks whose library entries no longer exist are shown dimmed with "removed" label and can be cleaned up via "..." → Remove from Playlist

### Playing from Playlist

**"Play All"**: Replaces queue with playlist's available tracks in playlist order, starting from track 1. Begins playback immediately (interrupts current playback if any). Queue source = "playlist:\<id\>".

**"Shuffle"**: Replaces queue with playlist's available tracks in a Fisher-Yates randomized order and begins playback immediately (interrupts current playback if any). Queue source = "playlist:\<id\>". The shuffle is a one-time randomization of the queue — it does not set a persistent shuffle mode.

**Tapping a track row**: Replaces queue with playlist's available tracks in playlist order, starting from the tapped track. Queue source = "playlist:\<id\>".

### Adding Tracks (from Library "+" button)

Quick picker pops up showing playlist names → tap one → track appended. If no playlists exist, prompts to create one.

## Queue Tab (`queue.js`)

### Empty State

When the queue is empty (no tracks have been played this session), show a centered message: "Queue is empty — play a track from Library or a Playlist to start."

### Layout (when queue has tracks)

1. **Header** — "Queue" with source indicator (e.g., "Playing from: Library" or "Playing from: My Playlist")
2. **Now playing track** — highlighted with blue left border
3. **Up next list** — remaining tracks, each with:
   - Track name, subfolder, duration
   - "..." button — Remove from Queue
   - Drag handle to reorder
4. **"Clear Queue" button** — clears all tracks after the currently playing one. "Currently playing" includes paused state (a track is loaded and can be resumed). If no track is loaded at all (`currentIndex === -1`), clears the entire queue. Button is hidden when queue is empty.

### Queue Behavior

- Playing from Library → queue = all available library tracks in sort order
- Playing from Playlist → queue = playlist's available tracks in playlist order
- "Play Next" → inserts at position after current track (position 2 if something is playing)
- "Add to Queue" → appends to end
- Drag reorder updates queue immediately; `currentIndex` follows the currently-playing track (if the playing track is dragged, the index updates to its new position)
- Autoplay setting controls auto-advance within the queue; when queue ends, playback stops

## Settings Tab (`settings.js`)

### Playback

- Autoplay toggle (default: ON)

### Equalizer

- EQ enable/disable toggle (default: ON)

### Audio Safety

- Limiter toggle (default: ON)
- Limiter Ceiling slider (-6 to 0 dB, default: -1 dB)
- Volume Boost Warning toggle (default: ON)

### Library

- "Load Folder" button (secondary access)
- "Clear Library" button — with confirmation prompt. Clears all library entries and the runtime file map. Playlists are preserved but their track references become orphaned (shown as "removed" in playlist view, can be cleaned up individually).
- Library stats: total tracks, available tracks, storage used

### Reset

- "Reset to Defaults" — resets settings only, preserves library/playlists
- "Reset Everything" — clears settings, library, and playlists (with confirmation)

## Settings Object

```
{
    autoplay:        true,
    sortOrder:       'az',
    limiterEnabled:  true,
    limiterCeiling:  -1,
    boostWarning:    true,
    eqEnabled:       true,
    eqBands:         [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

`sortOrder` is stored in Settings for persistence across sessions but is controlled from the Library tab's sort dropdown — it does not appear in the Settings tab UI.

## UI Design

- **Style:** Dark, minimal, utilitarian (unchanged)
- **Target device:** iPhone 12 Pro Max (428 x 926 points)
- **Colors:** #0a0a0a background, #141414 card surfaces, #e0e0e0 text, #4a9eff blue accent
- **Tab bar:** #111 background, #222 top border, active tab #4a9eff, inactive #666
- **Mini player:** #1a1a1a background, #333 top border, 2px progress bar in #4a9eff

## Constraints

- PWA on iOS Safari 15.4+ — no persistent file access, files reconnected each session via folder load
- `webkitdirectory` for folder selection (includes subfolders); `webkitRelativePath` may be empty on older iOS — matching falls back to filename-based steps
- No Mac available — native conversion planned for later
- localStorage ~5MB limit on iOS Safari; all writes wrapped in try/catch for QuotaExceededError
- No external dependencies or build tools

## Future Expansion (out of scope)

- Multiband compressor
- Native iOS app conversion
- Background audio / lock screen controls (requires native)
- Cloud sync for library/playlists
- Audio file format support beyond .wav
