import type {
  Ayah,
  Moshaf,
  MushafPageData,
  QuranMeta,
  Reciter,
  SearchMatch,
  SearchResponse,
  SurahData,
} from '../types/quran';
import { idbGet, idbSet } from './cache';

export const ALQURAN_BASE = 'https://api.alquran.cloud/v1';
export const MP3QURAN_RECITERS_URL = 'https://www.mp3quran.net/api/v3/reciters?language=ar';
export const ALAFASY_SAMPLE_AUDIO_BASE = 'https://cdn.islamic.network/quran/audio/128/ar.alafasy';

// Exact 5 reciter IDs specified
export const ALLOWED_RECITER_IDS = [112, 109, 92, 137, 81] as const;

export interface FetchResult<T> {
  data: T;
  fromCache: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`فشل الاتصال بالخادم (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchQuranMeta(): Promise<FetchResult<QuranMeta>> {
  const cacheKey = 'meta_v1';
  const cached = await idbGet<QuranMeta>(cacheKey);
  if (cached) {
    return { data: cached, fromCache: true };
  }

  const json = await fetchJson<{ code: number; status: string; data: QuranMeta }>(
    `${ALQURAN_BASE}/meta`
  );
  if (!json?.data?.surahs?.references) {
    throw new Error('استجابة غير صالحة لبيانات الفهرس');
  }
  await idbSet(cacheKey, json.data);
  return { data: json.data, fromCache: false };
}

export async function fetchMushafPage(page: number): Promise<FetchResult<MushafPageData>> {
  const safePage = Math.max(1, Math.min(604, page));
  const cacheKey = `page_uthmani_${safePage}`;
  const cached = await idbGet<MushafPageData>(cacheKey);
  if (cached) {
    return { data: cached, fromCache: true };
  }

  const json = await fetchJson<{ code: number; data: MushafPageData }>(
    `${ALQURAN_BASE}/page/${safePage}/quran-uthmani`
  );
  if (!json?.data?.ayahs) {
    throw new Error(`تعذر تحميل الصفحة ${safePage}`);
  }
  await idbSet(cacheKey, json.data);
  return { data: json.data, fromCache: false };
}

export async function fetchSurahUthmani(surahNumber: number): Promise<FetchResult<SurahData>> {
  const safeSurah = Math.max(1, Math.min(114, surahNumber));
  const cacheKey = `surah_uthmani_${safeSurah}`;
  const cached = await idbGet<SurahData>(cacheKey);
  if (cached) {
    return { data: cached, fromCache: true };
  }

  const json = await fetchJson<{ code: number; data: SurahData }>(
    `${ALQURAN_BASE}/surah/${safeSurah}/quran-uthmani`
  );
  if (!json?.data?.ayahs) {
    throw new Error(`تعذر تحميل السورة رقم ${safeSurah}`);
  }
  await idbSet(cacheKey, json.data);
  return { data: json.data, fromCache: false };
}

export async function fetchJuzUthmani(juzNumber: number): Promise<FetchResult<{ number: number; ayahs: Ayah[] }>> {
  const safeJuz = Math.max(1, Math.min(30, juzNumber));
  const cacheKey = `juz_uthmani_${safeJuz}`;
  const cached = await idbGet<{ number: number; ayahs: Ayah[] }>(cacheKey);
  if (cached) {
    return { data: cached, fromCache: true };
  }

  const json = await fetchJson<{ code: number; data: { number: number; ayahs: Ayah[] } }>(
    `${ALQURAN_BASE}/juz/${safeJuz}/quran-uthmani`
  );
  if (!json?.data?.ayahs) {
    throw new Error(`تعذر تحميل الجزء رقم ${safeJuz}`);
  }
  await idbSet(cacheKey, json.data);
  return { data: json.data, fromCache: false };
}

export const TAFSIR_EDITIONS = [
  { id: 'ar.muyassar', label: 'التفسير الميسر' },
  { id: 'ar.qurtubi', label: 'تفسير القرطبي' },
  { id: 'ar.jalalayn', label: 'تفسير الجلالين' },
  { id: 'ar.baghawi', label: 'تفسير البغوي' },
  { id: 'ar.waseet', label: 'التفسير الوسيط' },
] as const;

export async function fetchTafsir(
  surahNumber: number,
  editionId = 'ar.muyassar'
): Promise<FetchResult<SurahData & { editionName?: string }>> {
  const safeSurah = Math.max(1, Math.min(114, surahNumber));
  const cacheKey = `tafsir_${editionId}_${safeSurah}_v2`;
  const cached = await idbGet<SurahData & { editionName?: string }>(cacheKey);
  if (cached) {
    return { data: cached, fromCache: true };
  }

  const requestEdition = async (ed: string) => {
    const json = await fetchJson<{
      code: number;
      data: SurahData & { edition?: { identifier: string; name: string; type: string } };
    }>(`${ALQURAN_BASE}/surah/${safeSurah}/${ed}`);
    return json?.data;
  };

  let data = await requestEdition(editionId);

  if (!data?.ayahs || data.edition?.type !== 'tafsir') {
    data = await requestEdition('ar.muyassar');
  }

  if (!data?.ayahs) {
    throw new Error(`تعذر تحميل التفسير للسورة ${safeSurah}`);
  }

  const result: SurahData & { editionName?: string } = {
    ...data,
    editionName: data.edition?.name ?? 'التفسير الميسر',
  };

  await idbSet(cacheKey, result);
  return { data: result, fromCache: false };
}

export async function fetchAyahByNumber(globalAyahNumber: number): Promise<FetchResult<Ayah>> {
  const safeNum = Math.max(1, Math.min(6236, globalAyahNumber));
  const cacheKey = `ayah_uthmani_${safeNum}`;
  const cached = await idbGet<Ayah>(cacheKey);
  if (cached) {
    return { data: cached, fromCache: true };
  }

  const json = await fetchJson<{ code: number; data: Ayah }>(
    `${ALQURAN_BASE}/ayah/${safeNum}/quran-uthmani`
  );
  if (!json?.data?.text) {
    throw new Error('تعذر جلب الآية من الخادم');
  }
  await idbSet(cacheKey, json.data);
  return { data: json.data, fromCache: false };
}

export async function searchQuran(query: string): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { count: 0, matches: [] };
  }

  const encoded = encodeURIComponent(trimmed);
  const response = await fetch(`${ALQURAN_BASE}/search/${encoded}/all/ar`);
  if (response.status === 404) {
    return { count: 0, matches: [] };
  }
  if (!response.ok) {
    throw new Error(`تعذر إجراء البحث (${response.status})`);
  }
  const json = (await response.json()) as {
    code: number;
    data?: {
      count: number;
      matches: Array<
        SearchMatch & { edition?: { identifier?: string; type?: string } }
      >;
    };
  };
  if (!json?.data || !Array.isArray(json.data.matches)) {
    return { count: 0, matches: [] };
  }

  // Keep only Quran matches (exclude tafsir matches) and deduplicate by surah:ayah
  const seen = new Set<string>();
  const quranMatches = json.data.matches.filter((m) => !m.edition || m.edition.type === 'quran');
  // Prefer quran-uthmani / quran-simple first
  quranMatches.sort((a, b) => {
    const score = (id?: string) =>
      id === 'quran-uthmani' ? 0 : id === 'quran-simple' ? 1 : 2;
    return score(a.edition?.identifier) - score(b.edition?.identifier);
  });

  const unique: SearchMatch[] = [];
  for (const m of quranMatches) {
    const key = `${m.surah.number}:${m.numberInSurah}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        ...m,
        text: m.text.replace(/^\uFEFF+/, '').trim(),
      });
    }
  }

  return {
    count: unique.length,
    matches: unique,
  };
}

