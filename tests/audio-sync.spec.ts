import { describe, expect, it } from 'vitest';
import {
  buildSurahWeightEntries,
  fromGlobalAyahNumber,
  getFirstAyahForPage,
  getLocationForGlobalAyah,
  getPageForAyah,
  getSeekTimeSecondsForAyah,
  getSurahStartGlobalAyah,
  normalizeMp3QuranTimings,
  parseTimingPageNumber,
  resolveActiveAyahFromTime,
  toGlobalAyahNumber,
} from '../src/lib/audioSync';
import type { PageOrJuzRef, QuranMeta, SurahReference } from '../src/types/quran';

function createTestMeta(): QuranMeta {
  // Exact ayah counts for selected surahs and standard total 6236 across 114 surahs
  const exactCounts: Record<number, number> = {
    1: 7,
    2: 286,
    3: 200,
    9: 129,
    112: 4,
    113: 5,
    114: 6,
  };

  // Distribute remaining ayahs so total across 1..114 equals 6236
  const knownSum = Object.values(exactCounts).reduce((a, b) => a + b, 0); // 637
  const remainingSurahs = 114 - Object.keys(exactCounts).length; // 107
  const remainingAyahs = 6236 - knownSum; // 5599
  const basePerSurah = Math.floor(remainingAyahs / remainingSurahs);
  let extra = remainingAyahs % remainingSurahs;

  const surahRefs: SurahReference[] = [];
  for (let n = 1; n <= 114; n++) {
    let count = exactCounts[n];
    if (count == null) {
      count = basePerSurah + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
    }
    surahRefs.push({
      number: n,
      name: `سورة ${n}`,
      englishName: `Surah ${n}`,
      englishNameTranslation: `Surah ${n}`,
      numberOfAyahs: count,
      revelationType: n === 1 || n === 112 || n === 113 || n === 114 ? 'Meccan' : 'Medinan',
    });
  }

  const pageRefs: PageOrJuzRef[] = Array.from({ length: 604 }, (_, idx) => {
    const page = idx + 1;
    if (page === 1) return { surah: 1, ayah: 1 };
    if (page === 2) return { surah: 2, ayah: 1 };
    if (page === 3) return { surah: 2, ayah: 6 };
    if (page === 49) return { surah: 2, ayah: 286 }; // Single-ayah-on-page boundary for Surah 2
    if (page === 50) return { surah: 3, ayah: 1 };
    if (page === 603) return { surah: 109, ayah: 1 };
    if (page === 604) return { surah: 112, ayah: 1 };
    if (page < 49) return { surah: 2, ayah: Math.min(285, 6 + (page - 3) * 5) };
    if (page < 76) return { surah: 3, ayah: Math.min(200, 1 + (page - 50) * 7) };
    return { surah: Math.min(108, 4 + Math.floor((page - 76) / 5)), ayah: 1 + ((page - 76) % 5) * 3 };
  });

  return {
    surahs: { count: 114, references: surahRefs },
    juzs: { count: 30, references: [{ surah: 1, ayah: 1 }] },
    pages: { count: 604, references: pageRefs },
  };
}

