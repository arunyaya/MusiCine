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
  updateSongList();

  // Track context for recommendations (no prefetch — fetch on demand when Next is clicked)
  ytPlayedVideoIds.add(videoId);
  ytCurrentContext = { title, artist, videoId };
}

function normalizeStr(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isDifferentArtist(result, currentTitle, currentArtist) {
  const resTitle  = normalizeStr(result.snippet.title);
  const resChannel = normalizeStr(result.snippet.channelTitle);
  const normArtist = normalizeStr(currentArtist);
  const normTitle  = normalizeStr(currentTitle);

  // Reject if channel name closely matches current artist
  if (normArtist.length > 3 && resChannel.includes(normArtist)) return false;
  if (normArtist.length > 3 && normArtist.includes(resChannel)) return false;

  // Reject if result title contains both the current song title AND artist
  // (i.e. same song re-uploaded by a different channel)
  const titleWords = normTitle.replace(/\s+/g, "").slice(0, 20); // first 20 chars as fingerprint
  if (titleWords.length > 5 && resTitle.includes(titleWords)) return false;

  return true;
}

async function prefetchYTRecommendations(title, artist) {
  const cleanTitle = title
    .replace(/\(.*?(official|audio|video|lyrics|ft\.?|feat\.?).*?\)/gi, "")
    .replace(/\[.*?\]/gi, "")
    .trim();

  // Query focuses on the ARTIST's style/genre, NOT the specific song title
  // This avoids YouTube returning re-uploads of the same track
  const query = `${artist} style music mix`;
  try {
    const results = await searchYouTube(query);
    ytRecommendQueue = (results || []).filter(v =>
      !ytPlayedVideoIds.has(v.id.videoId) &&
      isDifferentArtist(v, cleanTitle, artist)
    );
  } catch (e) {
    ytRecommendQueue = [];
  }
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
let songs = [];
let playlists = {};
let currentPlaylist = null;
let currentPlaylistPos = 0;
let songIndex = 0;
let isShuffled = false;
let isRepeat = false;
let shuffleOrder = [];

// ─── YT Recommendation State ──────────────────────────────────────────────────
let ytCurrentContext = null;   // { title, artist, query } of what's playing
let ytRecommendQueue = [];     // pre-fetched recommendation results
let ytPlayedVideoIds = new Set(); // avoid re-playing same video in a session

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
        resolve({ name: file.name.replace(/\.[^.]+$/, ""), url, title: tags.title || file.name.replace(/\.[^.]+$/, ""), artist: tags.artist || "Unknown Artist", cover, file });
      },
      onError() {
        resolve({ name: file.name.replace(/\.[^.]+$/, ""), url, title: file.name.replace(/\.[^.]+$/, ""), artist: "Unknown Artist", cover: "", file });
      },
    });
  });
}

// ─── Upload ───────────────────────────────────────────────────────────────────
document.getElementById("upload-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const wasEmpty = songs.length === 0;
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const song = await readTags(file, url);
    songs.push(song);
  }
  updateSongList();
  if (wasEmpty) { loadSong(0); audio.play(); setPlaying(); }
  showToast(`✅ Added ${files.length} song${files.length !== 1 ? "s" : ""}!`);
  if (typeof refreshHomeUI === "function") refreshHomeUI();
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
  if (ytMode) {
    // ── Recommendation-based next for standalone YT playback ──
    playNextYTRecommendation();
    return;
  }
  if (!songs.length) return;
  if (isShuffled && shuffleOrder.length) {
    const pos = shuffleOrder.indexOf(songIndex);
    loadSong(shuffleOrder[(pos + 1) % shuffleOrder.length]);
  } else { loadSong((songIndex + 1) % songs.length); }
  audio.play(); setPlaying();
}

