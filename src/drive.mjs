// Reads Steven's Google Drive folder and turns it into the site's content.
//
//   DRIVE_FOLDER_ID=... node src/drive.mjs
//
// How the Drive folder maps to the site:
//   images/                      the root folder (DRIVE_FOLDER_ID)
//     01 Street/                 a gallery. "01 " sets the order and is not shown
//     05 Travels/                a folder that only holds folders is a group
//       Istria/                  a gallery in the group "Travels"
//     _Anything/                 folders starting with _ or . are ignored
//     loose photos               photos in the root are not published (an inbox)
//
// Photos in a gallery are shown in filename order. An optional Google Doc or .txt
// file in a gallery folder becomes the gallery's introduction.
//
// No API key is needed: the folder is shared "anyone with the link", so the
// public folder view and download endpoints are used. If DRIVE_API_KEY is set,
// the Drive API is used instead (more robust, same result).
//
// Writes content/galleries.json and downloads new photos to originals/.
// Prints the content fingerprint on the last line ("fingerprint=...") and,
// on GitHub Actions, sets it as a step output.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, mapLimit } from './images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINALS = process.env.ORIGINALS_DIR ? path.resolve(process.env.ORIGINALS_DIR) : path.join(ROOT, 'originals');
const FOLDER_ID = (process.env.DRIVE_FOLDER_ID || '').trim();
const API_KEY = (process.env.DRIVE_API_KEY || '').trim();
const IMAGE_RE = /\.(jpe?g|png|tiff?|webp|heic)$/i;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';

if (!FOLDER_ID) {
  console.error('DRIVE_FOLDER_ID is not set. Add it as a repository variable (Settings → Secrets and variables → Actions → Variables).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(url, opts = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', ...opts });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status} for ${url.replace(/key=[^&]+/, 'key=***')}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = e;
    }
    await sleep(800 * 2 ** i);
  }
  throw last;
}

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

// --- Listing ------------------------------------------------------------------

/** Keyless: the public embedded folder view lists every item with its id and name. */
async function listPublic(folderId) {
  const html = await (await fetchRetry(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`)).text();
  const items = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, id, href, rawName] = m;
    const name = decode(rawName.trim());
    let mimeType = 'application/octet-stream';
    if (/\/folders\//.test(href)) mimeType = FOLDER_MIME;
    else if (/docs\.google\.com\/document\//.test(href)) mimeType = DOC_MIME;
    else if (IMAGE_RE.test(name)) mimeType = 'image/jpeg';
    else if (/\.txt$/i.test(name)) mimeType = 'text/plain';
    items.push({ id, name, mimeType });
  }
  if (!items.length && !/flip-entry|flip-empty/.test(html)) {
    throw new Error(`Could not read Drive folder ${folderId}. Check that it is shared as "Anyone with the link".`);
  }
  return items;
}

async function listApi(folderId) {
  const items = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime)&pageSize=1000&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = await (await fetchRetry(url)).json();
    items.push(...data.files);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items;
}

const list = API_KEY ? listApi : listPublic;

async function readText(item) {
  try {
    const url =
      item.mimeType === DOC_MIME
        ? `https://docs.google.com/document/d/${item.id}/export?format=txt`
        : API_KEY
          ? `https://www.googleapis.com/drive/v3/files/${item.id}?alt=media&key=${API_KEY}`
          : `https://drive.usercontent.google.com/download?id=${item.id}&export=download&confirm=t`;
    return (await (await fetchRetry(url)).text()).replace(/^﻿/, '').trim();
  } catch (e) {
    console.warn(`Could not read text from "${item.name}": ${e.message}`);
    return '';
  }
}

// --- Structure ----------------------------------------------------------------

const naturalSort = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
const hidden = (name) => /^[_.]/.test(name);
const cleanTitle = (name) => name.replace(/^\s*\d+[\s._-]+/, '').trim() || name.trim();

async function readGallery(folder, group) {
  const items = (await list(folder.id)).sort(naturalSort);
  const photos = items.filter((i) => i.mimeType !== FOLDER_MIME && IMAGE_RE.test(i.name));
  const note = items.find((i) => i.mimeType === DOC_MIME || /\.txt$/i.test(i.name));
  return {
    folderName: folder.name,
    title: cleanTitle(folder.name),
    group,
    note,
    photos,
  };
}

const top = (await list(FOLDER_ID)).sort(naturalSort);
const galleries = [];
for (const item of top) {
  if (item.mimeType !== FOLDER_MIME || hidden(item.name)) continue;
  const children = (await list(item.id)).sort(naturalSort);
  const subfolders = children.filter((c) => c.mimeType === FOLDER_MIME && !hidden(c.name));
  const hasPhotos = children.some((c) => c.mimeType !== FOLDER_MIME && IMAGE_RE.test(c.name));
  if (subfolders.length && !hasPhotos) {
    for (const sub of subfolders) galleries.push(await readGallery(sub, cleanTitle(item.name)));
  } else {
    galleries.push(await readGallery(item, 'Series'));
  }
}

// --- Content ------------------------------------------------------------------

const readJson = async (p, fallback) => {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8')); } catch { return fallback; }
};
const settings = await readJson('content/settings.json', {});
const intros = await readJson('content/intros.json', {});

const used = new Set();
const out = [];
for (const g of galleries) {
  if (!g.photos.length) continue;
  let slug = slugify(g.title);
  while (used.has(slug)) slug += '-2';
  used.add(slug);
  const intro = (g.note && (await readText(g.note))) || intros[slug] || '';
  out.push({ slug, title: g.title, group: g.group, intro: intro.replace(/\s+/g, ' ').trim(), photos: g.photos.map((p) => p.name), _files: g.photos });
}
if (!out.length) throw new Error('No galleries with photos found in the Drive folder.');

const allNames = new Set(out.flatMap((g) => g.photos));
const content = {
  _note: 'Written by src/drive.mjs from the Google Drive folder. Do not edit by hand: change the folders in Drive instead.',
  opener: allNames.has(settings.opener) ? settings.opener : out[0].photos[0],
  aboutPhoto: allNames.has(settings.aboutPhoto) ? settings.aboutPhoto : null,
  galleries: out.map(({ _files, ...g }) => g),
};

// Same filename in two galleries is fine; the site uses one web copy for both.
const files = new Map();
for (const g of out) for (const f of g._files) if (!files.has(f.name)) files.set(f.name, f);

// --- Download -----------------------------------------------------------------

await fs.mkdir(ORIGINALS, { recursive: true });
const manifestPath = path.join(ORIGINALS, '.drive-manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8').catch(() => '{}'));
const versionOf = (f) => f.md5Checksum || f.modifiedTime || f.id;

