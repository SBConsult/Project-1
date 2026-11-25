// Builds the site.
//   node src/build.mjs            live site into dist/ (clean URLs, self-hosted fonts)
//   node src/build.mjs --preview  preview into preview/ (file links, inline CSS/JS, for the Artifact page)
//
// Input:
//   content/settings.json   site text (name, statement, About page, contact)
//   content/galleries.json  the series and their photos, in order (written by src/drive.mjs on the live site)
//   content/alt.json        optional descriptions of photos for screen readers and search engines
//   originals/              the photo files, exactly as Steven exported them

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processPhoto, mapLimit, makeSocialImage } from './images.mjs';
import { homePage, galleryPage, aboutPage, notFoundPage, makeLinks, yearsLabel, esc } from './templates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const MODE = args.has('--preview') ? 'preview' : 'production';
const OUT = path.join(ROOT, MODE === 'preview' ? 'preview' : 'dist');
const ORIGINALS = process.env.ORIGINALS_DIR ? path.resolve(process.env.ORIGINALS_DIR) : path.join(ROOT, 'originals');
const CACHE = path.join(ROOT, '.cache', 'img');
const WIDTHS = MODE === 'preview' ? [800, 1600, 2400] : [640, 1024, 1600, 2400];

const readJson = async (p, fallback) => {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
};
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

const settings = await readJson('content/settings.json');
const content = await readJson('content/galleries.json');
const alts = await readJson('content/alt.json', {});
const siteUrl = (process.env.SITE_URL || settings.siteUrl || '').replace(/\/?$/, '/');

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'img'), { recursive: true });

// 1. Photos -------------------------------------------------------------------
const onDisk = new Set(await fs.readdir(ORIGINALS).catch(() => []));
const wanted = [...new Set([content.opener, content.aboutPhoto, ...content.galleries.flatMap((g) => g.photos)].filter(Boolean))];
const missing = wanted.filter((f) => !onDisk.has(f));
if (missing.length) console.warn(`Skipping ${missing.length} photo(s) not found in originals/: ${missing.join(', ')}`);
const present = wanted.filter((f) => onDisk.has(f));

const photos = new Map();
await mapLimit(present, 3, async (name) => {
  const p = await processPhoto(path.join(ORIGINALS, name), {
    outDir: path.join(OUT, 'img'),
    cacheDir: CACHE,
    widths: WIDTHS,
    copyright: `© ${settings.name}`,
  });
  photos.set(name, p);
});

const describe = (name, gallery) => {
  const p = photos.get(name);
  return { ...p, alt: alts[name] || `Photograph from ${gallery ? gallery.title : 'the series'}${p.month ? `, ${p.month}` : ''}` };
};

const galleries = content.galleries
  .map((g) => ({ ...g, photos: g.photos.filter((f) => photos.has(f)).map((f) => describe(f, g)) }))
  .filter((g) => g.photos.length);
if (!galleries.length) throw new Error('No photographs found. Check originals/ and content/galleries.json.');
const openerName = photos.has(content.opener) ? content.opener : galleries[0].photos[0].name;
for (const g of galleries) {
  g.years = yearsLabel(g.photos.map((p) => p.year));
  // Cover: the chosen one, else the first photo that is not already the opening photograph on the home page.
  g.cover = (g.cover && g.photos.find((p) => p.name === g.cover)) || g.photos.find((p) => p.name !== openerName) || g.photos[0];
}

const openerGallery = galleries.find((g) => g.photos.some((p) => p.name === openerName)) || galleries[0];
const opener = describe(openerName, openerGallery);
const aboutName = photos.has(content.aboutPhoto) ? content.aboutPhoto : null;

// 2. Assets -------------------------------------------------------------------
let css = await fs.readFile(path.join(ROOT, 'src/assets/site.css'), 'utf8');
const js = await fs.readFile(path.join(ROOT, 'src/assets/site.js'), 'utf8');

let fontsHead;
let styleTag;
let scriptTag;
let headExtra = '';

