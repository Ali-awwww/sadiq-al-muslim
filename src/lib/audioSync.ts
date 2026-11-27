import { resolvePageFromMeta } from './arabic';
import { idbGet, idbSet } from './cache';
import type { QuranMeta } from '../types/quran';

export const MP3QURAN_AYAT_TIMING_URL = 'https://www.mp3quran.net/api/v3/ayat_timing';

export interface AyahTimingSegment {
  ayah: number; // 0 = intro/basmala, 1..N = ayah number in surah
  startTimeMs: number;
  endTimeMs: number;
  page?: number | null;
}

export interface PageAyahAnchor {
  page: number; // 1..604
  surahNumber: number; // 1..114
  ayahNumber: number; // 1..N in surah
  globalAyahNumber: number; // 1..6236
}

export interface AyahLocation {
  globalAyahNumber: number;
  surahNumber: number;
  ayahNumberInSurah: number;
  page: number;
}

export interface SurahWeightEntry {
  globalNumber: number;
  ayahNumberInSurah: number;
  endRatio: number;
}

const memoryTimingsCache = new Map<string, AyahTimingSegment[]>();

export function parseTimingPageNumber(pageVal: unknown): number | null {
  if (typeof pageVal === 'number' && Number.isFinite(pageVal)) {
    const n = Math.floor(pageVal);
    return n >= 1 && n <= 604 ? n : null;
  }
  if (typeof pageVal === 'string') {
    const match = pageVal.match(/(\d{1,3})(?:\.svg)?$/i);
    if (match) {
      const n = Number(match[1]);
      return n >= 1 && n <= 604 ? n : null;
    }
  }
  return null;
}

export function normalizeMp3QuranTimings(raw: unknown): AyahTimingSegment[] {
  if (!Array.isArray(raw)) return [];

  const parsed: AyahTimingSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const ayah = Number(rec.ayah);
    const startTimeMs = Number(rec.start_time ?? rec.startTimeMs);
    const endTimeMs = Number(rec.end_time ?? rec.endTimeMs);

    if (
      !Number.isFinite(ayah) ||
      ayah < 0 ||
      !Number.isFinite(startTimeMs) ||
      !Number.isFinite(endTimeMs) ||
      startTimeMs < 0
    ) {
      continue;
    }

    parsed.push({
      ayah: Math.floor(ayah),
      startTimeMs,
      endTimeMs: Math.max(startTimeMs, endTimeMs),
      page: parseTimingPageNumber(rec.page),
    });
  }

  parsed.sort((a, b) => a.startTimeMs - b.startTimeMs || a.ayah - b.ayah);
  return parsed;
}

