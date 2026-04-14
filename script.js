// ══════════════════════════════════════════════════════════════════════════════
// ─── ES6 CLASSES ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

class Song {
  constructor({ title, artist, url, cover = "", file = null, type = "local", videoId = "", thumb = "" }) {
    this.title   = title  || "Unknown Title";
    this.artist  = artist || "Unknown Artist";
    this.url     = url    || "";
    this.cover   = cover;
    this.file    = file;
    this.type    = type;
    this.videoId = videoId;
    this.thumb   = thumb;
    this.addedAt = Date.now();
  }
  getDisplayTitle()  { return this.title; }
  getDisplayArtist() { return this.artist; }
  isLocal()     { return this.type === "local"; }
  isYouTube()   { return this.type === "yt"; }
}

class Playlist {
  constructor(name, icon = "🎵") {
    this.name      = name;
    this.icon      = icon;
    this.tracks    = [];
    this.createdAt = Date.now();
  }
  addTrack(track) {
    const dup = this.tracks.some(t =>
      (t.type === "yt"    && t.videoId === track.videoId) ||
      (t.type === "local" && t.index   === track.index)
    );
    if (!dup) this.tracks.push(track);
  }
  removeTrack(pos) { this.tracks.splice(pos, 1); }
  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }
  sortByTitle()  { this.tracks.sort((a, b) => (a.title  || "").localeCompare(b.title  || "")); }
  sortByArtist() { this.tracks.sort((a, b) => (a.artist || "").localeCompare(b.artist || "")); }
  get length()   { return this.tracks.length; }
}

class User {
  constructor(name = "Guest") {
    this.name      = name;
    this.library   = [];   // Song instances
    this.playlists = {};   // { [name]: Playlist }
    this.history   = [];
  }
  addSong(song) {
    if (!(song instanceof Song)) throw new Error("Must be a Song instance");
    this.library.push(song);
  }
  removeSong(index) { this.library.splice(index, 1); }
  addPlaylist(pl) {
    if (!(pl instanceof Playlist)) throw new Error("Must be a Playlist instance");
    this.playlists[pl.name] = pl;
  }
  getSortedLibrary(by = "recent") {
    const copy = [...this.library];
    if (by === "title")  return copy.sort((a, b) => a.title.localeCompare(b.title));
    if (by === "artist") return copy.sort((a, b) => a.artist.localeCompare(b.artist));
    return copy; // "recent" = insertion order
  }
  addToHistory(title) {
    this.history.unshift(title);
    if (this.history.length > 50) this.history.pop();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ─── GLOBAL INSTANCE
// ══════════════════════════════════════════════════════════════════════════════

const currentUser = new User("Guest");

// Transparent aliases so all existing code using `songs` / `playlists` still works
Object.defineProperty(window, "songs",     { get: () => currentUser.library });
Object.defineProperty(window, "playlists", { get: () => currentUser.playlists });

// ─── YouTube IFrame Player ────────────────────────────────────────────────────
let ytPlayer = null;
let ytReady = false;
let ytMode = false;
let ytProgressInterval = null;

(function () {
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
})();

window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player("yt-player", {
    height: "1", width: "1",
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, rel: 0 },
    events: {
      onReady: () => { ytReady = true; },
      onStateChange: onYTStateChange,
    },
  });
};

function onYTStateChange(event) {
  if (!ytMode) return;
  if (event.data === YT.PlayerState.PLAYING) { setPlaying(); startYTProgress(); }
  else if (event.data === YT.PlayerState.PAUSED) { setPaused(); stopYTProgress(); }
  else if (event.data === YT.PlayerState.ENDED) { stopYTProgress(); nextSong(); }
}

function startYTProgress() {
  stopYTProgress();
  ytProgressInterval = setInterval(() => {
    if (!ytPlayer || !ytMode) return;
    const cur = ytPlayer.getCurrentTime?.() || 0;
    const dur = ytPlayer.getDuration?.() || 0;
    if (dur) {
      const pct = (cur / dur) * 100;
      progress.style.width = pct + "%";
      progressThumb.style.left = `calc(${pct}% - 5px)`;
      currentTimeEl.textContent = formatTime(cur);
      durationEl.textContent = formatTime(dur);
    }
  }, 500);
}

function stopYTProgress() {
  if (ytProgressInterval) { clearInterval(ytProgressInterval); ytProgressInterval = null; }
}

function playYouTubeVideo(videoId, title, artist, thumb) {
  if (!ytReady || !ytPlayer) { showToast("Player not ready yet, try again!"); return; }
  ytMode = true;
  audio.pause();
  titleEl.textContent = title;
  artistEl.textContent = artist;
  if (thumb) {
    thumbnail.src = thumb;
    thumbnail.classList.add("visible");
    thumbPlaceholder.style.display = "none";
  } else {
    thumbnail.classList.remove("visible");
    thumbPlaceholder.style.display = "";
  }
  progress.style.width = "0%";
  currentTimeEl.textContent = "0:00";
  durationEl.textContent = "0:00";
  ytPlayer.loadVideoById(videoId);
  setPlaying();
  currentUser.addToHistory(title);
  updateSongList();
}

