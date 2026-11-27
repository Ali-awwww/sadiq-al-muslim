const DB_NAME = 'sadiq-al-muslim-db';
const STORE_NAME = 'kv';
const DB_VERSION = 2;
export const AUDIO_CACHE_NAME = 'sadiq-audio-v1';
export const MUSHAF_SVG_CACHE_NAME = 'sadiq-mushaf-svg-v2';
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
      await caches.delete('sadiq-mushaf-svg-v1');
    } catch {
      // ignore
    }
  }
}

export function getMushafSvgRemoteUrl(page: number): string {
  const safePage = Math.max(1, Math.min(604, Math.floor(page)));
  return `${ALFURQAN_SVG_PAGE_BASE}/${safePage}`;
}

const MUSHAF_TARGET_ASPECT_RATIO = 510.236 / 729.448;

type SvgBBox = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type Matrix2D = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

function multiplyMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function parseSvgTransform(transformStr: string | null | undefined): Matrix2D {
  let result: Matrix2D = IDENTITY_MATRIX;
  if (!transformStr) return result;

  const fnRegex = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = fnRegex.exec(transformStr)) !== null) {
    const fn = match[1].toLowerCase();
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    let local: Matrix2D = IDENTITY_MATRIX;

    if (fn === 'matrix' && nums.length >= 6) {
      local = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    } else if (fn === 'translate' && nums.length >= 1) {
      local = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (fn === 'scale' && nums.length >= 1) {
      local = [nums[0], 0, 0, nums[1] ?? nums[0], 0, 0];
    } else if (fn === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (nums.length >= 3) {
        const cx = nums[1];
        const cy = nums[2];
        local = multiplyMatrices(
          [1, 0, 0, 1, cx, cy],
          multiplyMatrices([cos, sin, -sin, cos, 0, 0], [1, 0, 0, 1, -cx, -cy])
        );
      } else {
        local = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (fn === 'skewx' && nums.length >= 1) {
      local = [1, 0, Math.tan((nums[0] * Math.PI) / 180), 1, 0, 0];
    } else if (fn === 'skewy' && nums.length >= 1) {
      local = [1, Math.tan((nums[0] * Math.PI) / 180), 0, 1, 0, 0];
    }

    result = multiplyMatrices(result, local);
  }
  return result;
}

function cubicExtrema1D(p0: number, p1: number, p2: number, p3: number): [number, number] {
  let min = Math.min(p0, p3);
  let max = Math.max(p0, p3);

  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);

  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }

  for (const t of roots) {
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      const v =
        mt * mt * mt * p0 +
        3 * mt * mt * t * p1 +
        3 * mt * t * t * p2 +
        t * t * t * p3;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return [min, max];
}

function quadExtrema1D(p0: number, p1: number, p2: number): [number, number] {
  let min = Math.min(p0, p2);
  let max = Math.max(p0, p2);
  const denom = p0 - 2 * p1 + p2;
  if (Math.abs(denom) > 1e-12) {
    const t = (p0 - p1) / denom;
    if (t > 0 && t < 1) {
      const mt = 1 - t;
      const v = mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return [min, max];
}

function extractSvgPathBBox(d: string): SvgBBox | null {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) return null;

  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastC2x = 0;
  let lastC2y = 0;
  let lastQx = 0;
  let lastQy = 0;
  let prevCmd = '';
  let cmd = '';
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const pushPt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  const nextNum = (): number => {
    const v = parseFloat(tokens[i++]);
    return Number.isFinite(v) ? v : 0;
  };

  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z' || cmd === 'z') {
        cx = sx;
        cy = sy;
        prevCmd = cmd;
      }
      continue;
    }

    if (cmd === 'M' || cmd === 'L') {
      cx = nextNum();
      cy = nextNum();
      if (cmd === 'M') {
        sx = cx;
        sy = cy;
        cmd = 'L';
      }
      pushPt(cx, cy);
      prevCmd = cmd;
    } else if (cmd === 'm' || cmd === 'l') {
      cx += nextNum();
      cy += nextNum();
      if (cmd === 'm') {
        sx = cx;
        sy = cy;
        cmd = 'l';
      }
      pushPt(cx, cy);
      prevCmd = cmd;
    } else if (cmd === 'H') {
      cx = nextNum();
      pushPt(cx, cy);
      prevCmd = cmd;
    } else if (cmd === 'h') {
      cx += nextNum();
      pushPt(cx, cy);
      prevCmd = cmd;
    } else if (cmd === 'V') {
      cy = nextNum();
      pushPt(cx, cy);
      prevCmd = cmd;
    } else if (cmd === 'v') {
      cy += nextNum();
      pushPt(cx, cy);
      prevCmd = cmd;
    } else if (cmd === 'C' || cmd === 'c') {
      const rel = cmd === 'c';
      const x1 = (rel ? cx : 0) + nextNum();
      const y1 = (rel ? cy : 0) + nextNum();
      const x2 = (rel ? cx : 0) + nextNum();
      const y2 = (rel ? cy : 0) + nextNum();
      const x = (rel ? cx : 0) + nextNum();
      const y = (rel ? cy : 0) + nextNum();
      const [ex0, ex1] = cubicExtrema1D(cx, x1, x2, x);
      const [ey0, ey1] = cubicExtrema1D(cy, y1, y2, y);
      pushPt(ex0, ey0);
      pushPt(ex1, ey1);
      lastC2x = x2;
      lastC2y = y2;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (cmd === 'S' || cmd === 's') {
      const rel = cmd === 's';
      const hasPrevC = prevCmd === 'C' || prevCmd === 'c' || prevCmd === 'S' || prevCmd === 's';
      const x1 = hasPrevC ? 2 * cx - lastC2x : cx;
      const y1 = hasPrevC ? 2 * cy - lastC2y : cy;
      const x2 = (rel ? cx : 0) + nextNum();
      const y2 = (rel ? cy : 0) + nextNum();
      const x = (rel ? cx : 0) + nextNum();
      const y = (rel ? cy : 0) + nextNum();
      const [ex0, ex1] = cubicExtrema1D(cx, x1, x2, x);
      const [ey0, ey1] = cubicExtrema1D(cy, y1, y2, y);
      pushPt(ex0, ey0);
      pushPt(ex1, ey1);
      lastC2x = x2;
      lastC2y = y2;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (cmd === 'Q' || cmd === 'q') {
      const rel = cmd === 'q';
      const x1 = (rel ? cx : 0) + nextNum();
      const y1 = (rel ? cy : 0) + nextNum();
      const x = (rel ? cx : 0) + nextNum();
      const y = (rel ? cy : 0) + nextNum();
      const [ex0, ex1] = quadExtrema1D(cx, x1, x);
      const [ey0, ey1] = quadExtrema1D(cy, y1, y);
      pushPt(ex0, ey0);
      pushPt(ex1, ey1);
      lastQx = x1;
      lastQy = y1;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (cmd === 'T' || cmd === 't') {
      const rel = cmd === 't';
      const hasPrevQ = prevCmd === 'Q' || prevCmd === 'q' || prevCmd === 'T' || prevCmd === 't';
      const x1 = hasPrevQ ? 2 * cx - lastQx : cx;
      const y1 = hasPrevQ ? 2 * cy - lastQy : cy;
      const x = (rel ? cx : 0) + nextNum();
      const y = (rel ? cy : 0) + nextNum();
      const [ex0, ex1] = quadExtrema1D(cx, x1, x);
      const [ey0, ey1] = quadExtrema1D(cy, y1, y);
      pushPt(ex0, ey0);
      pushPt(ex1, ey1);
      lastQx = x1;
      lastQy = y1;
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else if (cmd === 'A' || cmd === 'a') {
      const rel = cmd === 'a';
      nextNum();
      nextNum();
      nextNum();
      nextNum();
      nextNum();
      const x = (rel ? cx : 0) + nextNum();
      const y = (rel ? cy : 0) + nextNum();
      pushPt(cx, cy);
      pushPt(x, y);
      cx = x;
      cy = y;
      prevCmd = cmd;
    } else {
      i++;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

function getAttrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = attrs.match(re);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

function getStyleProp(style: string | null, prop: string): string | null {
  if (!style) return null;
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  const m = style.match(re);
  return m ? m[1].trim().toLowerCase() : null;
}

function isHiddenOrBackgroundElement(
  attrs: string,
  transformedW: number,
  transformedH: number,
  origW: number,
  origH: number
): boolean {
  const style = getAttrValue(attrs, 'style');
  const display = getStyleProp(style, 'display') ?? getAttrValue(attrs, 'display')?.toLowerCase();
  const visibility =
    getStyleProp(style, 'visibility') ?? getAttrValue(attrs, 'visibility')?.toLowerCase();
  const opacity = getStyleProp(style, 'opacity') ?? getAttrValue(attrs, 'opacity');
  if (display === 'none' || visibility === 'hidden' || opacity === '0') {
    return true;
  }

  const fill = (getStyleProp(style, 'fill') ?? getAttrValue(attrs, 'fill') ?? '').toLowerCase();
  const stroke = (
    getStyleProp(style, 'stroke') ??
    getAttrValue(attrs, 'stroke') ??
    ''
  ).toLowerCase();

  if (fill === 'none' && (stroke === '' || stroke === 'none')) {
    return true;
  }

  const coversWholeCanvas = transformedW >= origW * 0.98 && transformedH >= origH * 0.98;
  if (
    coversWholeCanvas &&
    (fill === '#ffffff' ||
      fill === '#fff' ||
      fill === 'white' ||
      fill === 'rgb(255,255,255)' ||
      fill === 'none') &&
    (stroke === '' || stroke === 'none')
  ) {
    return true;
  }

  return false;
}

const SVG_SKIP_CONTAINERS = new Set([
  'defs',
  'clippath',
  'mask',
  'pattern',
  'symbol',
  'metadata',
  'style',
  'script',
]);

function computeSvgContentBBox(
  svgText: string,
  origW: number,
  origH: number
): SvgBBox | null {
  const skipStack: string[] = [];
  const transformStack: Matrix2D[] = [IDENTITY_MATRIX];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const tagRegex = /<(\/?)([a-zA-Z0-9:_-]+)([^>]*?)(\/?)>/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(svgText)) !== null) {
    const isClose = tagMatch[1] === '/';
    const rawName = tagMatch[2];
    const name = rawName.toLowerCase();
    const attrs = tagMatch[3];
    const selfClose = tagMatch[4] === '/';

    if (isClose) {
      if (SVG_SKIP_CONTAINERS.has(name) && skipStack.length > 0 && skipStack[skipStack.length - 1] === name) {
        skipStack.pop();
      } else if (skipStack.length === 0 && name === 'g' && transformStack.length > 1) {
        transformStack.pop();
      }
      continue;
    }

    if (SVG_SKIP_CONTAINERS.has(name)) {
      if (!selfClose) {
        skipStack.push(name);
      }
      continue;
    }

    if (skipStack.length > 0) {
      continue;
    }

    const parentMatrix = transformStack[transformStack.length - 1];
    const localTransform = getAttrValue(attrs, 'transform');
    const currentMatrix = localTransform
      ? multiplyMatrices(parentMatrix, parseSvgTransform(localTransform))
      : parentMatrix;

    if (name === 'g' || name === 'svg') {
      if (!selfClose && name === 'g') {
        transformStack.push(currentMatrix);
      }
      continue;
    }

    let localBox: SvgBBox | null = null;

    if (name === 'path') {
      const d = getAttrValue(attrs, 'd');
      if (d) {
        localBox = extractSvgPathBBox(d);
      }
    } else if (name === 'rect') {
      const x = parseFloat(getAttrValue(attrs, 'x') ?? '0');
      const y = parseFloat(getAttrValue(attrs, 'y') ?? '0');
      const w = parseFloat(getAttrValue(attrs, 'width') ?? '0');
      const h = parseFloat(getAttrValue(attrs, 'height') ?? '0');
      if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
        localBox = { minX: x, maxX: x + w, minY: y, maxY: y + h };
      }
    } else if (name === 'circle') {
      const cx = parseFloat(getAttrValue(attrs, 'cx') ?? '0');
      const cy = parseFloat(getAttrValue(attrs, 'cy') ?? '0');
      const r = parseFloat(getAttrValue(attrs, 'r') ?? '0');
      if (Number.isFinite(cx) && Number.isFinite(cy) && r > 0) {
        localBox = { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r };
      }
    } else if (name === 'ellipse') {
      const cx = parseFloat(getAttrValue(attrs, 'cx') ?? '0');
      const cy = parseFloat(getAttrValue(attrs, 'cy') ?? '0');
      const rx = parseFloat(getAttrValue(attrs, 'rx') ?? '0');
      const ry = parseFloat(getAttrValue(attrs, 'ry') ?? '0');
      if (Number.isFinite(cx) && Number.isFinite(cy) && rx > 0 && ry > 0) {
        localBox = { minX: cx - rx, maxX: cx + rx, minY: cy - ry, maxY: cy + ry };
      }
    } else if (name === 'line') {
      const x1 = parseFloat(getAttrValue(attrs, 'x1') ?? '0');
      const y1 = parseFloat(getAttrValue(attrs, 'y1') ?? '0');
      const x2 = parseFloat(getAttrValue(attrs, 'x2') ?? '0');
      const y2 = parseFloat(getAttrValue(attrs, 'y2') ?? '0');
      if (
        Number.isFinite(x1) &&
        Number.isFinite(y1) &&
        Number.isFinite(x2) &&
        Number.isFinite(y2)
      ) {
        localBox = {
          minX: Math.min(x1, x2),
          maxX: Math.max(x1, x2),
          minY: Math.min(y1, y2),
          maxY: Math.max(y1, y2),
        };
      }
    } else if (name === 'polygon' || name === 'polyline') {
      const pts = (getAttrValue(attrs, 'points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (pts.length >= 2) {
        let pMinX = Infinity;
        let pMaxX = -Infinity;
        let pMinY = Infinity;
        let pMaxY = -Infinity;
        for (let k = 0; k + 1 < pts.length; k += 2) {
          const px = pts[k];
          const py = pts[k + 1];
          if (Number.isFinite(px) && Number.isFinite(py)) {
            if (px < pMinX) pMinX = px;
            if (px > pMaxX) pMaxX = px;
            if (py < pMinY) pMinY = py;
            if (py > pMaxY) pMaxY = py;
          }
        }
        if (Number.isFinite(pMinX) && Number.isFinite(pMinY)) {
          localBox = { minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY };
        }
      }
    }

    if (!localBox) continue;

    const corners: [number, number][] = [
      [localBox.minX, localBox.minY],
      [localBox.maxX, localBox.minY],
      [localBox.minX, localBox.maxY],
      [localBox.maxX, localBox.maxY],
    ];

    let elMinX = Infinity;
    let elMaxX = -Infinity;
    let elMinY = Infinity;
    let elMaxY = -Infinity;
    for (const [lx, ly] of corners) {
      const tx = currentMatrix[0] * lx + currentMatrix[2] * ly + currentMatrix[4];
      const ty = currentMatrix[1] * lx + currentMatrix[3] * ly + currentMatrix[5];
      if (tx < elMinX) elMinX = tx;
      if (tx > elMaxX) elMaxX = tx;
      if (ty < elMinY) elMinY = ty;
      if (ty > elMaxY) elMaxY = ty;
    }

    if (
      !Number.isFinite(elMinX) ||
      !Number.isFinite(elMaxX) ||
      !Number.isFinite(elMinY) ||
      !Number.isFinite(elMaxY)
    ) {
      continue;
    }

    if (isHiddenOrBackgroundElement(attrs, elMaxX - elMinX, elMaxY - elMinY, origW, origH)) {
      continue;
    }

    if (elMinX < minX) minX = elMinX;
    if (elMaxX > maxX) maxX = elMaxX;
    if (elMinY < minY) minY = elMinY;
    if (elMaxY > maxY) maxY = elMaxY;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * Tightens any Al-Furqan Mushaf SVG's viewBox to the true bounding box of its
 * drawn content (green ornamental frame + text/headers), while preserving the
 * 510.236/729.448 aspect ratio centered on the content with a small safety
 * margin. Falls back to the original SVG unchanged if no valid content box
 * can be computed.
 */
export function normalizeMushafSvgViewBox(svgText: string): string {
  try {
    const svgOpenMatch = svgText.match(/<svg\b[^>]*>/);
    if (!svgOpenMatch) return svgText;

    const vbAttrMatch = svgOpenMatch[0].match(/\bviewBox\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    if (!vbAttrMatch) return svgText;

    const vbParts = (vbAttrMatch[1] ?? vbAttrMatch[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (vbParts.length !== 4 || vbParts.some((n) => !Number.isFinite(n))) {
      return svgText;
    }

    const origW = vbParts[2];
    const origH = vbParts[3];
    if (!(origW > 0 && origH > 0)) return svgText;

    const contentBox = computeSvgContentBBox(svgText, origW, origH);
    if (!contentBox) return svgText;

    const frameW = contentBox.maxX - contentBox.minX;
    const frameH = contentBox.maxY - contentBox.minY;
    if (!(frameW >= 150 && frameH >= 200)) {
      return svgText;
    }

    const pad = 2;
    let cropW = frameW + pad * 2;
    let cropH = cropW / MUSHAF_TARGET_ASPECT_RATIO;
    if (cropH < frameH + pad * 2) {
      cropH = frameH + pad * 2;
      cropW = cropH * MUSHAF_TARGET_ASPECT_RATIO;
    }

    // Skip if already as tight as (or larger than) current viewBox
    if (cropW >= origW - 1 && cropH >= origH - 1) {
      return svgText;
    }

    const centerX = (contentBox.minX + contentBox.maxX) / 2;
    const centerY = (contentBox.minY + contentBox.maxY) / 2;
    const cropX = centerX - cropW / 2;
    const cropY = centerY - cropH / 2;

    if (
      !Number.isFinite(cropX) ||
      !Number.isFinite(cropY) ||
      !Number.isFinite(cropW) ||
      !Number.isFinite(cropH) ||
      !(cropW > 0 && cropH > 0)
    ) {
      return svgText;
    }

    const newViewBox = `${cropX.toFixed(2)} ${cropY.toFixed(2)} ${cropW.toFixed(2)} ${cropH.toFixed(2)}`;
    const updatedSvgOpen = svgOpenMatch[0].replace(
      /\bviewBox\s*=\s*(?:"[^"]*"|'[^']*')/,
      `viewBox="${newViewBox}"`
    );
    return svgText.replace(svgOpenMatch[0], updatedSvgOpen);
  } catch {
    return svgText;
  }
}

export async function fetchAndCacheMushafSvg(
  page: number
): Promise<{ objectUrl: string; fromCache: boolean }> {
  const safePage = Math.max(1, Math.min(604, Math.floor(page)));
  const url = getMushafSvgRemoteUrl(safePage);
  const idbKey = `mushaf_svg_v2_page_${safePage}`;

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
  const idbKey = `mushaf_svg_v2_page_${page}`;

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
