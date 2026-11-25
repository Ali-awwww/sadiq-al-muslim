import {
  Bookmark,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  Mic,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sun,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '../context/AudioContext';
import { getAvailableSurahsForMoshaf, searchQuran } from '../lib/api';
import {
  getRevelationLabel,
  resolveJuzFromMeta,
  resolvePageFromMeta,
  toArabicDigits,
} from '../lib/arabic';
import { fetchAndCacheMushafSvg, preloadMushafSvg } from '../lib/cache';
import type {
  BookmarkItem,
  LastReadPosition,
  QuranMeta,
  Reciter,
  SearchMatch,
} from '../types/quran';
import { ReciterSheet } from './ReciterSheet';

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
  pageZoom: number;
  onChangePageZoom: (zoom: number) => void;
  isDark: boolean;
  onToggleDark: () => void;
  bookmarks: BookmarkItem[];
  onToggleBookmark: (item: BookmarkItem) => void;
  lastRead: LastReadPosition | null;
  onUpdateLastRead: (pos: LastReadPosition) => void;
  completedPages: number[];
  onTogglePageCompleted: (page: number) => void;
}

type ModalKind = null | 'index' | 'search' | 'bookmarks' | 'zoom';

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
  pageZoom,
  onChangePageZoom,
  isDark,
  onToggleDark,
  bookmarks,
  onToggleBookmark,
  lastRead,
  onUpdateLastRead,
  completedPages,
  onTogglePageCompleted,
}: MushafReaderProps) {
  const { activeTrack, isPlaying, playSurahFromReciter, togglePlayPause } = useAudio();

  const [pageSvgUrl, setPageSvgUrl] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentObjectUrlRef = useRef<string | null>(null);

  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  const [indexTab, setIndexTab] = useState<'surah' | 'juz' | 'page'>('surah');
  const [surahFilter, setSurahFilter] = useState('');
  const [pageJumpInput, setPageJumpInput] = useState(String(currentPage));

  const [reciterSheetOpen, setReciterSheetOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searchCount, setSearchCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedOnce, setSearchedOnce] = useState(false);

  // Swipe / mouse drag state
  const dragStartRef = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);

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

  // Derive current Surah & Juz from AlQuran Cloud meta page references
  const pageStartRef = useMemo(() => {
    return meta?.pages.references?.[currentPage - 1] ?? null;
  }, [meta, currentPage]);

  const primarySurah = useMemo(() => {
    const surahNum = pageStartRef?.surah ?? (currentPage === 1 ? 1 : 2);
    const ref = meta?.surahs.references.find((s) => s.number === surahNum);
    return {
      surahNumber: surahNum,
      surahName:
        ref?.name ??
        (surahNum === 1 ? 'سُورَةُ ٱلْفَاتِحَةِ' : `سورة رقم ${toArabicDigits(surahNum)}`),
    };
  }, [meta, pageStartRef, currentPage]);

  const currentJuz = useMemo(() => {
    if (!pageStartRef || !meta?.juzs.references) return 1;
    return resolveJuzFromMeta(
      meta.juzs.references,
      pageStartRef.surah,
      pageStartRef.ayah
    );
  }, [meta, pageStartRef]);

  const loadPageSvg = useCallback(async (page: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAndCacheMushafSvg(page);
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
      }
      currentObjectUrlRef.current = res.objectUrl;
      setPageSvgUrl(res.objectUrl);
      setFromCache(res.fromCache);

      // Background preload adjacent pages (page - 1 and page + 1)
      void preloadMushafSvg(page - 1);
      void preloadMushafSvg(page + 1);
    } catch (err) {
      setPageSvgUrl(null);
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر تحميل صفحة المصحف. تحقق من الاتصال بالإنترنت.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPageSvg(currentPage);
  }, [currentPage, loadPageSvg]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(currentObjectUrlRef.current);
        currentObjectUrlRef.current = null;
      }
    };
  }, []);

  // Persist last read position by page
  useEffect(() => {
    onUpdateLastRead({
      page: currentPage,
      surahNumber: primarySurah.surahNumber,
      surahName: primarySurah.surahName,
      ayahNumber: pageStartRef?.ayah ?? 1,
      updatedAt: Date.now(),
    });
  }, [
    currentPage,
    primarySurah.surahNumber,
    primarySurah.surahName,
    pageStartRef?.ayah,
    onUpdateLastRead,
  ]);

  const currentReciter = useMemo(
    () => reciters.find((r) => r.id === selectedReciterId) ?? reciters[0] ?? null,
    [reciters, selectedReciterId]
  );

  const isPageBookmarked = bookmarks.some((b) => b.page === currentPage && b.type === 'page');
  const isPageCompleted = completedPages.includes(currentPage);

  const isPlayingCurrentPageSurah = Boolean(
    activeTrack &&
      activeTrack.kind === 'surah' &&
      activeTrack.surahNumber === primarySurah.surahNumber &&
      isPlaying
  );

  const handlePlayPageSurah = async () => {
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
    setActiveModal(null);
    onChangePage(resolvedPage);
  };

  const handlePageJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(pageJumpInput);
    if (Number.isFinite(num) && num >= 1 && num <= 604) {
      setActiveModal(null);
      onChangePage(Math.floor(num));
    }
  };

  // Pointer swipe / mouse drag handlers (RTL: left = next page, right = prev page)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, active: true };
    setDragOffsetX(0);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current?.active) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 16) {
      return;
    }
    setDragOffsetX(Math.max(-90, Math.min(90, dx * 0.45)));
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current?.active) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = null;
    setDragOffsetX(0);

    // Require clear horizontal swipe/drag (>= 55px and mostly horizontal)
    if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0 && currentPage < 604) {
        // Swipe left in RTL -> Next page
        onChangePage(currentPage + 1);
      } else if (dx > 0 && currentPage > 1) {
        // Swipe right in RTL -> Previous page
        onChangePage(currentPage - 1);
      }
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
              {primarySurah.surahName}
            </span>
          </button>

          <div className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
            <span>الجزء {toArabicDigits(currentJuz)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              صفحة {toArabicDigits(currentPage)} من {toArabicDigits(604)}
            </span>
          </div>
        </div>

        {/* Utility buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handlePlayPageSurah}
            aria-label={isPlayingCurrentPageSurah ? 'إيقاف تلاوة الصفحة' : 'تشغيل تلاوة الصفحة'}
            title="تشغيل تلاوة الصفحة"
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
            onClick={() => setActiveModal('zoom')}
            aria-label="تكبير وتصغير عرض الصفحة"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            <ZoomIn className="h-4 w-4" />
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

      {/* Secondary metadata & offline / bookmark / resume bar */}
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
            onClick={() =>
              onToggleBookmark({
                id: `page:${currentPage}`,
                type: 'page',
                page: currentPage,
                surahNumber: primarySurah.surahNumber,
                surahName: primarySurah.surahName,
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

      {/* Authentic Madani Mushaf SVG Page Canvas (Always Cream Paper, Never Inverted in Dark Mode) */}
      <main className="w-full overflow-x-auto">
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          className="mx-auto select-none touch-pan-y cursor-grab active:cursor-grabbing rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-[#FAF6EC] p-2 sm:p-4 shadow-xs transition-transform duration-150 ease-out"
          style={{
            width: `${pageZoom}%`,
            maxWidth: pageZoom <= 100 ? '640px' : `${Math.round(640 * (pageZoom / 100))}px`,
            minWidth: '280px',
            transform: dragOffsetX !== 0 ? `translateX(${dragOffsetX}px)` : undefined,
          }}
        >
          <div className="relative w-full aspect-[510.236/729.448] overflow-hidden rounded-xl bg-[#FAF6EC] flex items-center justify-center">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 text-sm text-neutral-700">
                <Loader2 className="h-7 w-7 animate-spin text-black" />
                <span>جارٍ تحميل صفحة {toArabicDigits(currentPage)}...</span>
              </div>
            ) : error || !pageSvgUrl ? (
              <div className="flex flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="text-sm font-medium text-neutral-800 max-w-sm">
                  {error || 'تعذر تحميل صورة الصفحة'}
                </p>
                <button
                  type="button"
                  onClick={() => void loadPageSvg(currentPage)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-semibold text-white"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>إعادة المحاولة</span>
                </button>
              </div>
            ) : (
              <img
                src={pageSvgUrl}
                alt={`صفحة ${currentPage} من المصحف المدني`}
                draggable={false}
                className="h-full w-full object-contain pointer-events-none"
              />
            )}
          </div>

          {/* Page Footer (always readable neutral on cream paper) */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-300/70 pt-3 text-xs text-neutral-700">
            <span className="tabular-nums font-medium">
              صفحة {toArabicDigits(currentPage)} من {toArabicDigits(604)}
            </span>

            <button
              type="button"
              onClick={() => onTogglePageCompleted(currentPage)}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                isPageCompleted
                  ? 'border-black bg-black text-white'
                  : 'border-neutral-400 bg-white/70 text-black hover:bg-white'
              }`}
            >
              <BookOpenCheck className="h-3.5 w-3.5" />
              <span>{isPageCompleted ? 'تمت قراءة الصفحة' : 'تحديد كمقروءة للختمة'}</span>
            </button>
          </div>
        </div>
      </main>

      {/* Bottom Prev / Direct Page Jump Input / Next Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChangePage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-35 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-black dark:text-white dark:hover:bg-neutral-950"
        >
          <ChevronRight className="h-4 w-4" />
          <span>الصفحة السابقة</span>
        </button>

        <form onSubmit={handlePageJumpSubmit} className="flex items-center gap-1.5">
          <input
            type="number"
            aria-label="رقم الصفحة من ١ إلى ٦٠٤"
            min={1}
            max={604}
            value={pageJumpInput}
            onChange={(e) => setPageJumpInput(e.target.value)}
            className="h-11 w-16 rounded-xl border border-neutral-200 bg-white px-2 text-center text-xs font-bold tabular-nums text-black focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
          />
          <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
            من {toArabicDigits(604)}
          </span>
          <button
            type="submit"
            className="min-h-[44px] rounded-xl border border-neutral-200 px-3 text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            انتقال
          </button>
        </form>

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
              <form onSubmit={handlePageJumpSubmit} className="space-y-4 py-4">
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
                {searchResults.slice(0, 60).map((match) => {
                  const targetPage =
                    match.page ??
                    resolvePageFromMeta(
                      meta?.pages.references,
                      match.surah.number,
                      match.numberInSurah
                    );
                  return (
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
                        <span className="tabular-nums">ص {toArabicDigits(targetPage)}</span>
                      </div>
                      <p className="font-quran text-base leading-relaxed text-black dark:text-white">
                        {match.text}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bookmarks Modal (Page-based) */}
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
                لا توجد علامات محفوظة بعد. اضغط على زر حفظ الصفحة لإضافتها.
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
                      <div className="text-sm font-bold text-black dark:text-white tabular-nums">
                        صفحة {toArabicDigits(bm.page)}
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-1">
                        {bm.surahName ?? 'المصحف المدني'}
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

      {/* Page Width Zoom Modal */}
      {activeModal === 'zoom' && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={() => setActiveModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="تكبير وتصغير عرض الصفحة"
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-black dark:text-white">
                حجم عرض صفحة المصحف
              </h2>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                aria-label="إغلاق"
                className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span>العرض</span>
                <span className="tabular-nums">{toArabicDigits(pageZoom)}%</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="تصغير عرض الصفحة"
                  onClick={() => onChangePageZoom(Math.max(60, pageZoom - 10))}
                  className="flex h-10 w-12 items-center justify-center rounded-xl border border-neutral-200 text-black dark:border-neutral-800 dark:text-white"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <input
                  type="range"
                  aria-label="نسبة عرض الصفحة"
                  min={60}
                  max={130}
                  step={5}
                  value={pageZoom}
                  onChange={(e) => onChangePageZoom(Number(e.target.value))}
                  className="flex-1 accent-black dark:accent-white"
                />
                <button
                  type="button"
                  aria-label="تكبير عرض الصفحة"
                  onClick={() => onChangePageZoom(Math.min(130, pageZoom + 10))}
                  className="flex h-10 w-12 items-center justify-center rounded-xl border border-neutral-200 text-black dark:border-neutral-800 dark:text-white"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => onChangePageZoom(100)}
                  className="text-xs font-semibold text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white"
                >
                  إعادة الضبط (١٠٠٪)
                </button>
              </div>
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