// ─── YouTube Search (shared) ──────────────────────────────────────────────────
async function searchYouTube(query) {
  try {
    const res = await fetch(`/yt/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    return data.items || [];
  } catch (e) { console.error("YT search error", e); return []; }
}

// ─── Top bar Search UI ────────────────────────────────────────────────────────
let searchTimeout = null;
const searchInput = document.getElementById("search-input");
const searchDropdown = document.getElementById("search-dropdown");

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim();
  clearTimeout(searchTimeout);
  if (!q) { searchDropdown.classList.remove("visible"); return; }

  const local = songs.map((s, i) => ({ ...s, i })).filter(s =>
    s.title.toLowerCase().includes(q.toLowerCase()) ||
    s.artist.toLowerCase().includes(q.toLowerCase())
  ).slice(0, 3);

  renderSearchResults(local, []);

  searchTimeout = setTimeout(async () => {
    const ytResults = await searchYouTube(q + " official audio");
    renderSearchResults(local, ytResults);
  }, 500);
});

function renderSearchResults(localResults, ytResults) {
  const localHTML = localResults.map(s => `
    <div class="search-result-item local-result" data-index="${s.i}">
      <span class="sr-badge local-badge">Local</span>
      <div class="sr-info">
        <div class="sr-title">${s.title}</div>
        <div class="sr-artist">${s.artist}</div>
      </div>
    </div>`).join("");

  const ytHTML = ytResults.map(v => {
    const thumb = v.snippet.thumbnails?.default?.url || "";
    const title = v.snippet.title.replace(/"/g, "&quot;");
    const channel = v.snippet.channelTitle.replace(/"/g, "&quot;");
    const videoId = v.id.videoId;
    return `
      <div class="search-result-item yt-result"
        data-videoid="${videoId}" data-title="${title}"
        data-artist="${channel}" data-thumb="${thumb}">
        ${thumb ? `<img src="${thumb}" class="sr-album-art"/>` : '<span class="sr-badge yt-badge">YT</span>'}
        <div class="sr-info">
          <div class="sr-title">${v.snippet.title}</div>
          <div class="sr-artist">${v.snippet.channelTitle}</div>
        </div>
      </div>`;
  }).join("");

  const divider = ytResults.length ? `<div class="sr-divider">YouTube</div>` : "";
  searchDropdown.innerHTML = localHTML + divider + ytHTML;
  searchDropdown.classList.toggle("visible", !!(localHTML || ytHTML));
}

searchDropdown.addEventListener("click", (e) => {
  const item = e.target.closest(".search-result-item");
  if (!item) return;
  if (item.classList.contains("local-result")) {
    const idx = parseInt(item.dataset.index);
    ytMode = false; stopYTProgress();
    if (ytPlayer && ytReady) ytPlayer.stopVideo();
    currentPlaylist = null;
    loadSong(idx); audio.play(); setPlaying();
    document.getElementById("library-panel").classList.add("open");
  } else if (item.classList.contains("yt-result")) {
    const { videoid, title, artist, thumb } = item.dataset;
    currentPlaylist = null;
    playYouTubeVideo(videoid, title, artist, thumb);
    showToast(`▶ Playing: ${title}`);
  }
  searchInput.value = "";
  searchDropdown.classList.remove("visible");
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) searchDropdown.classList.remove("visible");
});

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const audio = document.getElementById("audio");
const titleEl = document.getElementById("song-title");
const artistEl = document.getElementById("song-artist");
const thumbnail = document.getElementById("song-thumbnail");
const thumbPlaceholder = document.getElementById("thumb-placeholder");
const progress = document.getElementById("progress");
const progressThumb = document.getElementById("progress-thumb");
const progressBar = document.getElementById("progress-bar");
const currentTimeEl = document.getElementById("current-time");
const durationEl = document.getElementById("duration");
const volumeSlider = document.getElementById("volume");
const playBtn = document.getElementById("play");

// ─── State ────────────────────────────────────────────────────────────────────
let currentPlaylist = null;
let currentPlaylistPos = 0;
let songIndex = 0;
let isShuffled = false;
let isRepeat = false;
let shuffleOrder = [];
let librarySortOrder = "recent";

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

// ─── Load local song ──────────────────────────────────────────────────────────
function loadSong(index) {
  if (!songs.length) return;
  ytMode = false; stopYTProgress();
  if (ytPlayer && ytReady) ytPlayer.stopVideo();
  songIndex = index;
  const song = songs[songIndex];
  audio.src = song.url;
  titleEl.textContent = song.title || song.name;
  artistEl.textContent = song.artist || "Unknown Artist";
  if (song.cover) {
    thumbnail.src = song.cover;
    thumbnail.classList.add("visible");
    thumbPlaceholder.style.display = "none";
  } else {
    thumbnail.classList.remove("visible");
    thumbPlaceholder.style.display = "";
  }
  progress.style.width = "0%";
  currentTimeEl.textContent = "0:00";
  durationEl.textContent = "0:00";
  currentUser.addToHistory(song.title);
  updateSongList();
}

// ─── Read ID3 tags ────────────────────────────────────────────────────────────
function readTags(file, url) {
  return new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess(tag) {
        const tags = tag.tags;
        let cover = "";
        if (tags.picture) {
          let b64 = "";
          for (let i = 0; i < tags.picture.data.length; i++)
            b64 += String.fromCharCode(tags.picture.data[i]);
          cover = `data:${tags.picture.format};base64,${btoa(b64)}`;
        }
        resolve(new Song({ title: tags.title || file.name.replace(/\.[^.]+$/, ""), artist: tags.artist || "Unknown Artist", url, cover, file }));
      },
      onError() {
        resolve(new Song({ title: file.name.replace(/\.[^.]+$/, ""), artist: "Unknown Artist", url, cover: "", file }));
      },
    });
  });
}

// ─── Upload ───────────────────────────────────────────────────────────────────
document.getElementById("upload-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  const wasEmpty = songs.length === 0;
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const song = await readTags(file, url);
    currentUser.addSong(song);
  }
  if (wasEmpty && songs.length) loadSong(0);
  updateSongList();
  showToast(`Added ${files.length} song${files.length > 1 ? "s" : ""}!`);
  addAIMessage(`🎵 Added ${files.length} local song(s)!`);
  e.target.value = "";
});

// ─── Playback controls ────────────────────────────────────────────────────────
function setPlaying() { playBtn.textContent = "⏸"; }
function setPaused()   { playBtn.textContent = "▶"; }

playBtn.addEventListener("click", () => {
  if (ytMode && ytPlayer && ytReady) {
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) { ytPlayer.pauseVideo(); setPaused(); }
    else { ytPlayer.playVideo(); setPlaying(); }
    return;
  }
  if (!songs.length) return;
  if (audio.paused) { audio.play(); setPlaying(); }
  else { audio.pause(); setPaused(); }
});

document.getElementById("next").addEventListener("click", nextSong);
document.getElementById("prev").addEventListener("click", prevSong);

function playTrack(track) {
  if (!track) return;
  if (track.type === "local") { loadSong(track.index); audio.play(); setPlaying(); }
  else if (track.type === "yt") { playYouTubeVideo(track.videoId, track.title, track.artist, track.thumb); }
}

function nextSong() {
  if (currentPlaylist && playlists[currentPlaylist]) {
    const tracks = playlists[currentPlaylist].tracks;
    if (!tracks.length) return;
    currentPlaylistPos = (currentPlaylistPos + 1) % tracks.length;
    playTrack(tracks[currentPlaylistPos]); updateSongList(); return;
  }
  if (ytMode) return;
  if (!songs.length) return;
  if (isShuffled && shuffleOrder.length) {
    const pos = shuffleOrder.indexOf(songIndex);
    loadSong(shuffleOrder[(pos + 1) % shuffleOrder.length]);
  } else { loadSong((songIndex + 1) % songs.length); }
  audio.play(); setPlaying();
}

function prevSong() {
  if (currentPlaylist && playlists[currentPlaylist]) {
    const tracks = playlists[currentPlaylist].tracks;
    if (!tracks.length) return;
    currentPlaylistPos = (currentPlaylistPos - 1 + tracks.length) % tracks.length;
    playTrack(tracks[currentPlaylistPos]); updateSongList(); return;
  }
  if (ytMode) { if (ytPlayer && ytReady) ytPlayer.seekTo(0, true); return; }
  if (!songs.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (isShuffled && shuffleOrder.length) {
    const pos = shuffleOrder.indexOf(songIndex);
    loadSong(shuffleOrder[(pos - 1 + shuffleOrder.length) % shuffleOrder.length]);
  } else { loadSong((songIndex - 1 + songs.length) % songs.length); }
  audio.play(); setPlaying();
}

audio.addEventListener("ended", () => {
  if (ytMode) return;
  if (currentPlaylist && playlists[currentPlaylist]) { nextSong(); return; }
  if (!songs.length) return;
  if (isRepeat) { audio.currentTime = 0; audio.play(); return; }
  nextSong();
});

// ✅ Shuffle — persistent toggle with proper order
document.getElementById("shuffle-btn").addEventListener("click", () => {
  isShuffled = !isShuffled;
  document.getElementById("shuffle-btn").classList.toggle("active", isShuffled);
  if (isShuffled) {
    const indices = [...songs.keys()].filter(i => i !== songIndex);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    shuffleOrder = [songIndex, ...indices];
    showToast("🔀 Shuffle on");
  } else {
    shuffleOrder = [];
    showToast("Shuffle off");
  }
});

document.getElementById("repeat-btn").addEventListener("click", () => {
  isRepeat = !isRepeat;
  document.getElementById("repeat-btn").classList.toggle("active", isRepeat);
  showToast(isRepeat ? "Repeat on" : "Repeat off");
});

volumeSlider.addEventListener("input", () => {
  const vol = volumeSlider.value / 100;
  audio.volume = vol;
  if (ytPlayer && ytReady) ytPlayer.setVolume(vol * 100);
});
document.getElementById("vol-icon").addEventListener("click", () => {
  const muted = audio.volume === 0;
  audio.volume = muted ? 1 : 0; volumeSlider.value = muted ? 100 : 0;
  if (ytPlayer && ytReady) ytPlayer.setVolume(muted ? 100 : 0);
});

audio.addEventListener("timeupdate", () => {
  if (ytMode) return;
  const { currentTime, duration } = audio;
  if (duration) {
    const pct = (currentTime / duration) * 100;
    progress.style.width = pct + "%";
    progressThumb.style.left = `calc(${pct}% - 5px)`;
    currentTimeEl.textContent = formatTime(currentTime);
    durationEl.textContent = formatTime(duration);
  }
});

progressBar.addEventListener("click", (e) => {
  if (ytMode && ytPlayer && ytReady) {
    const dur = ytPlayer.getDuration();
    if (dur) ytPlayer.seekTo((e.offsetX / progressBar.clientWidth) * dur, true);
    return;
  }
  if (audio.duration) audio.currentTime = (e.offsetX / progressBar.clientWidth) * audio.duration;
});

function formatTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ":" + (s < 10 ? "0" + s : s);
}

// ─── Song List ────────────────────────────────────────────────────────────────
function updateSongList() {
  const listEl = document.getElementById("song-list");
  const panelTitle = document.getElementById("library-panel-title");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (currentPlaylist && playlists[currentPlaylist]) {
    const pl = playlists[currentPlaylist];
    panelTitle.textContent = `${pl.icon || "♫"} ${currentPlaylist}`;

    // ✅ Sort bar for playlist
    listEl.insertAdjacentHTML("beforeend", `
      <div class="sort-bar">
        <span class="sort-label">Sort:</span>
        <button class="sort-btn" data-plsort="title">Title</button>
        <button class="sort-btn" data-plsort="artist">Artist</button>
      </div>`);
    listEl.querySelectorAll(".sort-btn[data-plsort]").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.dataset.plsort === "title" ? pl.sortByTitle() : pl.sortByArtist();
        updateSongList(); showToast(`Sorted by ${btn.dataset.plsort}`);
      });
    });

    if (!pl.tracks.length) { listEl.insertAdjacentHTML("beforeend", `<div class="song-list-empty">No songs in this playlist.</div>`); return; }
    pl.tracks.forEach((track, idx) => {
      const isActive = idx === currentPlaylistPos;
      const title = track.type === "local" ? (songs[track.index]?.title || "Unknown") : track.title;
      const artist = track.type === "local" ? (songs[track.index]?.artist || "Unknown") : track.artist;
      const badge = track.type === "yt" ? `<span class="sr-badge yt-badge" style="font-size:9px;padding:1px 5px;margin-left:4px">YT</span>` : "";
      const div = document.createElement("div");
      div.className = "song-item" + (isActive ? " active" : "");
      div.innerHTML = `
        <div class="song-item-info" style="flex:1;display:flex;align-items:center;gap:10px;overflow:hidden">
          <span class="song-item-num">${isActive ? "▶" : idx + 1}</span>
          <div style="overflow:hidden;min-width:0">
            <div class="song-item-title" style="display:flex;align-items:center;gap:4px">${title}${badge}</div>
            <div class="song-item-artist">${artist}</div>
          </div>
        </div>
        <button class="song-remove-btn" title="Remove">✕</button>`;
      div.querySelector(".song-item-info").addEventListener("click", () => { currentPlaylistPos = idx; playTrack(track); updateSongList(); });
      // ✅ Remove from playlist
      div.querySelector(".song-remove-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        pl.removeTrack(idx);
        if (currentPlaylistPos >= pl.tracks.length) currentPlaylistPos = Math.max(0, pl.tracks.length - 1);
        updateSongList(); renderAllPlaylists();
        showToast("Removed from playlist");
      });
      listEl.appendChild(div);
    });
    return;
  }

  panelTitle.textContent = "♫ Your Library";
  if (!songs.length) { listEl.innerHTML = `<div class="song-list-empty">No local songs yet. Upload or search YouTube! 🎵</div>`; return; }

  // ✅ Sort bar for library
  listEl.insertAdjacentHTML("beforeend", `
    <div class="sort-bar">
      <span class="sort-label">Sort:</span>
      <button class="sort-btn ${librarySortOrder === "recent" ? "active" : ""}" data-sort="recent">Recent</button>
      <button class="sort-btn ${librarySortOrder === "title"  ? "active" : ""}" data-sort="title">Title</button>
      <button class="sort-btn ${librarySortOrder === "artist" ? "active" : ""}" data-sort="artist">Artist</button>
    </div>`);
  listEl.querySelectorAll(".sort-btn[data-sort]").forEach(btn => {
    btn.addEventListener("click", () => { librarySortOrder = btn.dataset.sort; updateSongList(); });
  });

  const sorted = currentUser.getSortedLibrary(librarySortOrder);
  sorted.forEach((song) => {
    const origIdx = songs.indexOf(song);
    const div = document.createElement("div");
    div.className = "song-item" + (origIdx === songIndex && !ytMode ? " active" : "");
    div.innerHTML = `
      <div class="song-item-info" style="flex:1;display:flex;align-items:center;gap:10px;overflow:hidden">
        <span class="song-item-num">${origIdx === songIndex && !ytMode ? "▶" : origIdx + 1}</span>
        <div><div class="song-item-title">${song.title}</div><div class="song-item-artist">${song.artist}</div></div>
      </div>
      <button class="song-remove-btn" title="Remove song">✕</button>`;
    div.querySelector(".song-item-info").addEventListener("click", () => {
      currentPlaylist = null; ytMode = false; stopYTProgress();
      if (ytPlayer && ytReady) ytPlayer.stopVideo();
      loadSong(origIdx); audio.play(); setPlaying();
    });
    // ✅ Remove from library
    div.querySelector(".song-remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const wasPlaying = origIdx === songIndex && !ytMode;
      currentUser.removeSong(origIdx);
      if (wasPlaying && songs.length) loadSong(Math.min(origIdx, songs.length - 1));
      if (!songs.length) { titleEl.textContent = "Nothing playing"; artistEl.textContent = "—"; }
      updateSongList();
      showToast("Song removed");
    });
    listEl.appendChild(div);
  });
}

// ─── NEW PLAYLIST MODAL with YouTube search ───────────────────────────────────
const playlistModal = document.getElementById("playlist-modal");
const playlistNameInput = document.getElementById("playlist-name-input");
let selectedEmoji = "🎵";
let modalSelectedTracks = [];

document.getElementById("new-playlist-btn").addEventListener("click", openNewPlaylistModal);

function openNewPlaylistModal() {
  playlistNameInput.value = "";
  selectedEmoji = "🎵";
  modalSelectedTracks = [];
  document.querySelectorAll(".emoji-opt").forEach(e => e.classList.remove("selected"));
  document.querySelector('.emoji-opt[data-emoji="🎵"]').classList.add("selected");
  document.getElementById("modal-yt-search").value = "";
  document.getElementById("modal-yt-results").innerHTML = "";
  renderModalSelectedList();
  playlistModal.classList.add("open");
  setTimeout(() => playlistNameInput.focus(), 100);
}

document.getElementById("emoji-row").addEventListener("click", (e) => {
  const opt = e.target.closest(".emoji-opt");
  if (!opt) return;
  document.querySelectorAll(".emoji-opt").forEach(x => x.classList.remove("selected"));
  opt.classList.add("selected");
  selectedEmoji = opt.dataset.emoji;
});

let modalSearchTimeout = null;

document.getElementById("modal-yt-search").addEventListener("input", () => {
  clearTimeout(modalSearchTimeout);
  const q = document.getElementById("modal-yt-search").value.trim();
  if (!q) { document.getElementById("modal-yt-results").innerHTML = ""; return; }
  modalSearchTimeout = setTimeout(() => doModalSearch(q), 500);
});

document.getElementById("modal-yt-search-btn").addEventListener("click", () => {
  const q = document.getElementById("modal-yt-search").value.trim();
  if (q) doModalSearch(q);
});

document.getElementById("modal-yt-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); const q = e.target.value.trim(); if (q) doModalSearch(q); }
});

async function doModalSearch(query) {
  const resultsEl = document.getElementById("modal-yt-results");
  resultsEl.innerHTML = `<div class="modal-yt-searching">Searching…</div>`;
  const results = await searchYouTube(query + " official audio");
  if (!results.length) { resultsEl.innerHTML = `<div class="modal-yt-searching">No results found.</div>`; return; }

  resultsEl.innerHTML = results.map(v => {
    const thumb = v.snippet.thumbnails?.default?.url || "";
    const title = v.snippet.title;
    const channel = v.snippet.channelTitle;
    const videoId = v.id.videoId;
    const alreadyAdded = modalSelectedTracks.some(t => t.videoId === videoId);
    return `
      <div class="modal-yt-result-item ${alreadyAdded ? "already-added" : ""}" 
        data-videoid="${videoId}"
        data-title="${title.replace(/"/g, "&quot;")}"
        data-artist="${channel.replace(/"/g, "&quot;")}"
        data-thumb="${thumb}">
        ${thumb ? `<img src="${thumb}" class="modal-yt-thumb"/>` : '<div class="modal-yt-thumb-placeholder">♫</div>'}
        <div class="modal-yt-info">
          <div class="modal-yt-title">${title}</div>
          <div class="modal-yt-artist">${channel}</div>
        </div>
        <button class="modal-yt-add-btn ${alreadyAdded ? "added" : ""}">${alreadyAdded ? "✓ Added" : "+ Add"}</button>
      </div>`;
  }).join("");

  resultsEl.querySelectorAll(".modal-yt-result-item").forEach(item => {
    item.querySelector(".modal-yt-add-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const { videoid, title, artist, thumb } = item.dataset;
      const alreadyAdded = modalSelectedTracks.some(t => t.videoId === videoid);
      if (alreadyAdded) return;
      modalSelectedTracks.push({ type: "yt", videoId: videoid, title, artist, thumb });
      item.classList.add("already-added");
      item.querySelector(".modal-yt-add-btn").textContent = "✓ Added";
      item.querySelector(".modal-yt-add-btn").classList.add("added");
      renderModalSelectedList();
      showToast(`Added: ${title}`);
    });
  });
}

function renderModalSelectedList() {
  const section = document.getElementById("modal-selected-section");
  const list = document.getElementById("modal-selected-list");
  const count = document.getElementById("modal-selected-count");

  if (!modalSelectedTracks.length) { section.style.display = "none"; return; }
  section.style.display = "block";
  count.textContent = modalSelectedTracks.length;

  list.innerHTML = modalSelectedTracks.map((t, i) => {
    const title = t.type === "yt" ? t.title : (songs[t.index]?.title || "Unknown");
    const artist = t.type === "yt" ? t.artist : (songs[t.index]?.artist || "Unknown");
    return `
      <div class="picker-item" data-idx="${i}">
        <span class="sr-badge yt-badge" style="font-size:9px;padding:1px 6px;flex-shrink:0">YT</span>
        <div class="picker-item-info" style="flex:1;min-width:0">
          <div class="picker-title">${title}</div>
          <div class="picker-artist">${artist}</div>
        </div>
        <button class="modal-remove-btn" data-idx="${i}" title="Remove">✕</button>
      </div>`;
  }).join("");

  list.querySelectorAll(".modal-remove-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      modalSelectedTracks.splice(idx, 1);
      renderModalSelectedList();
      const q = document.getElementById("modal-yt-search").value.trim();
      if (q) doModalSearch(q);
    });
  });
}

document.getElementById("modal-close").addEventListener("click", closePlaylistModal);
document.getElementById("modal-cancel").addEventListener("click", closePlaylistModal);
playlistModal.addEventListener("click", (e) => { if (e.target === playlistModal) closePlaylistModal(); });
function closePlaylistModal() { playlistModal.classList.remove("open"); }

document.getElementById("modal-create").addEventListener("click", () => {
  const name = playlistNameInput.value.trim();
  if (!name) { playlistNameInput.focus(); showToast("Enter a playlist name!"); return; }
  if (playlists[name]) { showToast("A playlist with that name already exists!"); return; }
  if (!modalSelectedTracks.length) { showToast("Add at least one song!"); return; }
  // ✅ Uses Playlist class
  const pl = new Playlist(name, selectedEmoji);
  modalSelectedTracks.forEach(t => pl.addTrack(t));
  currentUser.addPlaylist(pl);
  renderAllPlaylists();
  closePlaylistModal();
  showToast(`✅ Playlist "${name}" created with ${modalSelectedTracks.length} songs!`);
  addAIMessage(`✅ Playlist "${name}" with ${modalSelectedTracks.length} song(s) created!`);
});

// ─── Preset playlist cards ────────────────────────────────────────────────────
document.getElementById("user-playlist-grid").addEventListener("click", (e) => {
  const card = e.target.closest(".playlist-card");
  if (!card) return;
  const name = card.dataset.playlist;
  if (!name) return;
  if (playlists[name]) { openPlaylistDetail(name); }
  else {
    playlistNameInput.value = name;
    selectedEmoji = card.querySelector(".card-icon")?.textContent.trim() || "🎵";
    modalSelectedTracks = [];
    document.querySelectorAll(".emoji-opt").forEach(x => x.classList.remove("selected"));
    const matchEmoji = document.querySelector(`.emoji-opt[data-emoji="${selectedEmoji}"]`);
    if (matchEmoji) matchEmoji.classList.add("selected");
    document.getElementById("modal-yt-search").value = "";
    document.getElementById("modal-yt-results").innerHTML = "";
    renderModalSelectedList();
    playlistModal.classList.add("open");
  }
});

// ─── Playlist Detail Modal ────────────────────────────────────────────────────
const detailModal = document.getElementById("playlist-detail-modal");

function openPlaylistDetail(name) {
  const pl = playlists[name];
  document.getElementById("detail-modal-title").textContent = `${pl.icon} ${name}`;
  document.getElementById("playlist-detail-info").innerHTML = `
    <div class="detail-icon">${pl.icon}</div>
    <div>
      <div class="detail-name">${name}</div>
      <div class="detail-count">${pl.tracks.length} song${pl.tracks.length !== 1 ? "s" : ""}</div>
    </div>`;

  const list = document.getElementById("detail-song-list");

  // ✅ Sort bar in detail modal
  list.innerHTML = `
    <div class="sort-bar" style="border-radius:8px 8px 0 0;margin-bottom:2px">
      <span class="sort-label">Sort:</span>
      <button class="sort-btn" id="detail-sort-title">Title</button>
      <button class="sort-btn" id="detail-sort-artist">Artist</button>
    </div>`;
  document.getElementById("detail-sort-title").addEventListener("click",  () => { pl.sortByTitle();  openPlaylistDetail(name); showToast("Sorted by title"); });
  document.getElementById("detail-sort-artist").addEventListener("click", () => { pl.sortByArtist(); openPlaylistDetail(name); showToast("Sorted by artist"); });

  if (!pl.tracks.length) {
    list.insertAdjacentHTML("beforeend", `<div class="song-list-empty">No songs yet.</div>`);
  } else {
    pl.tracks.forEach((track, pos) => {
      const title = track.type === "local" ? (songs[track.index]?.title || "Unknown") : track.title;
      const artist = track.type === "local" ? (songs[track.index]?.artist || "Unknown") : track.artist;
      const badge = track.type === "yt" ? `<span class="sr-badge yt-badge" style="font-size:9px;padding:1px 5px;margin-left:6px">YT</span>` : "";
      const item = document.createElement("div");
      item.className = "picker-item";
      item.style.cursor = "pointer";
      item.innerHTML = `
        <span style="color:var(--text-muted);font-size:12px;min-width:22px">${pos + 1}</span>
        <div class="picker-item-info" style="flex:1">
          <div class="picker-title" style="display:flex;align-items:center">${title}${badge}</div>
          <div class="picker-artist">${artist}</div>
        </div>
        <button class="song-remove-btn" title="Remove">✕</button>`;
      item.querySelector(".picker-item-info").addEventListener("click", () => {
        currentPlaylist = name; currentPlaylistPos = pos;
        playTrack(track);
        detailModal.classList.remove("open");
        document.getElementById("library-panel").classList.add("open");
        updateSongList();
      });
      // ✅ Remove track from playlist in detail modal
      item.querySelector(".song-remove-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        pl.removeTrack(pos);
        openPlaylistDetail(name);
        renderAllPlaylists();
        showToast("Removed from playlist");
      });
      list.appendChild(item);
    });
  }

  document.getElementById("detail-play-all").onclick = () => {
    if (!pl.tracks.length) return;
    currentPlaylist = name; currentPlaylistPos = 0;
    playTrack(pl.tracks[0]);
    detailModal.classList.remove("open");
    document.getElementById("library-panel").classList.add("open");
    updateSongList();
  };

  // ✅ Uses Playlist.shuffle()
  document.getElementById("detail-shuffle").onclick = () => {
    if (!pl.tracks.length) return;
    pl.shuffle();
    currentPlaylist = name; currentPlaylistPos = 0;
    playTrack(pl.tracks[0]);
    detailModal.classList.remove("open");
    document.getElementById("library-panel").classList.add("open");
    updateSongList();
    showToast("Shuffling playlist…");
  };

  detailModal.classList.add("open");
}

document.getElementById("detail-modal-close").addEventListener("click", () => detailModal.classList.remove("open"));
detailModal.addEventListener("click", (e) => { if (e.target === detailModal) detailModal.classList.remove("open"); });

// ─── Render all playlists ──────────────────────────────────────────────────────
function renderAllPlaylists() {
  document.querySelectorAll("#user-playlist-grid .playlist-card[data-playlist]").forEach(card => {
    const name = card.dataset.playlist;
    const pl = playlists[name];
    if (pl) card.querySelector(".card-meta").textContent = `${pl.tracks.length} song${pl.tracks.length !== 1 ? "s" : ""}`;
  });
  const customNames = Object.keys(playlists).filter(n =>
    !document.querySelector(`#user-playlist-grid .playlist-card[data-playlist="${n}"]`)
  );
  let section = document.getElementById("ai-playlists-section");
  if (customNames.length === 0) { if (section) section.remove(); return; }
  if (!section) {
    section = document.createElement("div");
    section.id = "ai-playlists-section";
    section.innerHTML = `<h2 class="category-title">My Playlists</h2><div class="playlist-grid" id="ai-playlist-grid"></div>`;
    document.getElementById("main-content").prepend(section);
  }
  const grid = document.getElementById("ai-playlist-grid");
  grid.innerHTML = "";
  customNames.forEach(name => {
    const pl = playlists[name];
    const card = document.createElement("div");
    card.className = "playlist-card";
    card.innerHTML = `
      <div class="card-icon">${pl.icon || "🎵"}</div>
      <div class="card-name">${name}</div>
      <div class="card-meta">${pl.tracks.length} song${pl.tracks.length !== 1 ? "s" : ""}</div>`;
    card.addEventListener("click", () => openPlaylistDetail(name));
    grid.appendChild(card);
  });
}

