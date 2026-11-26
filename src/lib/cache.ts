const DB_NAME = 'sadiq-al-muslim-db';
const STORE_NAME = 'kv';
const DB_VERSION = 1;
export const AUDIO_CACHE_NAME = 'sadiq-audio-v1';
export const MUSHAF_SVG_CACHE_NAME = 'sadiq-mushaf-svg-v1';
export const ALFURQAN_SVG_PAGE_BASE = 'https://alfurqan.online/api/v1/quran-text/page';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDB();
  if (!db) {
    try {
      const raw = localStorage.getItem(`idb_fb_${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  if (!db) {
    try {
      localStorage.setItem(`idb_fb_${key}`, JSON.stringify(value));
    } catch {
      // ignore quota exceeded in fallback
    }
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCacheStats(): Promise<{
  textEntries: number;
  audioEntries: number;
}> {
  let textEntries = 0;
  let audioEntries = 0;

  const db = await openDB();
  if (db) {
    textEntries = await new Promise<number>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  }

  if (typeof caches !== 'undefined') {
    try {
      const audioCache = await caches.open(AUDIO_CACHE_NAME);
      const audioKeys = await audioCache.keys();
      audioEntries = audioKeys.length;

      const svgCache = await caches.open(MUSHAF_SVG_CACHE_NAME);
      const svgKeys = await svgCache.keys();
      textEntries += svgKeys.length;
    } catch {
      // ignore
    }
  }

  return { textEntries, audioEntries };
}

export async function clearAllCaches(): Promise<void> {
  const db = await openDB();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  // Clear any fallback keys
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('idb_fb_')) toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }

  if (typeof caches !== 'undefined') {
    try {
      await caches.delete(AUDIO_CACHE_NAME);
      await caches.delete(MUSHAF_SVG_CACHE_NAME);
    } catch {
      // ignore
    }
  }
}

export function getMushafSvgRemoteUrl(page: number): string {
  const safePage = Math.max(1, Math.min(604, Math.floor(page)));
  return `${ALFURQAN_SVG_PAGE_BASE}/${safePage}`;
}

function extractSvgSubpathBBox(d: string): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} | null {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;

  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const pushPt = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z' || cmd === 'z') {
        cx = sx;
        cy = sy;
      }
      continue;
    }
    const nextNum = () => parseFloat(tokens[i++]);
    if (cmd === 'M' || cmd === 'L') {
      cx = nextNum();
      cy = nextNum();
      if (cmd === 'M') {
        sx = cx;
        sy = cy;
        cmd = 'L';
      }
      pushPt(cx, cy);
    } else if (cmd === 'm' || cmd === 'l') {
      cx += nextNum();
      cy += nextNum();
      if (cmd === 'm') {
        sx = cx;
        sy = cy;
        cmd = 'l';
      }
      pushPt(cx, cy);
    } else if (cmd === 'H') {
      cx = nextNum();
      pushPt(cx, cy);
    } else if (cmd === 'h') {
      cx += nextNum();
      pushPt(cx, cy);
    } else if (cmd === 'V') {
      cy = nextNum();
      pushPt(cx, cy);
    } else if (cmd === 'v') {
      cy += nextNum();
      pushPt(cx, cy);
    } else {
      i++;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * Pages 1 & 2 from Al-Furqan wrap their entire green ornamental border inside
 * `clipPath26` (212x299pt centered inside 383x547pt), leaving ~45% blank padding
 * inside the SVG's own 510x729 viewBox. Tightening the viewBox to that outer
 * frame (while preserving the 510.236/729.448 aspect ratio and keeping a small
 * safety margin) lets the page fill the full available viewport height cleanly.
 */
export function normalizeMushafSvgViewBox(svgText: string): string {
  const svgOpenMatch = svgText.match(/<svg\b[^>]*>/);
  if (!svgOpenMatch) return svgText;

  const vbMatch = svgOpenMatch[0].match(
    /\bviewBox\s*=\s*"\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*"/
  );
  if (!vbMatch) return svgText;

  const origW = parseFloat(vbMatch[3]);
  const origH = parseFloat(vbMatch[4]);
  if (!(origW > 0 && origH > 0)) return svgText;

  // Detect outer page-frame clipPath26 used on pages 1 & 2
  const clipMatch = svgText.match(
    /<clipPath\b[^>]*\bid="clipPath26"[^>]*>[\s\S]*?<path\b[^>]*\bd="([^"]+)"/
  );
  if (!clipMatch) return svgText;

  const ptBox = extractSvgSubpathBBox(clipMatch[1]);
  if (!ptBox) return svgText;

  // Read root Inkscape PDF-to-SVG matrix transform (typically 4/3, 0, 0, -4/3, 0, 729.448)
  const rootMatrixMatch = svgText.match(
    /<g\b[^>]*\bid="g10"[^>]*\btransform="matrix\(([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)\)"/
  );
  const sx = rootMatrixMatch ? parseFloat(rootMatrixMatch[1]) : 1.3333333;
  const sy = rootMatrixMatch ? parseFloat(rootMatrixMatch[4]) : -1.3333333;
  const tx = rootMatrixMatch ? parseFloat(rootMatrixMatch[5]) : 0;
  const ty = rootMatrixMatch ? parseFloat(rootMatrixMatch[6]) : origH;

  const x1 = ptBox.minX * sx + tx;
  const x2 = ptBox.maxX * sx + tx;
  const y1 = ptBox.minY * sy + ty;
  const y2 = ptBox.maxY * sy + ty;

  const frameMinX = Math.min(x1, x2);
  const frameMaxX = Math.max(x1, x2);
  const frameMinY = Math.min(y1, y2);
  const frameMaxY = Math.max(y1, y2);
  const frameW = frameMaxX - frameMinX;
  const frameH = frameMaxY - frameMinY;

  // Only normalize if this is a full-frame decorative box significantly smaller than the canvas
  if (frameW < 150 || frameH < 200 || (frameW > origW * 0.85 && frameH > origH * 0.85)) {
    return svgText;
  }

  const targetRatio = origW / origH;
  const padX = 2;
  let cropW = frameW + padX * 2;
  let cropH = cropW / targetRatio;
  if (cropH < frameH + 4) {
    cropH = frameH + 4;
    cropW = cropH * targetRatio;
  }

  const centerX = (frameMinX + frameMaxX) / 2;
  const centerY = (frameMinY + frameMaxY) / 2;
  const cropX = Math.max(0, centerX - cropW / 2);
  const cropY = Math.max(0, centerY - cropH / 2);

  const newViewBox = `${cropX.toFixed(2)} ${cropY.toFixed(2)} ${cropW.toFixed(2)} ${cropH.toFixed(2)}`;
  const updatedSvgOpen = svgOpenMatch[0].replace(
    /\bviewBox\s*=\s*"[^"]*"/,
    `viewBox="${newViewBox}"`
  );
  return svgText.replace(svgOpenMatch[0], updatedSvgOpen);
}

export async function fetchAndCacheMushafSvg(
  page: number
): Promise<{ objectUrl: string; fromCache: boolean }> {
  const safePage = Math.max(1, Math.min(604, Math.floor(page)));
  const url = getMushafSvgRemoteUrl(safePage);
  const idbKey = `mushaf_svg_page_${safePage}`;

  // 1. Check Cache API first
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MUSHAF_SVG_CACHE_NAME);
      const match = await cache.match(url);
      if (match) {
        const cachedText = await match.text();
        if (cachedText.includes('<svg')) {
          const normalizedBlob = new Blob([normalizeMushafSvgViewBox(cachedText)], {
            type: 'image/svg+xml',
          });
          return { objectUrl: URL.createObjectURL(normalizedBlob), fromCache: true };
        }
      }
    } catch {
      // fall through
    }
  }

  // 2. Check IndexedDB fallback
  const idbCachedText = await idbGet<string>(idbKey);
  if (idbCachedText && idbCachedText.includes('<svg')) {
    const blob = new Blob([normalizeMushafSvgViewBox(idbCachedText)], {
      type: 'image/svg+xml',
    });
    return { objectUrl: URL.createObjectURL(blob), fromCache: true };
  }

  // 3. Fetch live from Al Furqan API
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`تعذر تحميل صفحة المصحف (${res.status})`);
  }
  const svgText = await res.text();
  if (!svgText.includes('<svg')) {
    throw new Error('استجابة غير صالحة لصفحة المصحف');
  }

  const normalizedSvg = normalizeMushafSvgViewBox(svgText);
  const svgBlob = new Blob([normalizedSvg], { type: 'image/svg+xml' });

  // Store in Cache API
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MUSHAF_SVG_CACHE_NAME);
      await cache.put(
        url,
        new Response(svgBlob, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        })
      );
    } catch {
      await idbSet(idbKey, normalizedSvg);
    }
  } else {
    await idbSet(idbKey, normalizedSvg);
  }

  return { objectUrl: URL.createObjectURL(svgBlob), fromCache: false };
}

export async function preloadMushafSvg(page: number): Promise<void> {
  if (page < 1 || page > 604) return;
  const url = getMushafSvgRemoteUrl(page);
  const idbKey = `mushaf_svg_page_${page}`;

  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(MUSHAF_SVG_CACHE_NAME);
      const existing = await cache.match(url);
      if (existing) return;
    } else {
      const existingIdb = await idbGet<string>(idbKey);
      if (existingIdb) return;
    }

    const res = await fetch(url);
    if (!res.ok) return;
    const svgText = await res.text();
    if (!svgText.includes('<svg')) return;

    const normalizedSvg = normalizeMushafSvgViewBox(svgText);
    const svgBlob = new Blob([normalizedSvg], { type: 'image/svg+xml' });
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(MUSHAF_SVG_CACHE_NAME);
      await cache.put(
        url,
        new Response(svgBlob, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        })
      );
    } else {
      await idbSet(idbKey, normalizedSvg);
    }
  } catch {
    // Silent background preload failure
  }
}

export async function isAudioUrlCached(url: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const match = await cache.match(url);
    return Boolean(match);
  } catch {
    return false;
  }
}

export async function getCachedAudioObjectUrl(url: string): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const match = await cache.match(url);
    if (!match || match.type === 'opaque') return null;
    const blob = await match.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function cacheAndDownloadAudio(
  url: string,
  filename: string,
  triggerBrowserDownload: boolean,
  signal?: AbortSignal
): Promise<{ cached: boolean; downloaded: boolean }> {
  let cached = false;
  let downloaded = false;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const clone = res.clone();
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(AUDIO_CACHE_NAME);
      await cache.put(url, clone);
      cached = true;
    }

    if (triggerBrowserDownload) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      downloaded = true;
    }
    return { cached, downloaded };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    // Fallback if server blocks CORS for fetch: cache opaque response if possible & trigger anchor download
    if (typeof caches !== 'undefined') {
      try {
        const opaqueRes = await fetch(url, { mode: 'no-cors', signal });
        const cache = await caches.open(AUDIO_CACHE_NAME);
        await cache.put(url, opaqueRes);
        cached = true;
      } catch (innerErr: any) {
        if (innerErr?.name === 'AbortError') throw innerErr;
      }
    }
    if (triggerBrowserDownload) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      downloaded = true;
    }
    return { cached, downloaded };
  }
}
