import {
  Bookmark,
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  List,
  Loader2,
  Mic,
  Moon,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Type,
  Volume2,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudio } from '../context/AudioContext';
import {
  fetchMushafPage,
  getAvailableSurahsForMoshaf,
  searchQuran,
} from '../lib/api';
import {
  BASMALA_UTHMANI,
  getRevelationLabel,
  resolvePageFromMeta,
  stripLeadingBasmala,
  toArabicDigits,
} from '../lib/arabic';
import { shareAyahAsImage } from '../lib/shareImage';
import type {
  Ayah,
  BookmarkItem,
  LastReadPosition,
  MushafPageData,
  QuranMeta,
  Reciter,
  SearchMatch,
} from '../types/quran';
import { ReciterSheet } from './ReciterSheet';
import { TajweedLegend, TajweedText } from './TajweedText';

interface MushafReaderProps {
  currentPage: number;
  onChangePage: (page: number) => void;
  meta: QuranMeta | null;
  metaLoading: boolean;
  metaError: string | null;
  onRetryMeta: () => void;
  reciters: Reciter[];
  recitersLoading: boolean;
  recitersError: string | null;
  onRetryReciters: () => void;
  selectedReciterId: number;
  onSelectReciter: (id: number) => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  isDark: boolean;
  onToggleDark: () => void;
  tajweedEnabled: boolean;
  onToggleTajweed: () => void;
  bookmarks: BookmarkItem[];
  onToggleBookmark: (item: BookmarkItem) => void;
  lastRead: LastReadPosition | null;
  onUpdateLastRead: (pos: LastReadPosition) => void;
  completedPages: number[];
  onTogglePageCompleted: (page: number) => void;
  onOpenTafsir: (surahNumber: number, ayahNumberInSurah: number) => void;
  highlightedAyahGlobal?: number | null;
}

type ModalKind = null | 'index' | 'search' | 'bookmarks' | 'typography';

