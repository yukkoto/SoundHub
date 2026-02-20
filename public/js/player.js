(() => {
  const audio = new Audio();
  audio.preload = 'metadata';

  // --- Mini bar elements -----------------------------------------------------
  const bar = document.getElementById('playerbar');
  const miniFill = document.getElementById('progressFill');
  const miniCur = document.getElementById('curTime');
  const miniDur = document.getElementById('durTime');
  const miniBtn = document.getElementById('pauseBtn');
  const miniProgress = document.getElementById('progress');

  const miniCover = document.getElementById('miniCover');
  const miniTitle = document.getElementById('miniTitle');
  const miniArtist = document.getElementById('miniArtist');

  const miniLikeBtn = document.getElementById('miniLikeBtn');
  const openTrackLink = document.getElementById('openTrackLink');

  // --- Fullscreen player elements -------------------------------------------
  const full = document.getElementById('playerfull');
  const fullCover = document.getElementById('fullCover');
  const fullTitle = document.getElementById('fullTitle');
  const fullArtist = document.getElementById('fullArtist');
  const fullCur = document.getElementById('fullCurTime');
  const fullDur = document.getElementById('fullDurTime');
  const fullFill = document.getElementById('fullProgressFill');
  const fullProgress = document.getElementById('fullProgress');
  const fullBtn = document.getElementById('fullPauseBtn');
  const fullLikeBtn = document.getElementById('fullLikeBtn');
  const fullTrackLink = document.getElementById('fullTrackLink');
  const fullAuthorLink = document.getElementById('fullAuthorLink');

  // --- State ----------------------------------------------------------------
  let currentTrack = null; // {id,title,artist,artistId,cover,audio}
  const likedSet = new Set(Array.isArray(window.__LIKED_IDS__) ? window.__LIKED_IDS__ : []);

  const fmt = sec => {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${s}`;
  };

  function showBar() {
    if (bar) bar.style.display = 'block';
  }

  function renderPlayPauseIcon(buttonEl, playing) {
    const icon = buttonEl?.querySelector('.pauseicon');
    if (!icon) return;
    icon.innerHTML = '';
    if (playing) {
      const s1 = document.createElement('span');
      const s2 = document.createElement('span');
      icon.appendChild(s1);
      icon.appendChild(s2);
    } else {
      const tri = document.createElement('div');
      tri.style.width = '0';
      tri.style.height = '0';
      tri.style.borderTop = '11px solid transparent';
      tri.style.borderBottom = '11px solid transparent';
      tri.style.borderLeft = '16px solid #d1ab7c';
      tri.style.marginLeft = '4px';
      icon.appendChild(tri);
    }
  }

  function setLikedUI(trackId, liked) {
    // Update all buttons for this track
    document
      .querySelectorAll(`[data-like-id="${CSS.escape(trackId)}"]`)
      .forEach(btn => {
        btn.classList.toggle('liked', !!liked);
        btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      });
  }

  function refreshCurrentLikeUI() {
    if (!currentTrack?.id) return;
    const liked = likedSet.has(currentTrack.id);
    // Make player like buttons behave as regular track-like buttons
    if (miniLikeBtn) miniLikeBtn.dataset.likeId = currentTrack.id;
    if (fullLikeBtn) fullLikeBtn.dataset.likeId = currentTrack.id;
    setLikedUI(currentTrack.id, liked);
  }

  async function toggleLike(trackId) {
    try {
      const res = await fetch(`/api/like/${encodeURIComponent(trackId)}`, { method: 'POST' });
      const json = await res.json();
      if (!json?.ok) return;

      likedSet.clear();
      (json.likes || []).forEach(id => likedSet.add(id));

      setLikedUI(trackId, json.liked);
      refreshCurrentLikeUI();
    } catch (_) {}
  }

  function updateLinks() {
    if (!currentTrack) return;
    if (openTrackLink) openTrackLink.href = currentTrack.id ? `/track/${currentTrack.id}` : '#';
    if (fullTrackLink) fullTrackLink.href = currentTrack.id ? `/track/${currentTrack.id}` : '#';
    if (fullAuthorLink)
      fullAuthorLink.href = currentTrack.artistId ? `/author/${currentTrack.artistId}` : '#';
  }

  function seek(ev) {
    if (!audio.duration) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
    const pct = x / rect.width;
    audio.currentTime = pct * audio.duration;
  }

  async function playTrack(track) {
    currentTrack = track;

    audio.src = track.audio;
    if (miniCover) miniCover.src = track.cover;
    if (miniTitle) miniTitle.textContent = track.title;
    if (miniArtist) miniArtist.textContent = track.artist;

    if (fullCover) fullCover.src = track.cover;
    if (fullTitle) fullTitle.textContent = track.title;
    if (fullArtist) fullArtist.textContent = track.artist;

    updateLinks();
    refreshCurrentLikeUI();

    showBar();
    try {
      await audio.play();
      renderPlayPauseIcon(miniBtn, true);
      renderPlayPauseIcon(fullBtn, true);
    } catch (_) {
      renderPlayPauseIcon(miniBtn, false);
      renderPlayPauseIcon(fullBtn, false);
    }
  }

  function togglePlayPause() {
    if (!audio.src) return;
    if (audio.paused) {
      audio.play();
      renderPlayPauseIcon(miniBtn, true);
      renderPlayPauseIcon(fullBtn, true);
    } else {
      audio.pause();
      renderPlayPauseIcon(miniBtn, false);
      renderPlayPauseIcon(fullBtn, false);
    }
  }

  function openFull() {
    if (!full) return;
    if (!audio.src) return;
    full.classList.add('open');
    full.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
  }

  function closeFull() {
    if (!full) return;
    full.classList.remove('open');
    full.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
  }

  // --- Audio events ----------------------------------------------------------
  audio.addEventListener('timeupdate', () => {
    if (miniCur) miniCur.textContent = fmt(audio.currentTime);
    if (fullCur) fullCur.textContent = fmt(audio.currentTime);

    if (audio.duration) {
      if (miniDur) miniDur.textContent = fmt(audio.duration);
      if (fullDur) fullDur.textContent = fmt(audio.duration);
      const pct = (audio.currentTime / audio.duration) * 100;
      if (miniFill) miniFill.style.width = `${pct}%`;
      if (fullFill) fullFill.style.width = `${pct}%`;
    }
  });

  audio.addEventListener('ended', () => {
    renderPlayPauseIcon(miniBtn, false);
    renderPlayPauseIcon(fullBtn, false);
  });

  // --- UI events -------------------------------------------------------------
  // Play/Pause buttons
  miniBtn?.addEventListener('click', e => {
    e.stopPropagation();
    togglePlayPause();
  });
  fullBtn?.addEventListener('click', e => {
    e.stopPropagation();
    togglePlayPause();
  });

  // Progress seeking
  miniProgress?.addEventListener('click', e => {
    e.stopPropagation();
    seek(e);
  });
  fullProgress?.addEventListener('click', e => {
    e.stopPropagation();
    seek(e);
  });

  // Fullscreen open by clicking the bar
  bar?.addEventListener('click', e => {
    if (!audio.src) return;
    // Don't open when user clicks on interactive elements
    if (e.target.closest('button, a, input, textarea, select, label')) return;
    openFull();
  });

  // Close fullscreen
  full?.addEventListener('click', e => {
    const closeBtn = e.target.closest('[data-full-close]');
    if (closeBtn) {
      e.preventDefault();
      closeFull();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFull();
  });

  // Like buttons
  document.addEventListener('click', e => {
    const likeBtn = e.target.closest('[data-like-id]');
    if (!likeBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = likeBtn.getAttribute('data-like-id');
    if (id) toggleLike(id);
  });

  // Click on any element with data-play -> play
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-play]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      const track = JSON.parse(el.getAttribute('data-play'));
      playTrack(track);
    } catch (_) {}
  });

  // Prevent link clicks inside the playerbar from opening fullscreen
  openTrackLink?.addEventListener('click', e => e.stopPropagation());
  fullTrackLink?.addEventListener('click', e => e.stopPropagation());
  fullAuthorLink?.addEventListener('click', e => e.stopPropagation());

  // Like current track button (mini/full)
  miniLikeBtn?.addEventListener('click', e => {
    e.stopPropagation();
    if (currentTrack?.id) toggleLike(currentTrack.id);
  });
  fullLikeBtn?.addEventListener('click', e => {
    e.stopPropagation();
    if (currentTrack?.id) toggleLike(currentTrack.id);
  });

  if (bar) bar.style.display = 'none';
})();