describe('audioSync - page and ayah two-way mapping', () => {
  const meta = createTestMeta();

  it('computes global ayah offsets accurately for start, mid, and end surahs', () => {
    expect(getSurahStartGlobalAyah(meta, 1)).toBe(1);
    expect(getSurahStartGlobalAyah(meta, 2)).toBe(8);
    expect(getSurahStartGlobalAyah(meta, 3)).toBe(294);
    expect(getSurahStartGlobalAyah(meta, 112)).toBe(6222);
    expect(getSurahStartGlobalAyah(meta, 113)).toBe(6226);
    expect(getSurahStartGlobalAyah(meta, 114)).toBe(6231);

    expect(toGlobalAyahNumber(meta, 1, 1)).toBe(1);
    expect(toGlobalAyahNumber(meta, 2, 6)).toBe(13);
    expect(toGlobalAyahNumber(meta, 114, 6)).toBe(6236);
    expect(fromGlobalAyahNumber(meta, 1)).toEqual({ surahNumber: 1, ayahNumberInSurah: 1 });
    expect(fromGlobalAyahNumber(meta, 13)).toEqual({ surahNumber: 2, ayahNumberInSurah: 6 });
    expect(fromGlobalAyahNumber(meta, 6236)).toEqual({ surahNumber: 114, ayahNumberInSurah: 6 });
  });

  it('maps any Mushaf page to its exact starting surah & ayah (Page 1, mid-surah, single-ayah boundary, Page 604)', () => {
    expect(getFirstAyahForPage(meta, 1)).toEqual({
      page: 1,
      surahNumber: 1,
      ayahNumber: 1,
      globalAyahNumber: 1,
    });

    expect(getFirstAyahForPage(meta, 2)).toEqual({
      page: 2,
      surahNumber: 2,
      ayahNumber: 1,
      globalAyahNumber: 8,
    });

    expect(getFirstAyahForPage(meta, 3)).toEqual({
      page: 3,
      surahNumber: 2,
      ayahNumber: 6,
      globalAyahNumber: 13,
    });

    // Single-ayah-on-page boundary (Surah 2 last ayah 286 on Page 49 before Surah 3 on Page 50)
    expect(getFirstAyahForPage(meta, 49)).toEqual({
      page: 49,
      surahNumber: 2,
      ayahNumber: 286,
      globalAyahNumber: 293,
    });

    // Multi-surah final page 604 (starts with Surah 112 Ayah 1)
    expect(getFirstAyahForPage(meta, 604)).toEqual({
      page: 604,
      surahNumber: 112,
      ayahNumber: 1,
      globalAyahNumber: 6222,
    });

    // Out-of-bounds page clamping
    expect(getFirstAyahForPage(meta, 0).page).toBe(1);
    expect(getFirstAyahForPage(meta, 999).page).toBe(604);
  });

  it('maps global and surah/ayah numbers back to exact Mushaf pages including multi-surah Page 604', () => {
    expect(getPageForAyah(meta, 1, 7)).toBe(1);
    expect(getPageForAyah(meta, 2, 1)).toBe(2);
    expect(getPageForAyah(meta, 2, 5)).toBe(2);
    expect(getPageForAyah(meta, 2, 6)).toBe(3);
    expect(getPageForAyah(meta, 2, 286)).toBe(49);
    expect(getPageForAyah(meta, 3, 1)).toBe(50);

    // Surahs 112, 113, 114 all map to Page 604
    expect(getLocationForGlobalAyah(meta, 6222)).toEqual({
      globalAyahNumber: 6222,
      surahNumber: 112,
      ayahNumberInSurah: 1,
      page: 604,
    });
    expect(getLocationForGlobalAyah(meta, 6226)).toEqual({
      globalAyahNumber: 6226,
      surahNumber: 113,
      ayahNumberInSurah: 1,
      page: 604,
    });
    expect(getLocationForGlobalAyah(meta, 6236)).toEqual({
      globalAyahNumber: 6236,
      surahNumber: 114,
      ayahNumberInSurah: 6,
      page: 604,
    });

    expect(getLocationForGlobalAyah(meta, null)).toBeNull();
    expect(getLocationForGlobalAyah(meta, 0)).toBeNull();
  });
});

