// HTML for every page. Plain template strings, no framework.

export const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pad2 = (n) => String(n).padStart(2, '0');

export function yearsLabel(years) {
  const ys = years.filter(Boolean);
  if (!ys.length) return '';
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Links between pages. Preview builds use real file names; the live site uses clean URLs. */
export function makeLinks(ext) {
  return {
    home: ext ? 'index.html' : './',
    work: ext ? 'index.html#work' : './#work',
    about: `about${ext}`,
    gallery: (g) => `${g.slug}${ext}`,
    group: (g) => `${g.slug}${ext}`,
  };
}

/** One photograph in a placeholder box that keeps its exact proportions (nothing is cropped). */
function picture(p, { sizes, eager = false, priority = false, alt = '' }) {
  return `<div class="ph" style="--ar:${p.ratio.toFixed(5)};--lqip:url(${p.lqip})"><img src="${esc(p.sources[Math.min(1, p.sources.length - 1)].url)}" srcset="${esc(p.srcset)}" sizes="${esc(sizes)}" width="${p.width}" height="${p.height}" alt="${esc(alt)}" decoding="async"${eager ? '' : ' loading="lazy"'}${priority ? ' fetchpriority="high"' : ''}></div>`;
}

function masthead(ctx, current) {
  const L = ctx.links;
  return `<header class="masthead" data-masthead>
  <div class="masthead__inner">
    <a class="wordmark" href="${L.home}" aria-label="${esc(ctx.settings.name)}, home">${esc(ctx.settings.name)}</a>
    <nav class="nav" aria-label="Main">
      <a href="${L.work}"${current === 'work' ? ' aria-current="true"' : ''}>Work</a>
      <a href="${L.about}"${current === 'about' ? ' aria-current="page"' : ''}>About</a>
    </nav>
  </div>
</header>`;
}

function footer(ctx) {
  const s = ctx.settings;
  const links = [];
  if (s.contact?.instagram) links.push(`<a href="https://www.instagram.com/${esc(s.contact.instagram.replace(/^@/, ''))}/" rel="me noopener">Instagram</a>`);
  links.push(`<a href="#top" data-top>Back to top</a>`);
  return `<footer class="footer">
  <div class="wrap">
    <div class="footer__row">
      <p>© ${ctx.year} ${esc(s.name)}</p>
      <p class="footer__note">${esc(s.copyright)}</p>
      <p class="footer__links">${links.join('')}</p>
    </div>
  </div>
</footer>`;
}

/** Wraps a page body. In preview mode the home page is a fragment because the Artifact host adds the document skeleton. */
export function page(ctx, { title, description, body, pageId, current, fragment = false, extraHead = '' }) {
  const s = ctx.settings;
  const head = [
    `<title>${esc(title)}</title>`,
    fragment ? `<meta name="claude:viewport-fit-sides" content="cover">` : '',
    `<meta name="description" content="${esc(description || s.description)}">`,
    ctx.headExtra || '',
    extraHead,
    ctx.fontsHead,
    ctx.styleTag,
    `<script>document.documentElement.classList.add('js')</script>`,
  ]
    .filter(Boolean)
    .join('\n');

  const content = `<div class="site" id="top" data-page="${pageId}">
<a class="skip" href="#main">Skip to content</a>
${masthead(ctx, current)}
${body}
${footer(ctx)}
</div>
${ctx.scriptTag}`;

  if (fragment) return `${head}\n${content}\n`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${content}
</body>
</html>
`;
}

export function homePage(ctx) {
  const { opener, openerGallery, galleries, settings: s, links: L } = ctx;
  const total = galleries.reduce((n, g) => n + g.photos.length, 0);
  const years = yearsLabel(galleries.flatMap((g) => g.photos.map((p) => p.year)));

  const heroSizes = `(min-width: 800px) min(1440px, calc(76vh * ${opener.ratio.toFixed(3)})), 100vw`;
  const hero = `<section class="hero" aria-label="Opening photograph">
  <figure class="hero__figure" style="--ar:${opener.ratio.toFixed(5)}">
    <a class="hero__link" href="${L.gallery(openerGallery)}">${picture(opener, { sizes: heroSizes, eager: true, priority: true, alt: opener.alt })}</a>
    <figcaption class="cap"><span>${esc(opener.month)}</span><a href="${L.gallery(openerGallery)}">From the series ${esc(openerGallery.title)}</a></figcaption>
  </figure>
</section>`;

  const intro = `<section class="intro wrap">
  <p class="eyebrow">Photographs ${esc(years)}</p>
  <p class="lead">${esc(s.statement)}</p>
</section>`;

  const cards = cardsGrid(ctx, ctx.entries);

  const work = `<section class="work wrap" id="work" aria-labelledby="work-title">
  <div class="section-head">
    <h2 class="eyebrow" id="work-title">Work</h2>
    <p class="eyebrow">${plural(galleries.length, 'series', 'series')} · ${plural(total, 'photograph', 'photographs')}</p>
  </div>
  <div class="cards">
    ${cards}
  </div>
</section>`;

  return page(ctx, {
    title: `${s.name} Photography`,
    description: s.description,
    pageId: 'home',
    current: '',
    fragment: ctx.mode === 'preview',
    body: `<main id="main">\n${hero}\n${intro}\n${work}\n</main>`,
  });
}

/** Cover card for a series or a collection, used on the home page and collection pages. */
function cardsGrid(ctx, items) {
  const L = ctx.links;
  const card = (g, i) => {
    const c = g.cover;
    const sizes = `(min-width: 760px) ${c.orientation === 'landscape' ? 46 : c.orientation === 'square' ? 40 : 35}vw, 100vw`;
    const meta = g.kind === 'group'
      ? [`Collection`, g.years, plural(g.galleries.length, 'series', 'series')]
      : [g.group || 'Series', g.years, plural(g.photos.length, 'photograph', 'photographs')];
    return `<article class="card card--${c.orientation}" style="--i:${i}">
        <a class="card__link" href="${g.kind === 'group' ? L.group(g) : L.gallery(g)}">
          ${picture(c, { sizes, eager: i < 2, alt: c.alt })}
          <span class="card__text">
            <span class="card__title">${esc(g.title)}<span class="arrow" aria-hidden="true">→</span></span>
            <span class="card__meta">${meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('')}</span>
          </span>
        </a>
      </article>`;
  };
  const col = (side) =>
    `<div class="cards__col cards__col--${side}">\n      ${items
      .map((g, i) => [g, i])
      .filter(([, i]) => (side === 'left' ? i % 2 === 0 : i % 2 === 1))
      .map(([g, i]) => card(g, i))
      .join('\n      ')}\n    </div>`;
  return `${col('left')}\n    ${col('right')}`;
}

/** A collection (a Drive folder of folders, e.g. Travels): its series as cards. */
export function groupPage(ctx, grp) {
  const total = grp.galleries.reduce((n, g) => n + g.photos.length, 0);
  const body = `<main id="main" class="gallery">
<header class="ghead wrap">
  <p class="eyebrow">Collection</p>
  <h1 class="display">${esc(grp.title)}</h1>
  <div class="ghead__row">
    ${grp.intro ? `<p class="ghead__intro">${esc(grp.intro)}</p>` : '<span></span>'}
    <dl class="facts"><div><dt>Series</dt><dd>${grp.galleries.length}</dd></div><div><dt>Photographs</dt><dd>${total}</dd></div><div><dt>Years</dt><dd>${esc(grp.years)}</dd></div></dl>
  </div>
</header>
<section class="work work--group wrap" aria-label="${esc(grp.title)}">
  <div class="cards">
    ${cardsGrid(ctx, grp.galleries)}
  </div>
</section>
</main>`;
  return page(ctx, {
    title: `${grp.title} · ${ctx.settings.name}`,
    description: grp.intro || ctx.settings.description,
    pageId: 'group',
    current: 'work',
    body,
  });
}

/** Group photographs into rows: two portraits in a row sit side by side, everything else gets a row of its own. */
function rows(photos) {
  const out = [];
  for (let i = 0; i < photos.length; i++) {
    const a = photos[i];
    const b = photos[i + 1];
    if (b && a.orientation === 'portrait' && b.orientation === 'portrait' && i !== 0) {
      out.push([a, b]);
      i++;
    } else out.push([a]);
  }
  return out;
}

export function galleryPage(ctx, g, next) {
  const { links: L } = ctx;
  const n = g.photos.length;
  const cameras = [...new Set(g.photos.map((p) => p.camera).filter(Boolean))];

  const figure = (p, inPair) => {
    const i = g.photos.indexOf(p);
    const sizes = inPair
      ? `(min-width: 760px) min(46vw, calc(86vh * ${p.ratio.toFixed(3)})), 100vw`
      : `(min-width: 760px) min(1440px, calc(86vh * ${p.ratio.toFixed(3)})), 100vw`;
    return `<figure class="photo" style="--ar:${p.ratio.toFixed(5)}" id="p-${i + 1}">
        <a class="photo__link" href="${esc(p.src)}" data-index="${i}" aria-label="Open photograph ${i + 1} of ${n} in the viewer">${picture(p, { sizes, eager: i === 0, priority: i === 0, alt: p.alt })}</a>
        <figcaption class="cap"><span class="cap__num">${pad2(i + 1)}</span><span>${esc(p.month)}</span></figcaption>
      </figure>`;
  };

  const sequence = rows(g.photos)
    .map((r) => `<li class="row${r.length === 2 ? ' row--pair' : ''}">\n      ${r.map((p) => figure(p, r.length === 2)).join('\n      ')}\n    </li>`)
    .join('\n    ');

  const facts = [
    ['Photographs', String(n)],
    ['Years', g.years],
    cameras.length ? [cameras.length === 1 ? 'Camera' : 'Cameras', cameras.join(', ')] : null,
  ]
    .filter(Boolean)
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');

  const nextBlock = next
    ? `<nav class="next wrap" aria-label="Next series">
  <a class="next__link" href="${L.gallery(next)}">
    <span class="eyebrow next__label">Next</span>
    <span class="next__title">${esc(next.title)}<span class="arrow" aria-hidden="true">→</span></span>
    <span class="next__img">${picture(next.cover, { sizes: '(min-width: 760px) 22vw, 40vw', alt: '' })}</span>
  </a>
</nav>`
    : '';

  const data = {
    title: g.title,
    photos: g.photos.map((p) => ({
      src: p.src,
      srcset: p.srcset,
      w: p.width,
      h: p.height,
      alt: p.alt,
      month: p.month,
      camera: p.camera,
      settings: p.settings,
    })),
  };

  const body = `<main id="main" class="gallery">
<header class="ghead wrap">
  <p class="eyebrow">${g.parent ? `<a href="${L.group(g.parent)}">← ${esc(g.parent.title)}</a>` : esc(g.group || 'Series')}</p>
  <h1 class="display">${esc(g.title)}</h1>
  <div class="ghead__row">
    ${g.intro ? `<p class="ghead__intro">${esc(g.intro)}</p>` : '<span></span>'}
    <dl class="facts">${facts}</dl>
  </div>
</header>
<ol class="sequence wrap" aria-label="${esc(g.title)}, ${n} photographs">
    ${sequence}
</ol>
${nextBlock}
</main>
<script type="application/json" id="photo-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

  return page(ctx, {
    title: `${g.title} · ${ctx.settings.name}`,
    description: g.intro || ctx.settings.description,
    pageId: 'gallery',
    current: 'work',
    body,
  });
}

export function aboutPage(ctx) {
  const { settings: s, galleries, links: L, aboutPhoto } = ctx;
  const cameras = [...new Set(galleries.flatMap((g) => g.photos.map((p) => p.camera)).filter(Boolean))];
  const contact = s.contact?.email
    ? `<a href="mailto:${esc(s.contact.email)}">${esc(s.contact.email)}</a>`
    : 'Email address to be added';

  const body = `<main id="main" class="about wrap">
  <h1 class="display about__title">About</h1>
  <div class="about__grid">
    ${aboutPhoto ? `<figure class="about__photo" style="--ar:${aboutPhoto.ratio.toFixed(5)}">${picture(aboutPhoto, { sizes: '(min-width: 900px) 34vw, 100vw', alt: aboutPhoto.alt })}<figcaption class="cap"><span>${esc(aboutPhoto.month)}</span><span>${esc(aboutPhoto.camera)}</span></figcaption></figure>` : ''}
    <div class="about__text">
      ${s.about.map((t) => `<p>${esc(t)}</p>`).join('\n      ')}
      <dl class="facts">
        <div><dt>Series</dt><dd>${galleries.map((g) => `<a href="${L.gallery(g)}">${esc(g.title)}</a>`).join(', ')}</dd></div>
        ${cameras.length ? `<div><dt>Cameras</dt><dd>${esc(cameras.join(', '))}</dd></div>` : ''}
        <div><dt>Prints and enquiries</dt><dd>${contact}</dd></div>
      </dl>
    </div>
  </div>
</main>`;

  return page(ctx, { title: `About · ${s.name}`, description: s.description, pageId: 'about', current: 'about', body });
}

export function notFoundPage(ctx) {
  const body = `<main id="main" class="notfound wrap">
  <p class="eyebrow">404</p>
  <h1 class="display">Nothing here</h1>
  <p class="lead">The page you asked for has moved or never existed. <a href="${ctx.links.home}">Back to the photographs</a>.</p>
</main>`;
  return page(ctx, { title: `Not found · ${ctx.settings.name}`, pageId: 'notfound', current: '', body });
}