let downloaded = 0;
const failed = [];
await mapLimit([...files.values()], 4, async (f) => {
  const dest = path.join(ORIGINALS, f.name);
  const have = await fs.stat(dest).then((s) => s.size > 0).catch(() => false);
  if (have && manifest[f.name] === versionOf(f)) return;
  const url = API_KEY
    ? `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${API_KEY}`
    : `https://drive.usercontent.google.com/download?id=${f.id}&export=download&confirm=t`;
  try {
    const res = await fetchRetry(url);
    const type = res.headers.get('content-type') || '';
    if (/text\/html/.test(type)) throw new Error('Drive returned a web page instead of the photo (is the file shared?)');
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(dest + '.part', buf);
    await fs.rename(dest + '.part', dest);
    manifest[f.name] = versionOf(f);
    downloaded++;
  } catch (e) {
    failed.push(`${f.name}: ${e.message}`);
  }
});
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

// Remove originals that are no longer in any gallery, so the cache stays small.
for (const name of await fs.readdir(ORIGINALS)) {
  if (name.startsWith('.')) continue;
  if (!files.has(name)) {
    await fs.rm(path.join(ORIGINALS, name), { force: true });
    delete manifest[name];
  }
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

if (failed.length) {
  console.warn(`Could not download ${failed.length} photo(s):\n  ${failed.join('\n  ')}`);
  if (failed.length === files.size) process.exit(1);
}

await fs.mkdir(path.join(ROOT, 'content'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'content/galleries.json'), JSON.stringify(content, null, 2) + '\n');

// The fingerprint changes whenever a gallery, a photo, its version or a text changes.
const fingerprint = createHash('sha1')
  .update(JSON.stringify({ content, versions: [...files.values()].map((f) => [f.id, versionOf(f)]), settings }))
  .update(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'))
  .digest('hex')
  .slice(0, 12);

const total = out.reduce((n, g) => n + g.photos.length, 0);
console.log(`Drive: ${out.length} galleries, ${total} photographs (${downloaded} downloaded, ${files.size - downloaded - failed.length} already here).`);
for (const g of out) console.log(`  ${g.group === 'Series' ? '' : g.group + ' / '}${g.title}: ${g.photos.length}`);
console.log(`fingerprint=${fingerprint}`);
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `fingerprint=${fingerprint}\n`);