describe('audioSync - MP3Quran timings & fallback progression', () => {
  it('parses MP3Quran page numbers and normalizes millisecond timing arrays', () => {
    expect(parseTimingPageNumber('https://www.mp3quran.net/api/quran_pages_svg/002.svg')).toBe(2);
    expect(parseTimingPageNumber(604)).toBe(604);
    expect(parseTimingPageNumber(null)).toBeNull();

    const timings = normalizeMp3QuranTimings([
      { ayah: 2, start_time: 12792, end_time: 21500, page: 'https://www.mp3quran.net/api/quran_pages_svg/002.svg' },
      { ayah: 0, start_time: 0, end_time: 4852, page: null },
      { ayah: 1, start_time: 4852, end_time: 12792, page: 'https://www.mp3quran.net/api/quran_pages_svg/002.svg' },
      { ayah: -1, start_time: 100, end_time: 200 },
    ]);

    expect(timings).toHaveLength(3);
    expect(timings.map((t) => t.ayah)).toEqual([0, 1, 2]);
    expect(timings[1].page).toBe(2);
  });

  it('computes exact seek time from MP3Quran timing tables and starts Ayah 1 at 0s', () => {
    const timings = normalizeMp3QuranTimings([
      { ayah: 0, start_time: 0, end_time: 4852 },
      { ayah: 1, start_time: 4852, end_time: 12792 },
      { ayah: 2, start_time: 12792, end_time: 21500 },
      { ayah: 6, start_time: 54200, end_time: 65100 },
    ]);

    // Ayah 1 starts at 0 so Basmala/Isti'adha plays naturally
    expect(
      getSeekTimeSecondsForAyah({
        surahNumber: 2,
        ayahNumberInSurah: 1,
        timings,
        durationSeconds: 300,
      })
    ).toBe(0);

    // Jumping to Page 3 (Surah 2, Ayah 6) seeks directly to 54.2s
    expect(
      getSeekTimeSecondsForAyah({
        surahNumber: 2,
        ayahNumberInSurah: 6,
        timings,
        durationSeconds: 300,
      })
    ).toBeCloseTo(54.2, 3);
  });

  it('resolves active ayah from currentTime using timing tables including Basmala intro', () => {
    const timings = normalizeMp3QuranTimings([
      { ayah: 0, start_time: 0, end_time: 4852 },
      { ayah: 1, start_time: 4852, end_time: 12792 },
      { ayah: 2, start_time: 12792, end_time: 21500 },
      { ayah: 6, start_time: 54200, end_time: 65100 },
    ]);

    // During Basmala intro (< 4.852s), stays locked to Ayah 1 (global 8)
    expect(
      resolveActiveAyahFromTime({
        currentTimeSeconds: 2.0,
        durationSeconds: 300,
        surahNumber: 2,
        timings,
        firstGlobalAyahOfSurah: 8,
      })
    ).toEqual({ ayahNumberInSurah: 1, globalAyahNumber: 8 });

    // At 15.0s -> inside Ayah 2 (global 9)
    expect(
      resolveActiveAyahFromTime({
        currentTimeSeconds: 15.0,
        durationSeconds: 300,
        surahNumber: 2,
        timings,
        firstGlobalAyahOfSurah: 8,
      })
    ).toEqual({ ayahNumberInSurah: 2, globalAyahNumber: 9 });

    // At 56.0s -> inside Ayah 6 (global 13, Page 3)
    expect(
      resolveActiveAyahFromTime({
        currentTimeSeconds: 56.0,
        durationSeconds: 300,
        surahNumber: 2,
        timings,
        firstGlobalAyahOfSurah: 8,
      })
    ).toEqual({ ayahNumberInSurah: 6, globalAyahNumber: 13 });
  });

  it('falls back cleanly to character-weighted progress when timing tables are unavailable', () => {
    const weights = buildSurahWeightEntries([
      { number: 8, numberInSurah: 1, text: 'الم' }, // clamped min weight 12
      { number: 9, numberInSurah: 2, text: 'ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ فِيهِ هُدًى لِّلْمُتَّقِينَ' },
      { number: 10, numberInSurah: 3, text: 'ٱلَّذِينَ يُؤْمِنُونَ بِٱلْغَيْبِ وَيُقِيمُونَ ٱلصَّلَوٰةَ وَمِمَّا رَزَقْنَٰهُمْ يُنفِقُونَ' },
    ]);

    const seekSec = getSeekTimeSecondsForAyah({
      surahNumber: 2,
      ayahNumberInSurah: 3,
      timings: [],
      durationSeconds: 100,
      weights,
    });

    expect(seekSec).not.toBeNull();
    expect(seekSec!).toBeGreaterThan(20);
    expect(seekSec!).toBeLessThan(80);

    const resolved = resolveActiveAyahFromTime({
      currentTimeSeconds: seekSec! + 1,
      durationSeconds: 100,
      surahNumber: 2,
      timings: [],
      weights,
    });
    expect(resolved).toEqual({ ayahNumberInSurah: 3, globalAyahNumber: 10 });

    // Without timing table AND without duration, seek time is null (defers until loadedmetadata)
    expect(
      getSeekTimeSecondsForAyah({
        surahNumber: 2,
        ayahNumberInSurah: 3,
        timings: [],
        durationSeconds: 0,
        weights,
      })
    ).toBeNull();
  });
});
