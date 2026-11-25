export type AppTab = 'mushaf' | 'reciters' | 'understanding' | 'khatma' | 'settings';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface SurahReference {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
  revelationType: 'Meccan' | 'Medinan' | string;
}

export interface PageOrJuzRef {
  surah: number;
  ayah: number;
}

export interface QuranMeta {
  surahs: {
    count: number;
    references: SurahReference[];
  };
  juzs: {
    count: number;
    references: PageOrJuzRef[];
  };
  pages: {
    count: number;
    references: PageOrJuzRef[];
  };
}

export interface Ayah {
  number: number; // global 1..6236
  text: string;
  numberInSurah: number;
  juz: number;
  page: number;
  hizbQuarter?: number;
  sajda?: boolean | { id: number; recommended: boolean; obligatory: boolean };
  surah?: SurahReference;
}

export interface MushafPageData {
  number: number;
  ayahs: Ayah[];
  surahs?: Record<string, SurahReference>;
}

export interface SurahData {
  number: number;
  name: string;
  englishName: string;
  revelationType: string;
  numberOfAyahs: number;
  ayahs: Ayah[];
}

export interface SearchMatch {
  number: number;
  text: string;
  numberInSurah: number;
  surah: SurahReference;
  page?: number;
}

export interface SearchResponse {
  count: number;
  matches: SearchMatch[];
}

export interface Moshaf {
  id: number;
  name: string;
  server: string;
  surah_total: number;
  moshaf_type: number;
  surah_list: string;
}

export interface Reciter {
  id: number;
  name: string;
  letter?: string;
  moshaf: Moshaf[];
}

export interface BookmarkItem {
  id: string; // `${page}` or `${surah}:${ayah}`
  type: 'page' | 'ayah';
  page: number;
  surahNumber?: number;
  surahName?: string;
  ayahNumber?: number;
  ayahText?: string;
  createdAt: number;
}

export interface LastReadPosition {
  page: number;
  surahNumber: number;
  surahName: string;
  ayahNumber: number;
  updatedAt: number;
}

export interface KhatmaState {
  dailyGoalPages: number;
  completedPages: number[]; // unique pages 1..604 marked read
  todayDate: string; // YYYY-MM-DD
  pagesReadToday: number;
  reminderEnabled: boolean;
  reminderTime: string; // HH:MM
}

export interface MemoStats {
  correctCount: number;
  retryCount: number;
  sessionsCompleted: number;
}

export interface AppSettings {
  theme: ThemeMode;
  fontSize: number; // 18..38 px
  defaultReciterId: number; // one of 112, 109, 92, 137, 81
  tajweedEnabled: boolean;
}