export async function fetchSurahAyahTimings(
  moshafId: number,
  surahNumber: number
): Promise<AyahTimingSegment[]> {
  const safeMoshafId = Math.floor(moshafId);
  const safeSurah = Math.max(1, Math.min(114, Math.floor(surahNumber)));
  if (!Number.isFinite(safeMoshafId) || safeMoshafId <= 0) return [];

  const cacheKey = `ayat_timing_v1_${safeMoshafId}_${safeSurah}`;
  const memHit = memoryTimingsCache.get(cacheKey);
  if (memHit) return memHit;

  const idbHit = await idbGet<AyahTimingSegment[]>(cacheKey);
  if (Array.isArray(idbHit) && idbHit.length > 0) {
    memoryTimingsCache.set(cacheKey, idbHit);
    return idbHit;
  }

  try {
    const res = await fetch(
      `${MP3QURAN_AYAT_TIMING_URL}?surah=${safeSurah}&read=${safeMoshafId}`
    );
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const normalized = normalizeMp3QuranTimings(json);
    if (normalized.length > 0) {
      memoryTimingsCache.set(cacheKey, normalized);
      await idbSet(cacheKey, normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

export function getSurahStartGlobalAyah(
  meta: QuranMeta | null | undefined,
  surahNumber: number
): number {
  const safeSurah = Math.max(1, Math.min(114, Math.floor(surahNumber)));
  const refs = meta?.surahs?.references;
  if (!refs || refs.length === 0) {
    return safeSurah === 1 ? 1 : safeSurah === 2 ? 8 : 1;
  }

  let offset = 1;
  for (const s of refs) {
    if (s.number < safeSurah) {
      offset += s.numberOfAyahs;
    }
  }
  return offset;
}

export function toGlobalAyahNumber(
  meta: QuranMeta | null | undefined,
  surahNumber: number,
  ayahNumberInSurah: number
): number {
  const safeSurah = Math.max(1, Math.min(114, Math.floor(surahNumber)));
  const safeAyah = Math.max(1, Math.floor(ayahNumberInSurah));
  const refs = meta?.surahs?.references;
  if (!refs || refs.length === 0) {
    return safeSurah === 1 ? Math.min(7, safeAyah) : Math.max(1, 7 + safeAyah);
  }

  const surahRef = refs.find((s) => s.number === safeSurah);
  const clampedAyah = surahRef
    ? Math.min(surahRef.numberOfAyahs, safeAyah)
    : safeAyah;
  return Math.max(
    1,
    Math.min(6236, getSurahStartGlobalAyah(meta, safeSurah) + clampedAyah - 1)
  );
}

export function fromGlobalAyahNumber(
  meta: QuranMeta | null | undefined,
  globalAyahNumber: number
): { surahNumber: number; ayahNumberInSurah: number } | null {
  if (!Number.isFinite(globalAyahNumber) || globalAyahNumber < 1) return null;
  const refs = meta?.surahs?.references;
  if (!refs || refs.length === 0) return null;

  const clampedGlobal = Math.max(1, Math.min(6236, Math.floor(globalAyahNumber)));
  const sorted = [...refs].sort((a, b) => a.number - b.number);
  let remaining = clampedGlobal;

  for (const s of sorted) {
    if (remaining <= s.numberOfAyahs) {
      return {
        surahNumber: s.number,
        ayahNumberInSurah: remaining,
      };
    }
    remaining -= s.numberOfAyahs;
  }

  const last = sorted[sorted.length - 1];
  return last
    ? { surahNumber: last.number, ayahNumberInSurah: last.numberOfAyahs }
    : null;
}

export function getFirstAyahForPage(
  meta: QuranMeta | null | undefined,
  page: number
): PageAyahAnchor {
  const safePage = Math.max(1, Math.min(604, Math.floor(page || 1)));
  const pageRef = meta?.pages?.references?.[safePage - 1];

  if (!pageRef) {
    const surahNumber = safePage === 1 ? 1 : 2;
    return {
      page: safePage,
      surahNumber,
      ayahNumber: 1,
      globalAyahNumber: toGlobalAyahNumber(meta, surahNumber, 1),
    };
  }

  return {
    page: safePage,
    surahNumber: pageRef.surah,
    ayahNumber: pageRef.ayah,
    globalAyahNumber: toGlobalAyahNumber(meta, pageRef.surah, pageRef.ayah),
  };
}

export function getPageForAyah(
  meta: QuranMeta | null | undefined,
  surahNumber: number,
  ayahNumberInSurah: number
): number {
  return resolvePageFromMeta(
    meta?.pages?.references,
    Math.max(1, Math.min(114, Math.floor(surahNumber))),
    Math.max(1, Math.floor(ayahNumberInSurah))
  );
}

export function getLocationForGlobalAyah(
  meta: QuranMeta | null | undefined,
  globalAyahNumber: number | null | undefined
): AyahLocation | null {
  if (!meta || globalAyahNumber == null || !Number.isFinite(globalAyahNumber)) {
    return null;
  }
  const pos = fromGlobalAyahNumber(meta, globalAyahNumber);
  if (!pos) return null;
  const page = getPageForAyah(meta, pos.surahNumber, pos.ayahNumberInSurah);
  return {
    globalAyahNumber: toGlobalAyahNumber(meta, pos.surahNumber, pos.ayahNumberInSurah),
    surahNumber: pos.surahNumber,
    ayahNumberInSurah: pos.ayahNumberInSurah,
    page,
  };
}

export function buildSurahWeightEntries(
  ayahs: Array<{ number: number; numberInSurah: number; text: string }>
): SurahWeightEntry[] {
  if (!ayahs || ayahs.length === 0) return [];
  const weights = ayahs.map((a) => Math.max(12, a.text.length));
  const total = weights.reduce((acc, w) => acc + w, 0);
  if (total <= 0) return [];

  let cumulative = 0;
  return ayahs.map((a, idx) => {
    cumulative += weights[idx];
    return {
      globalNumber: a.number,
      ayahNumberInSurah: a.numberInSurah,
      endRatio: cumulative / total,
    };
  });
}

export function getSurahIntroOffsetSeconds(
  surahNumber: number,
  durationSeconds: number
): number {
  if (durationSeconds <= 0) return 0;
  return surahNumber !== 1 && surahNumber !== 9
    ? Math.min(2.5, durationSeconds * 0.05)
    : 0;
}

export function getSeekTimeSecondsForAyah(params: {
  surahNumber: number;
  ayahNumberInSurah: number;
  timings?: AyahTimingSegment[];
  durationSeconds?: number;
  weights?: SurahWeightEntry[];
}): number | null {
  const {
    surahNumber,
    ayahNumberInSurah,
    timings,
    durationSeconds = 0,
    weights,
  } = params;

  const targetAyah = Math.max(1, Math.floor(ayahNumberInSurah));
  // When starting at the first ayah of a surah, start at 0s so Isti'adha/Basmala is preserved.
  if (targetAyah === 1) {
    return 0;
  }

  if (timings && timings.length > 0) {
    const seg = timings.find((t) => t.ayah === targetAyah);
    if (seg) {
      const sec = Math.max(0, seg.startTimeMs / 1000);
      return durationSeconds > 0 ? Math.min(sec, Math.max(0, durationSeconds - 0.1)) : sec;
    }
  }

  if (weights && weights.length > 0 && durationSeconds > 0) {
    const idx = weights.findIndex((w) => w.ayahNumberInSurah === targetAyah);
    if (idx >= 0) {
      const startRatio = idx === 0 ? 0 : weights[idx - 1].endRatio;
      const introOffset = getSurahIntroOffsetSeconds(surahNumber, durationSeconds);
      const effectiveDuration = Math.max(1, durationSeconds - introOffset);
      return Math.min(
        Math.max(0, durationSeconds - 0.1),
        introOffset + startRatio * effectiveDuration
      );
    }
  }

  return null;
}

export function resolveActiveAyahFromTime(params: {
  currentTimeSeconds: number;
  durationSeconds: number;
  surahNumber: number;
  timings?: AyahTimingSegment[];
  weights?: SurahWeightEntry[];
  firstGlobalAyahOfSurah?: number;
}): { ayahNumberInSurah: number; globalAyahNumber: number } | null {
  const {
    currentTimeSeconds,
    durationSeconds,
    surahNumber,
    timings,
    weights,
    firstGlobalAyahOfSurah,
  } = params;

  if (!Number.isFinite(currentTimeSeconds) || currentTimeSeconds < 0) return null;

  const baseGlobal =
    firstGlobalAyahOfSurah ??
    weights?.[0]?.globalNumber ??
    null;

  if (timings && timings.length > 0) {
    const positiveSegments = timings.filter((t) => t.ayah >= 1);
    if (positiveSegments.length > 0 && baseGlobal !== null) {
      const timeMs = currentTimeSeconds * 1000;
      if (timeMs < positiveSegments[0].startTimeMs) {
        return {
          ayahNumberInSurah: positiveSegments[0].ayah,
          globalAyahNumber: baseGlobal + positiveSegments[0].ayah - 1,
        };
      }

      let matched = positiveSegments[0];
      for (const seg of positiveSegments) {
        if (timeMs >= seg.startTimeMs) {
          matched = seg;
        } else {
          break;
        }
      }

      return {
        ayahNumberInSurah: matched.ayah,
        globalAyahNumber: baseGlobal + matched.ayah - 1,
      };
    }
  }

  if (!weights || weights.length === 0 || durationSeconds <= 0) return null;

  const introOffset = getSurahIntroOffsetSeconds(surahNumber, durationSeconds);
  const effectiveElapsed = Math.max(0, currentTimeSeconds - introOffset);
  const effectiveDuration = Math.max(1, durationSeconds - introOffset);
  const ratio = Math.min(1, effectiveElapsed / effectiveDuration);
  const match = weights.find((w) => ratio <= w.endRatio) ?? weights[weights.length - 1];
  if (!match) return null;

  return {
    ayahNumberInSurah: match.ayahNumberInSurah,
    globalAyahNumber: match.globalNumber,
  };
}