async function playNextYTRecommendation() {
  // If we have pre-fetched results ready, use them immediately
  if (ytRecommendQueue.length > 0) {
    const next = ytRecommendQueue.shift();
    const title = next.snippet.title;
    const artist = next.snippet.channelTitle;
    const videoId = next.id.videoId;
    const thumb = next.snippet.thumbnails?.default?.url || "";
    showToast(`▶ Up next: ${title}`);
    playYouTubeVideo(videoId, title, artist, thumb);
    return;
  }

  // Queue empty — do a live search based on current context
  if (!ytCurrentContext) { showToast("Nothing to recommend. Search a song first!"); return; }

  showToast("🔍 Finding similar songs…");
  const { title, artist } = ytCurrentContext;
  const cleanTitle = title
    .replace(/\(.*?(official|audio|video|lyrics|ft\.?|feat\.?).*?\)/gi, "")
    .replace(/\[.*?\]/gi, "")
    .trim();

  // Queries that target the genre/vibe — NOT the specific song — to get different artists
  const queries = [
    `${artist} type beats playlist`,
    `songs similar to ${artist}`,
    `${artist} genre mix`,
  ];

  for (const query of queries) {
    try {
      const results = await searchYouTube(query);
      const fresh = (results || []).filter(v =>
        !ytPlayedVideoIds.has(v.id.videoId) &&
        isDifferentArtist(v, cleanTitle, artist)
      );
      if (fresh.length > 0) {
        const next = fresh[0];
        ytRecommendQueue = fresh.slice(1);
        showToast(`▶ Up next: ${next.snippet.title}`);
        playYouTubeVideo(next.id.videoId, next.snippet.title, next.snippet.channelTitle, next.snippet.thumbnails?.default?.url || "");
        return;
      }
    } catch (e) { /* try next query */ }
  }

  // Absolute fallback: reset played history and retry
  showToast("🔄 Refreshing recommendations…");
  ytPlayedVideoIds.clear();
  if (ytCurrentContext) ytPlayedVideoIds.add(ytCurrentContext.videoId);
  await prefetchYTRecommendations(title, artist);
  if (ytRecommendQueue.length > 0) {
    const next = ytRecommendQueue.shift();
    playYouTubeVideo(next.id.videoId, next.snippet.title, next.snippet.channelTitle, next.snippet.thumbnails?.default?.url || "");
  } else {
    showToast("No recommendations found. Try searching a new song!");
  }
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

document.getElementById("shuffle-btn").addEventListener("click", () => {
  isShuffled = !isShuffled;
  document.getElementById("shuffle-btn").classList.toggle("active", isShuffled);
  if (isShuffled) { shuffleOrder = [...songs.keys()].sort(() => Math.random() - 0.5); showToast("Shuffle on"); }
  else showToast("Shuffle off");
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
    if (!pl.tracks.length) { listEl.innerHTML = `<div class="song-list-empty">No songs in this playlist.</div>`; return; }
    pl.tracks.forEach((track, idx) => {
      const isActive = idx === currentPlaylistPos;
      const title = track.type === "local" ? (songs[track.index]?.title || "Unknown") : track.title;
      const artist = track.type === "local" ? (songs[track.index]?.artist || "Unknown") : track.artist;
      const badge = track.type === "yt" ? `<span class="sr-badge yt-badge" style="font-size:9px;padding:1px 5px;margin-left:4px">YT</span>` : "";
      const div = document.createElement("div");
      div.className = "song-item" + (isActive ? " active" : "");
      div.innerHTML = `
        <div class="song-item-info">
          <span class="song-item-num">${isActive ? "▶" : idx + 1}</span>
          <div style="overflow:hidden;min-width:0">
            <div class="song-item-title" style="display:flex;align-items:center;gap:4px">${title}${badge}</div>
            <div class="song-item-artist">${artist}</div>
          </div>
        </div>`;
      div.addEventListener("click", () => { currentPlaylistPos = idx; playTrack(track); updateSongList(); });
      listEl.appendChild(div);
    });
    return;
  }

  panelTitle.textContent = "♫ Your Library";
  if (!songs.length) { listEl.innerHTML = `<div class="song-list-empty">No local songs yet. Upload or search YouTube! 🎵</div>`; return; }
  songs.forEach((song, idx) => {
    const div = document.createElement("div");
    div.className = "song-item" + (idx === songIndex && !ytMode ? " active" : "");
    div.innerHTML = `
      <div class="song-item-info">
        <span class="song-item-num">${idx === songIndex && !ytMode ? "▶" : idx + 1}</span>
        <div><div class="song-item-title">${song.title}</div><div class="song-item-artist">${song.artist}</div></div>
      </div>`;
    div.addEventListener("click", () => {
      currentPlaylist = null; ytMode = false; stopYTProgress();
      if (ytPlayer && ytReady) ytPlayer.stopVideo();
      loadSong(idx); audio.play(); setPlaying();
    });
    listEl.appendChild(div);
  });
}

// ─── NEW PLAYLIST MODAL with YouTube search ───────────────────────────────────
const playlistModal = document.getElementById("playlist-modal");
const playlistNameInput = document.getElementById("playlist-name-input");
let selectedEmoji = "🎵";

// Tracks selected for the new playlist: array of track objects
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

// ── YouTube search inside modal ───────────────────────────────────────────────
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

  // Add click handlers
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
      // Re-render search results to update "Added" state
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
  playlists[name] = { icon: selectedEmoji, tracks: [...modalSelectedTracks] };
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

let detailCurrentPlaylist = null;   // name of playlist open in detail modal
let detailSortMode = "default";     // current sort: default | title | artist | reverse
let detailYTSearchTimeout = null;

function getDetailTracks(name) {
  const pl = playlists[name];
  if (!pl) return [];
  const tracks = [...pl.tracks]; // work on a copy for display
  if (detailSortMode === "title") {
    tracks.sort((a, b) => {
      const ta = (a.type === "local" ? songs[a.index]?.title : a.title) || "";
      const tb = (b.type === "local" ? songs[b.index]?.title : b.title) || "";
      return ta.localeCompare(tb);
    });
  } else if (detailSortMode === "artist") {
    tracks.sort((a, b) => {
      const aa = (a.type === "local" ? songs[a.index]?.artist : a.artist) || "";
      const ab = (b.type === "local" ? songs[b.index]?.artist : b.artist) || "";
      return aa.localeCompare(ab);
    });
  } else if (detailSortMode === "reverse") {
    tracks.reverse();
  }
  return tracks;
}

function renderDetailSongList(name) {
  const pl = playlists[name];
  const list = document.getElementById("detail-song-list");
  const displayTracks = getDetailTracks(name);

  // Update count
  const countEl = document.querySelector("#playlist-detail-info .detail-count");
  if (countEl) countEl.textContent = `${pl.tracks.length} song${pl.tracks.length !== 1 ? "s" : ""}`;

  if (!displayTracks.length) {
    list.innerHTML = `<div class="song-list-empty">No songs yet. Search below to add some!</div>`;
    return;
  }

  list.innerHTML = displayTracks.map((track, pos) => {
    const title = track.type === "local" ? (songs[track.index]?.title || "Unknown") : track.title;
    const artist = track.type === "local" ? (songs[track.index]?.artist || "Unknown") : track.artist;
    const badge = track.type === "yt" ? `<span class="sr-badge yt-badge" style="font-size:9px;padding:1px 5px;margin-left:6px">YT</span>` : "";
    // Store original index for removal (we need to remove from pl.tracks, not sorted copy)
    const origIdx = pl.tracks.indexOf(track);
    return `<div class="picker-item detail-track-item" data-pos="${pos}" data-orig-idx="${origIdx}" style="cursor:pointer">
      <span style="color:var(--text-muted);font-size:12px;min-width:22px">${pos + 1}</span>
      <div class="picker-item-info" style="flex:1;min-width:0">
        <div class="picker-title" style="display:flex;align-items:center">${title}${badge}</div>
        <div class="picker-artist">${artist}</div>
      </div>
      <button class="detail-remove-btn" data-orig-idx="${origIdx}" title="Remove from playlist">✕</button>
    </div>`;
  }).join("");

  // Play on click
  list.querySelectorAll(".detail-track-item").forEach(item => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".detail-remove-btn")) return;
      const origIdx = parseInt(item.dataset.origIdx);
      currentPlaylist = name;
      currentPlaylistPos = origIdx;
      playTrack(pl.tracks[origIdx]);
      detailModal.classList.remove("open");
      document.getElementById("library-panel").classList.add("open");
      updateSongList();
    });
  });

  // Remove on ✕
  list.querySelectorAll(".detail-remove-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const origIdx = parseInt(btn.dataset.origIdx);
      pl.tracks.splice(origIdx, 1);
      // If currently playing this playlist, adjust position
      if (currentPlaylist === name) {
        if (currentPlaylistPos >= pl.tracks.length) currentPlaylistPos = Math.max(0, pl.tracks.length - 1);
      }
      renderDetailSongList(name);
      renderAllPlaylists();
      if (typeof refreshHomeUI === "function") refreshHomeUI();
      showToast("Song removed from playlist");
    });
  });
}

