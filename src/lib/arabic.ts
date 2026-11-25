import type { PageOrJuzRef } from '../types/quran';

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicDigits(num: number | string): string {
  return String(num).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);
}

export function padSurahNumber(surahNumber: number): string {
  return String(surahNumber).padStart(3, '0');
}

export function getRevelationLabel(type?: string): string {
  if (!type) return '';
  return type.toLowerCase() === 'meccan' ? 'مكية' : 'مدنية';
}

export const BASMALA_UTHMANI = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

/**
 * AlQuran Cloud quran-uthmani often prepends the Basmala to Ayah 1 of surahs 2..114 (except 9).
 * This strips the leading Basmala for clean separate display above Ayah 1.
 */
export function stripLeadingBasmala(text: string, surahNumber: number, ayahNumberInSurah: number): string {
  const cleanRaw = text.replace(/^\uFEFF+/, '').trim();
  if (surahNumber === 1 || surahNumber === 9 || ayahNumberInSurah !== 1) {
    return cleanRaw;
  }

  // Match Basmala with various Uthmani alef/shadda combinations at the start of Ayah 1
  const normalizedPrefixes = [
    'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
  ];

  const trimmed = cleanRaw;
  for (const prefix of normalizedPrefixes) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trim();
      return rest.length > 0 ? rest : trimmed;
    }
  }

  // Fallback regex matching any diacritic variant of Bismillah at index 0
  const bismillahRegex = /^بِسْمِ\s+[ٱا]لل[ََّ]+هِ\s+[ٱا]لر[ََّ]+حْم[َٰ]+نِ\s+[ٱا]لر[ََّ]+حِيمِ\s*/u;
  if (bismillahRegex.test(trimmed)) {
    const rest = trimmed.replace(bismillahRegex, '').trim();
    return rest.length > 0 ? rest : trimmed;
  }

  return text;
}

/**
 * Given meta page references (604 items of {surah, ayah}), resolve the exact Mushaf page (1..604)
 * for any (surahNumber, ayahNumber).
 */
export function resolvePageFromMeta(
  pageRefs: PageOrJuzRef[] | undefined,
  surahNumber: number,
  ayahNumber: number
): number {
  if (!pageRefs || pageRefs.length === 0) return 1;
  let matchedPage = 1;
  for (let i = 0; i < pageRefs.length; i++) {
    const ref = pageRefs[i];
    if (
      ref.surah < surahNumber ||
      (ref.surah === surahNumber && ref.ayah <= ayahNumber)
    ) {
      matchedPage = i + 1;
    } else {
      break;
    }
  }
  return matchedPage;
}

/**
 * Given meta juz references (30 items of {surah, ayah}), resolve which Juz (1..30)
 * a surah starts in (or a specific ayah belongs to).
 */
export function resolveJuzFromMeta(
  juzRefs: PageOrJuzRef[] | undefined,
  surahNumber: number,
  ayahNumber = 1
): number {
  if (!juzRefs || juzRefs.length === 0) return 1;
  let matchedJuz = 1;
  for (let i = 0; i < juzRefs.length; i++) {
    const ref = juzRefs[i];
    if (
      ref.surah < surahNumber ||
      (ref.surah === surahNumber && ref.ayah <= ayahNumber)
    ) {
      matchedJuz = i + 1;
    } else {
      break;
    }
  }
  return matchedJuz;
}

export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Deterministic global Ayah number (1..6236) based on the current calendar date.
 */
export function getDeterministicAyahOfDayNumber(dateStr = getTodayDateString()): number {
  let hash = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    hash ^= dateStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 6236) + 1;
}

export function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