if (MODE === 'preview') {
  fontsHead = [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=IBM+Plex+Mono:wght@400;500&display=swap">',
  ].join('\n');
  styleTag = `<style>\n${css}\n</style>`;
  scriptTag = `<script>\n${js}\n</script>`;
} else {
  // Fonts are served from the site itself: no requests to Google from visitors' browsers.
  const fontDir = path.join(OUT, 'assets', 'fonts');
  await fs.mkdir(fontDir, { recursive: true });
  const fonts = [
    ['@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2', 'archivo-latin.woff2'],
    ['@fontsource-variable/archivo/files/archivo-latin-ext-standard-normal.woff2', 'archivo-latin-ext.woff2'],
    ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ];
  for (const [from, to] of fonts) await fs.copyFile(path.join(ROOT, 'node_modules', from), path.join(fontDir, to));
  const latin = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const fontCss = `@font-face{font-family:"Archivo";font-style:normal;font-display:swap;font-weight:100 900;font-stretch:62% 125%;src:url(fonts/archivo-latin.woff2) format("woff2");unicode-range:${latin}}
@font-face{font-family:"Archivo";font-style:normal;font-display:swap;font-weight:100 900;font-stretch:62% 125%;src:url(fonts/archivo-latin-ext.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"IBM Plex Mono";font-style:normal;font-display:swap;font-weight:400;src:url(fonts/plex-mono-400.woff2) format("woff2")}
`;
  css = fontCss + css;
  const cssName = `site.${hash(css)}.css`;
  const jsName = `site.${hash(js)}.js`;
  await fs.writeFile(path.join(OUT, 'assets', cssName), css);
  await fs.writeFile(path.join(OUT, 'assets', jsName), js);
  fontsHead = '<link rel="preload" href="assets/fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin>';
  styleTag = `<link rel="stylesheet" href="assets/${cssName}">`;
  scriptTag = `<script src="assets/${jsName}" defer></script>`;

  await makeSocialImage(path.join(ORIGINALS, openerName), path.join(OUT, 'og.jpg'), `© ${settings.name}`);
  await fs.writeFile(
    path.join(OUT, 'favicon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#131313"/><circle cx="16" cy="16" r="5.5" fill="#f3f3f1"/></svg>\n'
  );
  headExtra = [
    '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
    '<meta name="theme-color" content="#f3f3f1" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#0f0f0e" media="(prefers-color-scheme: dark)">',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${esc(settings.name)}">`,
    siteUrl !== '/' ? `<meta property="og:image" content="${esc(siteUrl)}og.jpg">` : '<meta property="og:image" content="og.jpg">',
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n');
}

// 3. Pages --------------------------------------------------------------------
const ctx = {
  mode: MODE,
  settings,
  galleries,
  opener,
  openerGallery,
  aboutPhoto: aboutName ? describe(aboutName) : null,
  links: makeLinks(MODE === 'preview' ? '.html' : ''),
  year: new Date().getFullYear(),
  fontsHead,
  styleTag,
  scriptTag,
  headExtra,
};

const write = (file, html) => fs.writeFile(path.join(OUT, file), html);
await write('index.html', homePage(ctx));
for (const [i, g] of galleries.entries()) await write(`${g.slug}.html`, galleryPage(ctx, g, galleries[(i + 1) % galleries.length]));
await write('about.html', aboutPage(ctx));

if (MODE === 'production') {
  // 404 pages can be served at any depth, so they point at the site root explicitly.
  const base = siteUrl !== '/' ? new URL(siteUrl).pathname : '/';
  await write('404.html', notFoundPage(ctx).replace('<head>', `<head>\n<base href="${esc(base)}">`));
  await write('robots.txt', `User-agent: *\nAllow: /\n${siteUrl !== '/' ? `Sitemap: ${siteUrl}sitemap.xml\n` : ''}`);
  if (siteUrl !== '/') {
    const urls = ['', 'about', ...galleries.map((g) => g.slug)].map((u) => `<url><loc>${esc(siteUrl + u)}</loc></url>`);
    await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`);
  }
  await write('.nojekyll', '');
}

const fingerprint = process.env.CONTENT_FINGERPRINT || hash(JSON.stringify(content));
await write('version.json', JSON.stringify({ fingerprint, built: new Date().toISOString(), photos: photos.size }) + '\n');

const total = galleries.reduce((n, g) => n + g.photos.length, 0);
console.log(`Built ${MODE}: ${galleries.length} series, ${total} photographs, ${photos.size} files processed → ${path.relative(ROOT, OUT)}/`);
