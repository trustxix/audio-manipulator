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
├── sw.js               # Service worker (cache all new files)
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
    relativePath: string    // "Rock/song.wav"
    fileSize:     number    // bytes, used for matching
    duration:     number    // seconds, populated after first decode
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
    currentIndex: number    // index of currently playing track
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

Each save is a full overwrite of the key. Even 1000 tracks is well under iOS Safari's ~5MB localStorage limit.

The queue is not persisted — it's runtime only since audio files aren't available across sessions.

API:
- `storage.getLibrary()` / `storage.saveLibrary(entries)`
- `storage.getPlaylists()` / `storage.savePlaylists(playlists)`
- `storage.getSettings()` / `storage.saveSettings(settings)`

## File Matching on Folder Load (`library.js`)

When the user loads a folder, the app receives File objects and matches them to existing LibraryEntry records using a multi-layered approach:

```
For each .wav file in the loaded folder:
    1. Exact relativePath match → reconnect
    2. Filename match → exactly one result → reconnect
    3. Filename + fileSize match → reconnect
    4. No match → create new LibraryEntry, add to library

Unmatched LibraryEntries remain unavailable (no File in fileMap).
```

Duration is populated lazily — when a track is first decoded for playback, the duration is written back to the LibraryEntry and saved.

## Navigation

### Tab Bar (bottom, fixed)

Four tabs: Library | Playlists | Queue | Settings

- Active tab highlighted in blue (#4a9eff)
- Fixed to bottom of screen
- Each tab has its own `<div>` container; switching tabs toggles `display: none`

### Mini Player Bar (above tab bar, fixed)

- Visible when a track has been played this session
- Shows: track name, play/pause button, progress bar, current time
- Tapping the bar (not the play/pause button) opens the full Now Playing view

### Now Playing View (full-screen overlay)

- Slides up from the bottom over the current tab
- Contains all audio controls: seek bar, transport (prev/restart/play-pause/next), speed/pitch slider with semitone buttons (-12 to +12), 10-band EQ, volume (0-200%)
- Down-arrow or "Done" button at top to dismiss

## Library Tab (`library.js`)

### Layout (top to bottom)

1. **"Load Folder" button** — prominent when library is empty, smaller button in header after first load
2. **Search bar** — filters track list in real-time, matches against filename and subfolder path, case-insensitive
3. **Filter button** — next to search bar, opens filter options:
   - Availability: All / Available Only / Unavailable Only
   - Folder: dropdown of subfolder names in the library
   - Filters combine with search
4. **Sort dropdown** — A-Z, Z-A, Oldest First, Newest First
5. **Track count** — reflects filtered results (e.g., "12 of 47 tracks")
6. **Scrollable track list** — each row:
   - Track name (filename without .wav extension)
   - Subfolder path + duration (smaller, grey text)
   - "+" button — opens quick playlist picker to add track
   - "..." button — bottom sheet: Play, Play Next, Add to Queue, Remove from Library
   - Unavailable tracks: dimmed, no action buttons, "unavailable" label

### Playing from Library

Replaces the queue with all available library tracks in current sort order, starting from the tapped track. Queue source = "library".

## Playlists Tab (`playlists.js`)

### Playlist List View

1. **Header** — "Playlists" title with "+" button
2. **Playlist rows** — each shows:
   - Playlist name
   - Track count (e.g., "12 tracks")
   - Preview of first 2-3 track names (smaller, grey text)
   - "..." button — Rename, Delete, Play All

### Creating a Playlist

Tap "+" → text input appears at top of list → type name → confirm. Starts empty.

### Inside a Playlist (tap to open)

- Back button to return to playlist list
- Playlist name as header (tappable to rename)
- "Play All" and "Shuffle" buttons
- Track list: same row format as Library (name, duration, action buttons)
- "..." per track: Play, Play Next, Add to Queue, Remove from Playlist
- Drag handle on left of each row to reorder

### Playing from Playlist

Replaces queue with playlist's available tracks in playlist order. Queue source = "playlist:<id>".

### Adding Tracks (from Library "+" button)

Quick picker pops up showing playlist names → tap one → track appended. If no playlists exist, prompts to create one.

## Queue Tab (`queue.js`)

### Layout

1. **Header** — "Queue" with source indicator (e.g., "Playing from: Library" or "Playing from: My Playlist")
2. **Now playing track** — highlighted with blue left border
3. **Up next list** — remaining tracks, each with:
   - Track name, subfolder, duration
   - "..." button — Remove from Queue
   - Drag handle to reorder
4. **"Clear Queue" button** — clears everything except currently playing track

### Queue Behavior

- Playing from Library → queue = all available library tracks in sort order
- Playing from Playlist → queue = playlist's available tracks in playlist order
- "Play Next" → inserts at position 2 (after current track)
- "Add to Queue" → appends to end
- Drag reorder updates queue immediately
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
- "Clear Library" button (with confirmation prompt)
- Library stats: total tracks, available tracks, storage used

### Reset

- "Reset to Defaults" — resets settings only, preserves library/playlists
- "Reset Everything" — clears settings, library, playlists (with confirmation)

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

## UI Design

- **Style:** Dark, minimal, utilitarian (unchanged)
- **Target device:** iPhone 12 Pro Max (428 x 926 points)
- **Colors:** #0a0a0a background, #141414 card surfaces, #e0e0e0 text, #4a9eff blue accent
- **Tab bar:** #111 background, #222 top border, active tab #4a9eff, inactive #666
- **Mini player:** #1a1a1a background, #333 top border, 2px progress bar in #4a9eff

## Constraints

- PWA on iOS Safari — no persistent file access, files reconnected each session via folder load
- No Mac available — native conversion planned for later
- localStorage ~5MB limit on iOS Safari
- No external dependencies or build tools
- `webkitdirectory` for folder selection (includes subfolders)

## Future Expansion (out of scope)

- Multiband compressor
- Native iOS app conversion
- Background audio / lock screen controls (requires native)
- Cloud sync for library/playlists
- Audio file format support beyond .wav