// ─── AI Panel ─────────────────────────────────────────────────────────────────
const aiPanel = document.getElementById("ai-panel");
const aiToggle = document.getElementById("ai-toggle");
const aiMessages = document.getElementById("ai-messages");
const aiInput = document.getElementById("ai-input");
const aiSend = document.getElementById("ai-send");

aiToggle.addEventListener("click", () => {
  aiPanel.classList.toggle("open");
  if (aiPanel.classList.contains("open") && aiMessages.children.length === 0) {
    addAIMessage("Hey! 👋 I'm your AI music assistant. I can:\n• Search & play ANY song from YouTube\n• Create playlists\n• Control playback\n\nTry: \"Play Blinding Lights\" or \"Create a chill playlist\"!");
  }
});

function addAIMessage(text, isUser = false) {
  const div = document.createElement("div");
  div.className = "ai-msg " + (isUser ? "ai-msg-user" : "ai-msg-bot");
  div.textContent = text;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function addAILoading() {
  const div = document.createElement("div");
  div.className = "ai-msg ai-msg-bot ai-loading";
  div.id = "ai-loading";
  div.innerHTML = `<span></span><span></span><span></span>`;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return div;
}

async function sendToAI(userMessage) {
  addAIMessage(userMessage, true);
  const loader = addAILoading();
  aiInput.value = "";
  aiInput.disabled = true;
  aiSend.disabled = true;

  const songListText = songs.length
    ? songs.map((s, i) => `${i}: "${s.title}" by ${s.artist}`).join("\n")
    : "(No local songs)";

  const playlistText = Object.keys(playlists).length
    ? Object.entries(playlists).map(([name, pl]) => {
        const trackList = pl.tracks.map(t => t.type === "local" ? songs[t.index]?.title : t.title).join(", ");
        return `${name}: [${trackList}]`;
      }).join("\n")
    : "(No playlists yet)";

  const nowPlaying = ytMode
    ? `Now playing via YouTube: "${titleEl.textContent}" by ${artistEl.textContent}`
    : songs.length ? `Now playing (local): "${songs[songIndex]?.title}" by ${songs[songIndex]?.artist}` : "Nothing playing";

  const systemPrompt = `You are a music assistant in MusiCine, a web music player with YouTube streaming.

Local songs: ${songListText}
Playlists: ${playlistText}
${nowPlaying}

ACTIONS you can trigger:
Play from YouTube: \`\`\`action
{ "type": "PLAY_YOUTUBE", "query": "song name artist" }
\`\`\`
Play local: \`\`\`action
{ "type": "PLAY_LOCAL", "index": 0 }
\`\`\`
Shuffle local: \`\`\`action
{ "type": "SHUFFLE" }
\`\`\`
Show playlist: \`\`\`action
{ "type": "SHOW_PLAYLIST", "name": "Chill Vibes" }
\`\`\`

If asked to play any song, use PLAY_YOUTUBE. Be friendly and concise.`;

  try {
    const res = await fetch("/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: systemPrompt, messages: [{ role: "user", content: userMessage }] }),
    });
    const data = await res.json();
    const fullText = data.content?.map(b => b.text || "").join("") || "Sorry, I couldn't respond.";
    const actionMatch = fullText.match(/```action\s*([\s\S]*?)```/);
    const displayText = fullText.replace(/```action[\s\S]*?```/g, "").trim();
    loader.remove();
    addAIMessage(displayText);
    if (actionMatch) {
      try { executeAction(JSON.parse(actionMatch[1].trim())); }
      catch (e) { console.error("Action parse error", e); }
    }
  } catch (err) {
    loader.remove();
    addAIMessage("Oops! Couldn't reach the AI. Make sure the server is running. 🔌");
  } finally {
    aiInput.disabled = false; aiSend.disabled = false; aiInput.focus();
  }
}

