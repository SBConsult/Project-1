// Web copies of Steven's photographs.
//
// Rule from Steven: never change a photo. This file only resizes and re-encodes
// for the web. No cropping, no colour or tone changes, no sharpening. The ICC
// profile is kept so colour photos stay exactly as he made them. Location and
// other camera metadata are stripped; only the copyright notice is written back.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';

const PIPELINE_VERSION = '1';

const CAMERA_NAMES = {
  'FUJIFILM X100V': 'Fujifilm X100V',
  'FUJIFILM X100VI': 'Fujifilm X100VI',
  'LEICA CAMERA AG LEICA Q2 MONO': 'Leica Q2 Monochrom',
  'LEICA CAMERA AG LEICA Q3': 'Leica Q3',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'photo';
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function cameraName(make = '', model = '') {
  const key = `${make} ${model}`.trim().replace(/\s+/g, ' ');
  if (CAMERA_NAMES[key]) return CAMERA_NAMES[key];
  if (!key) return '';
  const m = titleCase(make.replace(/\b(CAMERA|CORPORATION|CO\.,?\s*LTD\.?|AG|INC\.?)\b/gi, '').trim());
  const mo = model.toUpperCase().startsWith(make.toUpperCase().split(' ')[0]) ? model : `${m} ${model}`;
  return mo.replace(/\s+/g, ' ').trim();
}

function shutter(t) {
  if (!t) return '';
  if (t >= 1) return `${Math.round(t * 10) / 10} s`;
  return `1/${Math.round(1 / t)} s`;
}

function describeExif(e = {}) {
  const d = e.DateTimeOriginal instanceof Date && !isNaN(e.DateTimeOriginal) ? e.DateTimeOriginal : null;
  const camera = cameraName(e.Make, e.Model);
  const settings = [
    e.FocalLength ? `${Math.round(e.FocalLength)} mm` : '',
    e.FNumber ? `f/${Math.round(e.FNumber * 10) / 10}` : '',
    shutter(e.ExposureTime),
    e.ISO ? `ISO ${e.ISO}` : '',
  ].filter(Boolean);
  return {
    year: d ? d.getUTCFullYear() : null,
    taken: d ? d.toISOString() : null,
    month: d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '',
    camera,
    settings: settings.join(' · '),
  };
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Make the web copies of one photograph.
 * Returns everything the templates need: size, srcset, blur placeholder, caption data.
 */
export async function processPhoto(srcPath, { outDir, cacheDir, widths, publicPrefix = 'img/', copyright }) {
  const buf = await fs.readFile(srcPath);
  const hash = createHash('sha1').update(buf).update(PIPELINE_VERSION).digest('hex').slice(0, 10);
  const name = path.basename(srcPath);
  const base = `${slugify(name)}.${hash}`;

  const meta = await sharp(buf).metadata();
  const rotated = (meta.orientation || 1) >= 5;
  const W = rotated ? meta.height : meta.width;
  const H = rotated ? meta.width : meta.height;

  const exif = await exifr
    .parse(buf, { pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal'] })
    .catch(() => ({})) || {};

  // Widths to produce: the configured steps below the original, plus the
  // original width itself when it is smaller than the largest step.
  const steps = widths.filter((w) => w < W);
  const largest = Math.min(W, widths[widths.length - 1]);
  if (!steps.includes(largest)) steps.push(largest);

  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });

  const sources = [];
  for (const w of steps) {
    const file = `${base}.${w}.webp`;
    const cached = path.join(cacheDir, file);
    if (!(await exists(cached))) {
      await sharp(buf)
        .rotate()
        .resize({ width: w, withoutEnlargement: true, kernel: 'lanczos3' })
        .keepIccProfile()
        .withExif({ IFD0: { Copyright: copyright, Artist: 'Steven Belin' } })
        .webp({ quality: 84, smartSubsample: true, effort: 5 })
        .toFile(cached);
    }
    await fs.copyFile(cached, path.join(outDir, file));
    sources.push({ w, url: publicPrefix + file });
  }

  // Tiny placeholder shown blurred while the real image loads.
  const lqipBuf = await sharp(buf).rotate().resize({ width: 24 }).webp({ quality: 45 }).toBuffer();
  const lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

  return {
    name,
    id: slugify(name),
    width: W,
    height: H,
    ratio: W / H,
    orientation: W / H > 1.08 ? 'landscape' : W / H < 0.92 ? 'portrait' : 'square',
    sources,
    src: sources[sources.length - 1].url,
    srcset: sources.map((s) => `${s.url} ${s.w}w`).join(', '),
    lqip,
    ...describeExif(exif),
  };
}

/** Run async jobs with a small concurrency limit (sharp already uses several threads per job). */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** A 1200 px JPEG of the opening photograph for link previews (social cards). */
export async function makeSocialImage(srcPath, outFile, copyright) {
  await sharp(await fs.readFile(srcPath))
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .keepIccProfile()
    .withExif({ IFD0: { Copyright: copyright, Artist: 'Steven Belin' } })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(outFile);
}