interface RawMp3Reciter {
  id: number;
  name: string;
  letter?: string;
  moshaf?: Moshaf[];
  moshef?: Moshaf[];
}

export async function fetchFiveReciters(): Promise<FetchResult<Reciter[]>> {
  const cacheKey = 'reciters_five_v3_sorted';
  const cached = await idbGet<Reciter[]>(cacheKey);
  if (cached && cached.length === 5) {
    return { data: cached, fromCache: true };
  }

  const json = await fetchJson<{ reciters?: RawMp3Reciter[] }>(MP3QURAN_RECITERS_URL);
  const all = json?.reciters ?? [];
  const allowedSet = new Set<number>(ALLOWED_RECITER_IDS);

  const filtered: Reciter[] = [];
  for (const id of ALLOWED_RECITER_IDS) {
    const match = all.find((r) => Number(r.id) === id);
    if (match && allowedSet.has(Number(match.id))) {
      const moshafs = (match.moshaf ?? match.moshef ?? []).map((m) => ({
        ...m,
        server: m.server.endsWith('/') ? m.server : `${m.server}/`,
      }));
      // Prioritize primary murattal moshaf with matching id or full 114 surahs
      moshafs.sort((a, b) => {
        const score = (m: Moshaf) =>
          (m.id === Number(match.id) ? 1000 : 0) +
          (m.surah_total === 114 ? 200 : m.surah_total) +
          (m.name.includes('مرتل') ? 50 : 0);
        return score(b) - score(a);
      });

      filtered.push({
        id: Number(match.id),
        name: match.name,
        letter: match.letter,
        moshaf: moshafs,
      });
    }
  }

  if (filtered.length === 0) {
    throw new Error('لم يتم العثور على بيانات القراء الخمسة من الخادم');
  }

  await idbSet(cacheKey, filtered);
  return { data: filtered, fromCache: false };
}

export function getSurahAudioUrl(moshaf: Moshaf, surahNumber: number): string {
  const server = moshaf.server.endsWith('/') ? moshaf.server : `${moshaf.server}/`;
  const padded = String(surahNumber).padStart(3, '0');
  return `${server}${padded}.mp3`;
}

export function getAyahSampleAudioUrl(globalAyahNumber: number): string {
  return `${ALAFASY_SAMPLE_AUDIO_BASE}/${globalAyahNumber}.mp3`;
}

export function getAvailableSurahsForMoshaf(moshaf?: Moshaf): Set<number> {
  if (!moshaf?.surah_list) return new Set();
  const nums = moshaf.surah_list
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 114);
  return new Set(nums);
}
