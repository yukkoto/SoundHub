(() => {
  const body = document.body;
  const navToggle = document.getElementById('navToggle');
  const viewBtn = document.getElementById('toggleListView');
  const themeBtn = document.getElementById('toggleTheme');

  const palette = document.getElementById('palette');
  const paletteInput = document.getElementById('paletteInput');
  const paletteList = document.getElementById('paletteList');
  const paletteBtn = document.getElementById('openPalette');

  const savedView = localStorage.getItem('sh_view');
  const savedTheme = localStorage.getItem('sh_theme');

  if (savedView) body.dataset.listView = savedView;
  if (savedTheme) body.dataset.theme = savedTheme;

  function syncThemeButton() {
    if (!themeBtn) return;
    const isDark = body.dataset.theme === 'dark';
    themeBtn.textContent = isDark ? 'Light' : 'Dark';
    themeBtn.setAttribute('aria-label', isDark ? 'Включить светлую тему' : 'Включить тёмную тему');
    themeBtn.title = isDark ? 'Включить светлую тему' : 'Включить тёмную тему';
  }

  syncThemeButton();

  navToggle?.addEventListener('click', () => {
    body.classList.toggle('nav-open');
  });

  viewBtn?.addEventListener('click', () => {
    body.dataset.listView = body.dataset.listView === 'rows' ? 'cards' : 'rows';
    localStorage.setItem('sh_view', body.dataset.listView);
  });

  themeBtn?.addEventListener('click', () => {
    body.dataset.theme = body.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('sh_theme', body.dataset.theme);
    syncThemeButton();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1100) {
      body.classList.remove('nav-open');
    }
  });

  const sourceLinks = [...document.querySelectorAll('a[href]')]
    .map(a => ({
      title: (a.textContent || '').trim(),
      href: a.getAttribute('href') || '#',
      section: a.closest('.top-nav') ? 'Навигация' : 'Страница'
    }))
    .filter(item => item.title && item.href && item.href !== '#')
    .slice(0, 120);

  let activeIdx = 0;
  let filtered = sourceLinks;

  function renderPalette() {
    if (!paletteList) return;
    paletteList.innerHTML = '';
    filtered.forEach((item, idx) => {
      const node = document.createElement('a');
      node.className = 'palette-item' + (idx === activeIdx ? ' active' : '');
      node.href = item.href;
      node.innerHTML = `<strong>${item.title}</strong><small>${item.section} • ${item.href}</small>`;
      paletteList.appendChild(node);
    });
  }

  function openPalette() {
    if (!palette) return;
    palette.classList.add('open');
    palette.setAttribute('aria-hidden', 'false');
    activeIdx = 0;
    filtered = sourceLinks;
    renderPalette();
    setTimeout(() => paletteInput?.focus(), 0);
  }

  function closePalette() {
    if (!palette) return;
    palette.classList.remove('open');
    palette.setAttribute('aria-hidden', 'true');
  }

  paletteBtn?.addEventListener('click', openPalette);

  palette?.addEventListener('click', (e) => {
    if (e.target === palette) closePalette();
  });

  paletteInput?.addEventListener('input', () => {
    const q = paletteInput.value.trim().toLowerCase();
    filtered = sourceLinks.filter(item => item.title.toLowerCase().includes(q) || item.href.toLowerCase().includes(q));
    activeIdx = 0;
    renderPalette();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }

    if (!palette?.classList.contains('open')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!filtered.length) return;
      activeIdx = (activeIdx + 1) % filtered.length;
      renderPalette();
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
      renderPalette();
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[activeIdx];
      if (target?.href) window.location.href = target.href;
    }
  });
})();