async function executeAction(action) {
  switch (action.type) {
    case "PLAY_LOCAL":
      if (action.index >= 0 && action.index < songs.length) {
        currentPlaylist = null; loadSong(action.index); audio.play(); setPlaying();
      }
      break;
    case "PLAY_YOUTUBE":
      if (action.query) {
        showToast(`🔍 Searching YouTube…`);
        const results = await searchYouTube(action.query);
        if (results && results.length) {
          const v = results[0];
          currentPlaylist = null;
          playYouTubeVideo(v.id.videoId, v.snippet.title, v.snippet.channelTitle, v.snippet.thumbnails?.default?.url || "");
          addAIMessage(`▶ Playing "${v.snippet.title}" on YouTube!`);
        } else { addAIMessage("Couldn't find that on YouTube. Try a different search!"); }
      }
      break;
    case "SHUFFLE":
      if (!songs.length) { addAIMessage("No local songs to shuffle!"); return; }
      isShuffled = true;
      document.getElementById("shuffle-btn").classList.add("active");
      const indices = [...songs.keys()];
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      shuffleOrder = indices;
      currentPlaylist = null; loadSong(shuffleOrder[0]); audio.play(); setPlaying();
      showToast("🔀 Library shuffled!"); updateSongList();
      break;
    case "SHOW_PLAYLIST":
      if (playlists[action.name]) openPlaylistDetail(action.name);
      break;
  }
}

aiSend.addEventListener("click", () => { const msg = aiInput.value.trim(); if (msg) sendToAI(msg); });
aiInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); aiSend.click(); } });

document.getElementById("library-toggle").addEventListener("click", () => {
  document.getElementById("library-panel").classList.toggle("open");
  updateSongList();
});
document.getElementById("show-all-btn").addEventListener("click", () => {
  currentPlaylist = null; updateSongList();
});