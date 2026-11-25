const DB_NAME = 'sadiq-al-muslim-db';
const STORE_NAME = 'kv';
const DB_VERSION = 1;
export const AUDIO_CACHE_NAME = 'sadiq-audio-v1';

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
      const cache = await caches.open(AUDIO_CACHE_NAME);
      const keys = await cache.keys();
      audioEntries = keys.length;
    } catch {
      audioEntries = 0;
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
    } catch {
      // ignore
    }
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
  triggerBrowserDownload: boolean
): Promise<{ cached: boolean; downloaded: boolean }> {
  let cached = false;
  let downloaded = false;

  try {
    const res = await fetch(url);
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
  } catch {
    // Fallback if server blocks CORS for fetch: cache opaque response if possible & trigger anchor download
    if (typeof caches !== 'undefined') {
      try {
        const opaqueRes = await fetch(url, { mode: 'no-cors' });
        const cache = await caches.open(AUDIO_CACHE_NAME);
        await cache.put(url, opaqueRes);
        cached = true;
      } catch {
        // ignore
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
