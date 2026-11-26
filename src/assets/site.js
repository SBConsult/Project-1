(() => {
  const d = document;
  const root = d.documentElement;
  root.classList.add('js');

  /* Photos fade in from their blurred placeholder once the file has arrived. */
  const reveal = (img) => img.classList.add('is-loaded');
  d.querySelectorAll('.ph img').forEach((img) => {
    if (img.complete && img.naturalWidth) reveal(img);
    else {
      img.addEventListener('load', () => reveal(img), { once: true });
      img.addEventListener('error', () => reveal(img), { once: true });
    }
  });

  /* Masthead steps out of the way while scrolling down, and comes back on the way up. */
  const mast = d.querySelector('[data-masthead]');
  if (mast) {
    let lastY = window.scrollY;
    let ticking = false;
    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = window.scrollY;
          if (y > 180 && y > lastY + 6) mast.classList.add('is-hidden');
          else if (y < lastY - 6 || y <= 180) mast.classList.remove('is-hidden');
          lastY = y;
          ticking = false;
        });
      },
      { passive: true }
    );
    mast.addEventListener('focusin', () => mast.classList.remove('is-hidden'));
  }

  /* "Back to top" scrolls instead of jumping. */
  d.querySelectorAll('[data-top]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    })
  );

  /* Photo viewer for series pages. */
  const dataEl = d.getElementById('photo-data');
  if (!dataEl) return;
  const data = JSON.parse(dataEl.textContent);
  const photos = data.photos;
  const n = photos.length;
  const pad = (k) => String(k).padStart(2, '0');
  const escapeText = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const lb = d.createElement('div');
  lb.className = 'lb';
  lb.hidden = true;
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', `${data.title}, photo viewer`);
  lb.innerHTML = `
    <div class="lb__bar">
      <span class="lb__title">${escapeText(data.title)}</span>
      <span class="lb__count" aria-live="polite"></span>
      <button type="button" class="lb__btn lb__close">Close</button>
    </div>
    <div class="lb__stage">
      <img class="lb__img" alt="" decoding="async" draggable="false">
      <button type="button" class="lb__zone lb__zone--prev" aria-label="Previous photograph"></button>
      <button type="button" class="lb__zone lb__zone--next" aria-label="Next photograph"></button>
    </div>
    <div class="lb__bar">
      <span class="lb__meta"></span>
      <span class="lb__nav"><button type="button" class="lb__btn lb__prev">Previous</button><button type="button" class="lb__btn lb__next">Next</button></span>
    </div>`;
  d.body.appendChild(lb);

  const $ = (s) => lb.querySelector(s);
  const img = $('.lb__img');
  const count = $('.lb__count');
  const meta = $('.lb__meta');
  const closeBtn = $('.lb__close');
  let idx = -1;
  let isOpen = false;
  let pushed = false;
  let lastFocus = null;
  let token = 0;

  const sizesFor = (p) => {
    const maxH = Math.max(200, window.innerHeight - 150);
    return `${Math.round(Math.min(window.innerWidth, (maxH * p.w) / p.h))}px`;
  };
  const preload = (i) => {
    const p = photos[(i + n) % n];
    const im = new Image();
    im.sizes = sizesFor(p);
    im.srcset = p.srcset;
    im.src = p.src;
  };

  function show(i) {
    idx = (i + n) % n;
    const p = photos[idx];
    const my = ++token;
    count.textContent = `${pad(idx + 1)} / ${pad(n)}`;
    meta.textContent = [p.month, p.camera].filter(Boolean).join('   ·   ');
    if (p.settings) {
      const s = d.createElement('span');
      s.className = 'lb__settings';
      s.textContent = `${p.month || p.camera ? '   ·   ' : ''}${p.settings}`;
      meta.appendChild(s);
    }
    img.classList.add('is-swapping');
    const next = new Image();
    next.sizes = sizesFor(p);
    next.srcset = p.srcset;
    next.src = p.src;
    const apply = () => {
      if (my !== token) return;
      img.width = p.w;
      img.height = p.h;
      img.sizes = next.sizes;
      img.srcset = p.srcset;
      img.src = p.src;
      img.alt = p.alt || '';
      requestAnimationFrame(() => img.classList.remove('is-swapping'));
    };
    const ready = next.decode ? next.decode() : Promise.resolve();
    // Never leave the viewer blank: swap after decode, or after 600 ms at the latest.
    Promise.race([ready, new Promise((r) => setTimeout(r, 600))]).then(apply, apply);
    preload(idx + 1);
    preload(idx - 1);
    if (isOpen) history.replaceState(history.state, '', `#p-${idx + 1}`);
  }

  function open(i, fromHash) {
    lastFocus = d.activeElement;
    lb.hidden = false;
    root.classList.add('lb-open');
    requestAnimationFrame(() => lb.classList.add('is-open'));
    if (!fromHash) {
      history.pushState({ viewer: true }, '', `#p-${((i % n) + n) % n + 1}`);
      pushed = true;
    }
    isOpen = true;
    show(i);
    closeBtn.focus({ preventScroll: true });
  }

  function closeUi() {
    if (!isOpen) return;
    isOpen = false;
    lb.classList.remove('is-open');
    root.classList.remove('lb-open');
    const at = idx;
    setTimeout(() => {
      if (!isOpen) lb.hidden = true;
    }, 300);
    const fig = d.getElementById(`p-${at + 1}`);
    if (fig) fig.scrollIntoView({ block: 'center' });
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function close() {
    if (pushed) {
      pushed = false;
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      closeUi();
    }
  }

  d.querySelectorAll('[data-index]').forEach((a) =>
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      open(Number(a.dataset.index));
    })
  );

  closeBtn.addEventListener('click', close);
  $('.lb__prev').addEventListener('click', () => show(idx - 1));
  $('.lb__next').addEventListener('click', () => show(idx + 1));
  $('.lb__zone--prev').addEventListener('click', () => show(idx - 1));
  $('.lb__zone--next').addEventListener('click', () => show(idx + 1));

  d.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(n - 1); }
    else if (e.key === 'Tab') {
      const f = [...lb.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* Swipe left or right on touch screens. */
  let sx = 0;
  let sy = 0;
  let st = 0;
  const stage = $('.lb__stage');
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = Date.now(); }, { passive: true });
  stage.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Date.now() - st < 700 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) show(idx + (dx < 0 ? 1 : -1));
  });

  const fromHash = () => {
    const m = /^#p-(\d+)$/.exec(location.hash);
    if (m && +m[1] >= 1 && +m[1] <= n) {
      if (!isOpen) open(+m[1] - 1, true);
      else show(+m[1] - 1);
    } else closeUi();
  };
  window.addEventListener('popstate', () => { pushed = false; fromHash(); });
  window.addEventListener('hashchange', fromHash);
  if (/^#p-\d+$/.test(location.hash)) fromHash();
})();