function openPlaylistDetail(name) {
  const pl = playlists[name];
  detailCurrentPlaylist = name;
  detailSortMode = "default";

  document.getElementById("detail-modal-title").textContent = `${pl.icon} ${name}`;
  document.getElementById("playlist-detail-info").innerHTML = `
    <div class="detail-icon">${pl.icon}</div>
    <div>
      <div class="detail-name">${name}</div>
      <div class="detail-count">${pl.tracks.length} song${pl.tracks.length !== 1 ? "s" : ""}</div>
    </div>`;

  // Reset sort buttons
  document.querySelectorAll(".detail-sort-bar .sort-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.sort === "default");
  });

  // Reset YT search
  document.getElementById("detail-yt-search").value = "";
  document.getElementById("detail-yt-results").innerHTML = "";

  renderDetailSongList(name);

  // Sort buttons
  document.querySelectorAll(".detail-sort-bar .sort-btn").forEach(btn => {
    btn.onclick = () => {
      detailSortMode = btn.dataset.sort;
      document.querySelectorAll(".detail-sort-bar .sort-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderDetailSongList(name);
    };
  });

  // YT search to add songs
  const detailYTSearch = document.getElementById("detail-yt-search");
  const detailYTResults = document.getElementById("detail-yt-results");
  const detailYTBtn = document.getElementById("detail-yt-search-btn");

  async function doDetailSearch(query) {
    detailYTResults.innerHTML = `<div class="modal-yt-searching">Searching…</div>`;
    const results = await searchYouTube(query + " official audio");
    if (!results.length) { detailYTResults.innerHTML = `<div class="modal-yt-searching">No results found.</div>`; return; }
    detailYTResults.innerHTML = results.map(v => {
      const thumb = v.snippet.thumbnails?.default?.url || "";
      const title = v.snippet.title;
      const channel = v.snippet.channelTitle;
      const videoId = v.id.videoId;
      const alreadyAdded = pl.tracks.some(t => t.videoId === videoId);
      return `<div class="modal-yt-result-item ${alreadyAdded ? "already-added" : ""}"
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

    detailYTResults.querySelectorAll(".modal-yt-result-item").forEach(item => {
      item.querySelector(".modal-yt-add-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        const { videoid, title, artist, thumb } = item.dataset;
        if (pl.tracks.some(t => t.videoId === videoid)) return;
        pl.tracks.push({ type: "yt", videoId: videoid, title, artist, thumb });
        item.classList.add("already-added");
        item.querySelector(".modal-yt-add-btn").textContent = "✓ Added";
        item.querySelector(".modal-yt-add-btn").classList.add("added");
        renderDetailSongList(name);
        renderAllPlaylists();
        if (typeof refreshHomeUI === "function") refreshHomeUI();
        showToast(`Added: ${title}`);
      });
    });
  }

  detailYTSearch.oninput = () => {
    clearTimeout(detailYTSearchTimeout);
    const q = detailYTSearch.value.trim();
    if (!q) { detailYTResults.innerHTML = ""; return; }
    detailYTSearchTimeout = setTimeout(() => doDetailSearch(q), 500);
  };
  detailYTBtn.onclick = () => { const q = detailYTSearch.value.trim(); if (q) doDetailSearch(q); };
  detailYTSearch.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); const q = e.target.value.trim(); if (q) doDetailSearch(q); } };

  document.getElementById("detail-play-all").onclick = () => {
    if (!pl.tracks.length) return;
    currentPlaylist = name; currentPlaylistPos = 0;
    playTrack(pl.tracks[0]);
    detailModal.classList.remove("open");
    document.getElementById("library-panel").classList.add("open");
    updateSongList();
  };

  document.getElementById("detail-shuffle").onclick = () => {
    if (!pl.tracks.length) return;
    // Shuffle the actual playlist tracks
    const shuffled = [...pl.tracks].sort(() => Math.random() - 0.5);
    pl.tracks = shuffled;
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
    addAIMessage("Hey! 👋 I'm your AI music assistant. I can:\n• Search & play ANY song from YouTube\n• Create full playlists with multiple songs\n• Control playback\n\nTry: \"Play Blinding Lights\", \"Create a chill playlist with 5 songs\", or \"Make a workout playlist\"!");
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

ACTIONS you can trigger (output ONLY ONE action block per response):

Play a single song from YouTube:
\`\`\`action
{ "type": "PLAY_YOUTUBE", "query": "song name artist" }
\`\`\`

Play a local song by index:
\`\`\`action
{ "type": "PLAY_LOCAL", "index": 0 }
\`\`\`

Shuffle local library:
\`\`\`action
{ "type": "SHUFFLE" }
\`\`\`

Show an existing playlist:
\`\`\`action
{ "type": "SHOW_PLAYLIST", "name": "Playlist Name" }
\`\`\`

Create a playlist with multiple YouTube songs (use this when user asks to "make", "create", or "build" a playlist):
\`\`\`action
{ "type": "CREATE_PLAYLIST", "name": "Playlist Name", "emoji": "🎵", "songs": ["Artist1 - Song1 official audio", "Artist2 - Song2 official audio", "Artist3 - Song3 official audio"] }
\`\`\`

IMPORTANT RULES:
- When the user asks to CREATE a playlist (e.g. "make a chill playlist", "create a workout playlist", "build a sad songs playlist"), you MUST use CREATE_PLAYLIST with at least 5 relevant song queries in the "songs" array.
- For CREATE_PLAYLIST, the "songs" array should contain search queries (not just song names). Include artist name for accuracy.
- Pick songs that genuinely match the mood/theme the user asks for.
- For CREATE_PLAYLIST, choose a fitting emoji for the playlist theme.
- Be friendly, concise, and confirm what you're doing.`;

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

// ─── Execute AI Actions ───────────────────────────────────────────────────────
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
      for (let i = songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [songs[i], songs[j]] = [songs[j], songs[i]];
      }
      currentPlaylist = null; updateSongList(); loadSong(0); audio.play(); setPlaying();
      showToast("Library shuffled!");
      break;

    case "SHOW_PLAYLIST":
      if (playlists[action.name]) openPlaylistDetail(action.name);
      break;

    // ── NEW: Create playlist by searching YouTube for each song ──────────────
    case "CREATE_PLAYLIST": {
      const name = action.name || "AI Playlist";
      const emoji = action.emoji || "🎵";
      const songQueries = action.songs || [];

      if (!songQueries.length) {
        addAIMessage("I couldn't figure out which songs to add. Try being more specific!");
        break;
      }
      if (playlists[name]) {
        addAIMessage(`A playlist called "${name}" already exists! Ask me to make one with a different name.`);
        break;
      }

      showToast(`🔍 Building "${name}"…`);
      addAIMessage(`⏳ Searching YouTube for ${songQueries.length} songs, please wait…`);

      const tracks = [];
      for (const query of songQueries) {
        try {
          const results = await searchYouTube(query);
          if (results && results.length) {
            const v = results[0];
            tracks.push({
              type: "yt",
              videoId: v.id.videoId,
              title: v.snippet.title,
              artist: v.snippet.channelTitle,
              thumb: v.snippet.thumbnails?.default?.url || "",
            });
          }
        } catch (e) {
          console.error("Failed to search for:", query, e);
        }
      }

      if (!tracks.length) {
        addAIMessage("Couldn't find any songs on YouTube. Try a different playlist theme!");
        break;
      }

      playlists[name] = { icon: emoji, tracks };
      renderAllPlaylists();
      showToast(`✅ "${name}" created with ${tracks.length} songs!`);
      addAIMessage(`✅ Created playlist "${name}" ${emoji} with ${tracks.length} songs! Open it from Your Playlists or say "show ${name}".`);

      // Trigger home UI refresh if available
      if (typeof refreshHomeUI === "function") refreshHomeUI();
      break;
    }
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