export function MushafReader({
  currentPage,
  onChangePage,
  meta,
  metaLoading,
  metaError,
  onRetryMeta,
  reciters,
  recitersLoading,
  recitersError,
  onRetryReciters,
  selectedReciterId,
  onSelectReciter,
  fontSize,
  onChangeFontSize,
  isDark,
  onToggleDark,
  tajweedEnabled,
  onToggleTajweed,
  bookmarks,
  onToggleBookmark,
  lastRead,
  onUpdateLastRead,
  completedPages,
  onTogglePageCompleted,
  onOpenTafsir,
  highlightedAyahGlobal,
}: MushafReaderProps) {
  const {
    activeTrack,
    isPlaying,
    activeAyahGlobalNumber,
    playSurahFromReciter,
    playAyahSample,
    togglePlayPause,
  } = useAudio();

  const [pageData, setPageData] = useState<MushafPageData | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [indexTab, setIndexTab] = useState<'surah' | 'juz' | 'page'>('surah');
  const [surahFilter, setSurahFilter] = useState('');
  const [pageJumpInput, setPageJumpInput] = useState(String(currentPage));

  const [reciterSheetOpen, setReciterSheetOpen] = useState(false);
  const [selectedAyah, setSelectedAyah] = useState<Ayah | null>(null);
  const [sharingAyah, setSharingAyah] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searchCount, setSearchCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [jumpHighlightGlobal, setJumpHighlightGlobal] = useState<number | null>(
    highlightedAyahGlobal ?? null
  );

  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    setPageJumpInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (highlightedAyahGlobal) {
      setJumpHighlightGlobal(highlightedAyahGlobal);
    }
  }, [highlightedAyahGlobal]);

  const loadPage = useCallback(
    async (page: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchMushafPage(page);
        setPageData(res.data);
        setFromCache(res.fromCache);
        const firstAyah = res.data.ayahs[0];
        if (firstAyah) {
          onUpdateLastRead({
            page: res.data.number,
            surahNumber: firstAyah.surah?.number ?? 1,
            surahName: firstAyah.surah?.name ?? '',
            ayahNumber: firstAyah.numberInSurah,
            updatedAt: Date.now(),
          });
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'تعذر تحميل صفحة المصحف. تحقق من الاتصال بالإنترنت.'
        );
      } finally {
        setLoading(false);
      }
    },
    [onUpdateLastRead]
  );

  useEffect(() => {
    void loadPage(currentPage);
  }, [currentPage, loadPage]);

  const currentReciter = useMemo(
    () => reciters.find((r) => r.id === selectedReciterId) ?? reciters[0] ?? null,
    [reciters, selectedReciterId]
  );

  // Group ayahs on the current page by Surah in order of appearance
  const surahGroups = useMemo(() => {
    if (!pageData?.ayahs) return [];
    const groups: Array<{
      surahNumber: number;
      surahName: string;
      revelationType: string;
      ayahs: Ayah[];
    }> = [];

    for (const ayah of pageData.ayahs) {
      const sNum = ayah.surah?.number ?? 1;
      const sName = ayah.surah?.name ?? '';
      const rev = ayah.surah?.revelationType ?? '';
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.surahNumber !== sNum) {
        groups.push({
          surahNumber: sNum,
          surahName: sName,
          revelationType: rev,
          ayahs: [ayah],
        });
      } else {
        lastGroup.ayahs.push(ayah);
      }
    }
    return groups;
  }, [pageData]);

  const primarySurah = surahGroups[0];
  const currentJuz = pageData?.ayahs[0]?.juz ?? 1;

  const isPageBookmarked = bookmarks.some(
    (b) => b.type === 'page' && b.page === currentPage
  );
  const isPageCompleted = completedPages.includes(currentPage);

  const isPlayingCurrentPageSurah = Boolean(
    activeTrack &&
      activeTrack.kind === 'surah' &&
      primarySurah &&
      activeTrack.surahNumber === primarySurah.surahNumber &&
      isPlaying
  );

  const handlePlayPageSurah = async () => {
    if (!primarySurah) return;
    if (
      activeTrack &&
      activeTrack.kind === 'surah' &&
      activeTrack.surahNumber === primarySurah.surahNumber
    ) {
      togglePlayPause();
      return;
    }

    if (!currentReciter || currentReciter.moshaf.length === 0) {
      setReciterSheetOpen(true);
      return;
    }

    const moshaf =
      currentReciter.moshaf.find((m) =>
        getAvailableSurahsForMoshaf(m).has(primarySurah.surahNumber)
      ) ?? currentReciter.moshaf[0];

    await playSurahFromReciter(
      currentReciter,
      moshaf,
      primarySurah.surahNumber,
      primarySurah.surahName
    );
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchedOnce(true);
    try {
      const res = await searchQuran(searchQuery);
      setSearchResults(res.matches);
      setSearchCount(res.count);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'فشل البحث في القرآن الكريم');
    } finally {
      setSearching(false);
    }
  };

  const handleJumpToMatch = (match: SearchMatch) => {
    const resolvedPage =
      match.page ??
      resolvePageFromMeta(
        meta?.pages.references,
        match.surah.number,
        match.numberInSurah
      );
    setJumpHighlightGlobal(match.number);
    setActiveModal(null);
    onChangePage(resolvedPage);
  };

  const handleShareAyah = async (ayah: Ayah) => {
    setSharingAyah(true);
    setShareFeedback(null);
    try {
      const cleanText = stripLeadingBasmala(
        ayah.text,
        ayah.surah?.number ?? 1,
        ayah.numberInSurah
      );
      await shareAyahAsImage({
        ayahText: cleanText,
        surahName: ayah.surah?.name ?? '',
        ayahNumber: ayah.numberInSurah,
        darkMode: isDark,
      });
      setShareFeedback('تم حفظ صورة الآية');
      setTimeout(() => setShareFeedback(null), 2500);
    } catch {
      setShareFeedback('تعذر إنشاء الصورة');
    } finally {
      setSharingAyah(false);
    }
  };

  const filteredSurahs = useMemo(() => {
    const list = meta?.surahs.references ?? [];
    const q = surahFilter.trim();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.includes(q) ||
        s.englishName.toLowerCase().includes(q.toLowerCase()) ||
        String(s.number) === q
    );
  }, [meta, surahFilter]);

  return (
    <div className="mx-auto max-w-4xl px-3 sm:px-6 pt-3 pb-6">
      {/* Compact iPhone-style Top Navigation Bar */}
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => {
              setIndexTab('surah');
              setActiveModal('index');
            }}
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-xs sm:text-sm font-bold text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <List className="h-4 w-4 shrink-0" />
            <span className="truncate max-w-[140px] sm:max-w-none">
              {primarySurah ? primarySurah.surahName : 'الفهرس'}
            </span>
          </button>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
            <span>الجزء {toArabicDigits(currentJuz)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">صفحة {toArabicDigits(currentPage)}</span>
          </div>
        </div>

        {/* Utility buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handlePlayPageSurah}
            aria-label={isPlayingCurrentPageSurah ? 'إيقاف تلاوة الصفحة' : 'تشغيل تلاوة الصفحة'}
            title="تشغيل سورة الصفحة"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-black text-white dark:bg-white dark:text-black transition-transform active:scale-95"
          >
            {isPlayingCurrentPageSurah ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setReciterSheetOpen(true)}
            aria-label="اختيار القارئ"
            title="اختيار القارئ"
            className="flex h-11 items-center gap-1.5 rounded-xl border border-neutral-200 px-2.5 text-xs font-medium text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <Mic className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline max-w-[110px] truncate">
              {currentReciter ? currentReciter.name : 'القارئ'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal('search')}
            aria-label="بحث في القرآن"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setActiveModal('bookmarks')}
            aria-label="العلامات المرجعية"
            className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            <Bookmark className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setActiveModal('typography')}
            aria-label="حجم الخط والتجويد"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            <Type className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleDark}
            aria-label={isDark ? 'الوضع الفاتح' : 'الوضع الليلي'}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Secondary metadata & quick resume/tajweed/offline bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
          <span className="sm:hidden tabular-nums">
            الجزء {toArabicDigits(currentJuz)} · صفحة {toArabicDigits(currentPage)} من{' '}
            {toArabicDigits(604)}
          </span>
          {(fromCache || isOffline) && (
            <span className="inline-flex items-center gap-1 font-medium text-black dark:text-white">
              <WifiOff className="h-3.5 w-3.5" />
              <span>{isOffline ? 'وضع عدم الاتصال' : 'محفوظ دون اتصال'}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTajweed}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              tajweedEnabled
                ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                : 'border-neutral-200 text-neutral-600 hover:text-black dark:border-neutral-800 dark:text-neutral-400 dark:hover:text-white'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            <span>التجويد</span>
          </button>

          <button
            type="button"
            onClick={() =>
              onToggleBookmark({
                id: `page:${currentPage}`,
                type: 'page',
                page: currentPage,
                surahNumber: primarySurah?.surahNumber,
                surahName: primarySurah?.surahName,
                createdAt: Date.now(),
              })
            }
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              isPageBookmarked
                ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                : 'border-neutral-200 text-neutral-600 hover:text-black dark:border-neutral-800 dark:text-neutral-400 dark:hover:text-white'
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" fill={isPageBookmarked ? 'currentColor' : 'none'} />
            <span>{isPageBookmarked ? 'صفحة محفوظة' : 'حفظ الصفحة'}</span>
          </button>

          {lastRead && lastRead.page !== currentPage && (
            <button
              type="button"
              onClick={() => onChangePage(lastRead.page)}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
            >
              <span>متابعة (ص {toArabicDigits(lastRead.page)})</span>
            </button>
          )}
        </div>
      </div>

      {tajweedEnabled && (
        <div className="mb-4">
          <TajweedLegend isDark={isDark} />
        </div>
      )}

      {/* Main Mushaf Page Frame */}
      <main className="mushaf-page-surface rounded-2xl border border-neutral-300 dark:border-neutral-800 p-2 sm:p-3 shadow-xs">
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-5 sm:px-8 sm:py-8 min-h-[58vh]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-sm text-neutral-500 dark:text-neutral-400">
              <Loader2 className="h-7 w-7 animate-spin text-black dark:text-white" />
              <span>جارٍ تحميل الصفحة {toArabicDigits(currentPage)}...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 max-w-md">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void loadPage(currentPage)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
              >
                <RotateCcw className="h-4 w-4" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {surahGroups.map((group) => {
                const startsAtAyahOne = group.ayahs[0]?.numberInSurah === 1;
                const showBasmala =
                  startsAtAyahOne && group.surahNumber !== 1 && group.surahNumber !== 9;

                return (
                  <section key={`${group.surahNumber}-${group.ayahs[0]?.number}`} className="space-y-4">
                    {/* Surah Banner Header when Surah starts on this page */}
                    {startsAtAyahOne && (
                      <div className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100/70 dark:bg-neutral-900/70 px-4 py-3 text-center">
                        <div className="font-quran text-xl sm:text-2xl font-bold text-black dark:text-white">
                          {group.surahName}
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          {getRevelationLabel(group.revelationType)}
                        </div>
                      </div>
                    )}

                    {showBasmala && (
                      <div className="font-quran text-center text-xl sm:text-2xl text-black dark:text-white py-1">
                        {BASMALA_UTHMANI}
                      </div>
                    )}

                    {/* Flowing Uthmani Mushaf text */}
                    <div
                      dir="rtl"
                      className="font-quran text-justify leading-[2.25] tracking-normal text-black dark:text-white"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {group.ayahs.map((ayah) => {
                        const cleanText = stripLeadingBasmala(
                          ayah.text,
                          group.surahNumber,
                          ayah.numberInSurah
                        );
                        const isPlayingThisAyah = activeAyahGlobalNumber === ayah.number;
                        const isSelectedThis = selectedAyah?.number === ayah.number;
                        const isJumpMatch = jumpHighlightGlobal === ayah.number;
                        const isBookmarkedAyah = bookmarks.some(
                          (b) =>
                            b.type === 'ayah' &&
                            b.surahNumber === group.surahNumber &&
                            b.ayahNumber === ayah.numberInSurah
                        );

                        return (
                          <span
                            key={ayah.number}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedAyah(ayah)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedAyah(ayah);
                              }
                            }}
                            className={`inline cursor-pointer rounded-md px-0.5 transition-colors ${
                              isPlayingThisAyah || isSelectedThis
                                ? 'bg-neutral-200 dark:bg-neutral-800 underline decoration-neutral-500 underline-offset-8'
                                : isJumpMatch
                                  ? 'bg-neutral-200/80 dark:bg-neutral-800/80'
                                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
                            }`}
                          >
                            <TajweedText
                              text={cleanText}
                              enabled={tajweedEnabled}
                              isDark={isDark}
                            />{' '}
                            <span
                              className={`inline-flex items-center text-[0.82em] select-none ${
                                isBookmarkedAyah ? 'font-bold underline' : ''
                              }`}
                            >
                              ﴿{toArabicDigits(ayah.numberInSurah)}﴾
                            </span>{' '}
                          </span>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              {/* Page Footer */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-4 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="tabular-nums">
                  صفحة {toArabicDigits(currentPage)} من {toArabicDigits(604)}
                </span>

                <button
                  type="button"
                  onClick={() => onTogglePageCompleted(currentPage)}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isPageCompleted
                      ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                      : 'border-neutral-300 text-black hover:bg-neutral-100 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-900'
                  }`}
                >
                  <BookOpenCheck className="h-3.5 w-3.5" />
                  <span>{isPageCompleted ? 'تمت قراءة الصفحة' : 'تحديد كمقروءة للختمة'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Prev / Page Jump / Next Bar */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChangePage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-35 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-black dark:text-white dark:hover:bg-neutral-950"
        >
          <ChevronRight className="h-4 w-4" />
          <span>الصفحة السابقة</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setIndexTab('page');
            setActiveModal('index');
          }}
          className="min-h-[44px] rounded-xl border border-neutral-200 px-4 py-2 text-xs font-semibold tabular-nums text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
        >
          {toArabicDigits(currentPage)} / {toArabicDigits(604)}
        </button>

        <button
          type="button"
          onClick={() => onChangePage(Math.min(604, currentPage + 1))}
          disabled={currentPage >= 604}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-35 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-black dark:text-white dark:hover:bg-neutral-950"
        >
          <span>الصفحة التالية</span>
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Selected Ayah Action Bottom Sheet */}
      {selectedAyah && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs"
          onClick={() => setSelectedAyah(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="خيارات الآية"
            className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700 sm:hidden" />
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold text-black dark:text-white">
                {selectedAyah.surah?.name} · الآية {toArabicDigits(selectedAyah.numberInSurah)}
              </div>
              <button
                type="button"
                onClick={() => setSelectedAyah(null)}
                aria-label="إغلاق"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="font-quran text-lg leading-loose text-black dark:text-white mb-4 max-h-36 overflow-y-auto border-y border-neutral-200 dark:border-neutral-800 py-3">
              {stripLeadingBasmala(
                selectedAyah.text,
                selectedAyah.surah?.number ?? 1,
                selectedAyah.numberInSurah
              )}
            </p>

            {shareFeedback && (
              <p className="mb-3 text-center text-xs font-semibold text-black dark:text-white">
                {shareFeedback}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  void playAyahSample(selectedAyah, selectedAyah.surah?.name ?? '');
                }}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-black px-3 py-2.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
              >
                <Volume2 className="h-4 w-4" />
                <span>استماع للآية (عينة)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const sNum = selectedAyah.surah?.number ?? 1;
                  const aNum = selectedAyah.numberInSurah;
                  setSelectedAyah(null);
                  onOpenTafsir(sNum, aNum);
                }}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-2.5 text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-950"
              >
                <Sparkles className="h-4 w-4" />
                <span>التفسير</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const sNum = selectedAyah.surah?.number ?? 1;
                  onToggleBookmark({
                    id: `ayah:${sNum}:${selectedAyah.numberInSurah}`,
                    type: 'ayah',
                    page: currentPage,
                    surahNumber: sNum,
                    surahName: selectedAyah.surah?.name,
                    ayahNumber: selectedAyah.numberInSurah,
                    ayahText: stripLeadingBasmala(
                      selectedAyah.text,
                      sNum,
                      selectedAyah.numberInSurah
                    ),
                    createdAt: Date.now(),
                  });
                }}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-2.5 text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-950"
              >
                <Bookmark className="h-4 w-4" />
                <span>
                  {bookmarks.some(
                    (b) =>
                      b.type === 'ayah' &&
                      b.surahNumber === (selectedAyah.surah?.number ?? 1) &&
                      b.ayahNumber === selectedAyah.numberInSurah
                  )
                    ? 'إزالة العلامة'
                    : 'حفظ علامة الآية'}
                </span>
              </button>

              <button
                type="button"
                disabled={sharingAyah}
                onClick={() => void handleShareAyah(selectedAyah)}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-2.5 text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-950 disabled:opacity-50"
              >
                {sharingAyah ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                <span>مشاركة كصورة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Index Modal: Surahs / Juz / Page */}
      {activeModal === 'index' && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={() => setActiveModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="فهرس المصحف"
            className="flex w-full max-w-xl flex-col rounded-t-3xl sm:rounded-3xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-black max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-black dark:text-white">فهرس المصحف</h2>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                aria-label="إغلاق الفهرس"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Segmented tabs */}
            <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
              {(['surah', 'juz', 'page'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setIndexTab(t)}
                  className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                    indexTab === t
                      ? 'bg-white text-black shadow-xs dark:bg-black dark:text-white'
                      : 'text-neutral-600 hover:text-black dark:text-neutral-400 dark:hover:text-white'
                  }`}
                >
                  {t === 'surah' ? 'السور (١١٤)' : t === 'juz' ? 'الأجزاء (٣٠)' : 'الصفحة (٦٠٤)'}
                </button>
              ))}
            </div>

            {metaLoading && indexTab !== 'page' ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-neutral-500">
                <Loader2 className="h-6 w-6 animate-spin text-black dark:text-white" />
                <span>جارٍ تحميل الفهرس...</span>
              </div>
            ) : metaError && indexTab !== 'page' ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">{metaError}</p>
                <button
                  type="button"
                  onClick={onRetryMeta}
                  className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>إعادة المحاولة</span>
                </button>
              </div>
            ) : indexTab === 'surah' ? (
              <>
                <input
                  type="search"
                  value={surahFilter}
                  onChange={(e) => setSurahFilter(e.target.value)}
                  placeholder="ابحث باسم السورة أو رقمها..."
                  className="mb-3 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-black placeholder:text-neutral-400 focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
                />
                <div className="flex-1 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800">
                  {filteredSurahs.map((surah) => {
                    const startPage = resolvePageFromMeta(
                      meta?.pages.references,
                      surah.number,
                      1
                    );
                    return (
                      <button
                        key={surah.number}
                        type="button"
                        onClick={() => {
                          setActiveModal(null);
                          onChangePage(startPage);
                        }}
                        className="flex w-full min-h-[56px] items-center justify-between gap-3 py-2.5 px-2 text-right hover:bg-neutral-50 dark:hover:bg-neutral-950 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-bold tabular-nums">
                            {toArabicDigits(surah.number)}
                          </span>
                          <div>
                            <div className="font-quran text-base font-bold text-black dark:text-white">
                              {surah.name}
                            </div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400">
                              {getRevelationLabel(surah.revelationType)} ·{' '}
                              {toArabicDigits(surah.numberOfAyahs)} آية
                            </div>
                          </div>
                        </div>
                        <span className="text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                          ص {toArabicDigits(startPage)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : indexTab === 'juz' ? (
              <div className="flex-1 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800">
                {(meta?.juzs.references ?? []).map((juzRef, idx) => {
                  const juzNumber = idx + 1;
                  const surahObj = meta?.surahs.references.find(
                    (s) => s.number === juzRef.surah
                  );
                  const startPage = resolvePageFromMeta(
                    meta?.pages.references,
                    juzRef.surah,
                    juzRef.ayah
                  );
                  return (
                    <button
                      key={juzNumber}
                      type="button"
                      onClick={() => {
                        setActiveModal(null);
                        onChangePage(startPage);
                      }}
                      className="flex w-full min-h-[54px] items-center justify-between gap-3 py-2.5 px-2 text-right hover:bg-neutral-50 dark:hover:bg-neutral-950 rounded-xl"
                    >
                      <div>
                        <div className="text-sm font-bold text-black dark:text-white">
                          الجزء {toArabicDigits(juzNumber)}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">
                          {surahObj?.name ?? ''} · الآية {toArabicDigits(juzRef.ayah)}
                        </div>
                      </div>
                      <span className="text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
                        ص {toArabicDigits(startPage)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const num = Number(pageJumpInput);
                  if (Number.isFinite(num) && num >= 1 && num <= 604) {
                    setActiveModal(null);
                    onChangePage(Math.floor(num));
                  }
                }}
                className="space-y-4 py-4"
              >
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  أدخل رقم الصفحة (١ إلى ٦٠٤)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={604}
                    value={pageJumpInput}
                    onChange={(e) => setPageJumpInput(e.target.value)}
                    className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base font-bold tabular-nums text-black focus:border-black focus:outline-none dark:border-neutral-700 dark:bg-black dark:text-white dark:focus:border-white"
                  />
                  <button
                    type="submit"
                    className="min-h-[48px] rounded-xl bg-black px-6 text-sm font-semibold text-white dark:bg-white dark:text-black"
                  >
                    انتقال
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Search Modal */}
      {activeModal === 'search' && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={() => setActiveModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="البحث في القرآن الكريم"
            className="flex w-full max-w-xl flex-col rounded-t-3xl sm:rounded-3xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-black max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-black dark:text-white">
                البحث في القرآن الكريم
              </h2>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                aria-label="إغلاق البحث"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="mb-3 flex gap-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="اكتب كلمة أو جملة قرآنية..."
                className="flex-1 rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-black placeholder:text-neutral-400 focus:border-black focus:outline-none dark:border-neutral-700 dark:bg-black dark:text-white dark:focus:border-white"
              />
              <button
                type="submit"
                disabled={searching}
                className="min-h-[44px] rounded-xl bg-black px-4 text-xs font-semibold text-white dark:bg-white dark:text-black disabled:opacity-50"
              >
                {searching ? 'يبحث...' : 'بحث'}
              </button>
            </form>

            {searching ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-sm text-neutral-500">
                <Loader2 className="h-6 w-6 animate-spin text-black dark:text-white" />
                <span>جارٍ البحث...</span>
              </div>
            ) : searchError ? (
              <div className="py-8 text-center text-sm text-neutral-700 dark:text-neutral-300">
                {searchError}
              </div>
            ) : searchedOnce && searchResults.length === 0 ? (
              <div className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
                لا توجد نتائج مطابقة لهذا البحث.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800">
                {searchCount > 0 && (
                  <div className="pb-2 text-xs text-neutral-500 dark:text-neutral-400">
                    عدد النتائج: {toArabicDigits(searchCount)}
                  </div>
                )}
                {searchResults.slice(0, 60).map((match) => (
                  <button
                    key={`${match.number}-${match.surah.number}`}
                    type="button"
                    onClick={() => handleJumpToMatch(match)}
                    className="w-full py-3 px-2 text-right hover:bg-neutral-50 dark:hover:bg-neutral-950 rounded-xl"
                  >
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                      <span>
                        {match.surah.name} · الآية {toArabicDigits(match.numberInSurah)}
                      </span>
                      <span>انتقال</span>
                    </div>
                    <p className="font-quran text-base leading-relaxed text-black dark:text-white">
                      {match.text}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bookmarks Modal */}
      {activeModal === 'bookmarks' && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={() => setActiveModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="العلامات المرجعية"
            className="flex w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-black max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-black dark:text-white">
                العلامات المرجعية ({toArabicDigits(bookmarks.length)})
              </h2>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                aria-label="إغلاق العلامات"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {bookmarks.length === 0 ? (
              <div className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
                لا توجد علامات محفوظة بعد. اضغط على أي آية أو زر حفظ الصفحة لإضافتها.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800">
                {bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    className="flex items-center justify-between gap-2 py-3 px-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveModal(null);
                        onChangePage(bm.page);
                      }}
                      className="flex-1 text-right"
                    >
                      <div className="text-sm font-bold text-black dark:text-white">
                        {bm.type === 'ayah'
                          ? `${bm.surahName ?? ''} · الآية ${toArabicDigits(bm.ayahNumber ?? 1)}`
                          : `صفحة ${toArabicDigits(bm.page)}`}
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-1">
                        {bm.type === 'ayah'
                          ? bm.ayahText
                          : `${bm.surahName ?? ''} · صفحة ${toArabicDigits(bm.page)}`}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleBookmark(bm)}
                      aria-label="حذف العلامة"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-black dark:hover:bg-neutral-900 dark:hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Typography & Tajweed Quick Settings Modal */}
      {activeModal === 'typography' && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={() => setActiveModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="إعدادات العرض والخط"
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-black dark:text-white">إعدادات القراءة</h2>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                aria-label="إغلاق"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                  <span>حجم خط المصحف</span>
                  <span className="tabular-nums">{toArabicDigits(fontSize)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onChangeFontSize(Math.max(18, fontSize - 2))}
                    className="flex h-10 w-12 items-center justify-center rounded-xl border border-neutral-200 text-xs font-bold dark:border-neutral-800"
                  >
                    A-
                  </button>
                  <input
                    type="range"
                    aria-label="حجم الخط"
                    min={18}
                    max={38}
                    step={1}
                    value={fontSize}
                    onChange={(e) => onChangeFontSize(Number(e.target.value))}
                    className="flex-1 accent-black dark:accent-white"
                  />
                  <button
                    type="button"
                    onClick={() => onChangeFontSize(Math.min(38, fontSize + 2))}
                    className="flex h-10 w-12 items-center justify-center rounded-xl border border-neutral-200 text-sm font-bold dark:border-neutral-800"
                  >
                    A+
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={onToggleTajweed}
                className="flex w-full min-h-[48px] items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-neutral-800"
              >
                <span>تلوين التجويد التقريبي</span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                    tajweedEnabled
                      ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                      : 'border-neutral-300 dark:border-neutral-700'
                  }`}
                >
                  {tajweedEnabled && <Check className="h-3.5 w-3.5" />}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reciter Picker Bottom Sheet */}
      <ReciterSheet
        open={reciterSheetOpen}
        onClose={() => setReciterSheetOpen(false)}
        reciters={reciters}
        loading={recitersLoading}
        error={recitersError}
        onRetry={onRetryReciters}
        selectedReciterId={selectedReciterId}
        onSelectReciter={onSelectReciter}
      />
    </div>
  );
}
