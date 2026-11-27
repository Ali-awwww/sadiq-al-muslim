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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '../context/AudioContext';
import { fetchMushafPage, getAvailableSurahsForMoshaf, searchQuran } from '../lib/api';
import {
  getRevelationLabel,
  resolveJuzFromMeta,
  resolvePageFromMeta,
  toArabicDigits,
} from '../lib/arabic';
import {
  getFirstAyahForPage,
  getLocationForGlobalAyah,
} from '../lib/audioSync';
import { fetchAndCacheMushafSvg, preloadMushafSvg } from '../lib/cache';
import type {
  BookmarkItem,
  LastReadPosition,
  MushafPageData,
  QuranMeta,
  Reciter,
  SearchMatch,
} from '../types/quran';
import { ReciterSheet } from './ReciterSheet';
import {
  calculateMushafScale,
  clampValue,
  computeDragVisualOffset,
  determineSwipeAxis,
  evaluateSwipeRelease,
  MUSHAF_PAGE_HEIGHT,
  MUSHAF_PAGE_WIDTH,
  type SwipeAxis,
} from '../lib/mushafLayout';

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
  onTogglePageCompleted: (page: number) => void; onControlsVisibleChange?: (visible: boolean) => void;
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
  onTogglePageCompleted, onControlsVisibleChange,
}: MushafReaderProps) {
  const {
    activeTrack,
    isPlaying,
    activeAyahGlobalNumber,
    jumpToSurahAyah,
    togglePlayPause,
  } = useAudio();

  const [pageSvgUrl, setPageSvgUrl] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const svgObjectUrlMapRef = useRef<Map<number, string>>(new Map());
  const loadSeqRef = useRef<number>(0);

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

  // Viewport & DOM-direct gesture state (zero React setState during pointermove)
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageStageRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height:
      typeof window !== 'undefined'
        ? (window.visualViewport?.height ?? window.innerHeight)
        : 844,
  }));
  const panOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isTransitioningRef = useRef<boolean>(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEnterOffsetRef = useRef<number | null>(null);
  const dragStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startPanX: number;
    startPanY: number;
    t: number;
    lockedAxis: SwipeAxis;
    lastSwipeDeltaX: number;
    hasFlipped: boolean;
    active: boolean;
  } | null>(null);

  // Two-way audio-page synchronization state
  const [isSyncedToAudio, setIsSyncedToAudio] = useState(true);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [currentPageData, setCurrentPageData] = useState<MushafPageData | null>(null);
  const lastAutoFlippedPageRef = useRef<number | null>(null);
  const prevAudioPageRef = useRef<number | null>(null);

  // Auto-hide controls: hidden by default, toggled on page tap, auto-hides after ~3s of inactivity
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback(() => {
    clearHideTimer();
    if (!activeModal && !reciterSheetOpen) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  }, [clearHideTimer, activeModal, reciterSheetOpen]);

  useEffect(() => {
    if (controlsVisible && !activeModal && !reciterSheetOpen) {
      scheduleAutoHide();
    } else {
      clearHideTimer();
    }
    return () => clearHideTimer();
  }, [controlsVisible, activeModal, reciterSheetOpen, scheduleAutoHide, clearHideTimer]);

  useEffect(() => {
    onControlsVisibleChange?.(controlsVisible);
  }, [controlsVisible, onControlsVisibleChange]);

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

  // Measure actual available viewport height/width for full-screen edge-to-edge uniform scaling
  const measureViewport = useCallback(() => {
    const el = viewportRef.current;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      setViewportSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight }
      );
    } else if (typeof window !== 'undefined') {
      const w = window.innerWidth;
      const h = Math.round(window.visualViewport?.height ?? window.innerHeight);
      setViewportSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );
    }
  }, []);

  useLayoutEffect(() => {
    measureViewport();
    const el = viewportRef.current;
    let observer: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measureViewport);
      observer.observe(el);
    }
    window.addEventListener('resize', measureViewport);
    window.addEventListener('orientationchange', measureViewport);
    window.visualViewport?.addEventListener('resize', measureViewport);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureViewport);
      window.removeEventListener('orientationchange', measureViewport);
      window.visualViewport?.removeEventListener('resize', measureViewport);
    };
  }, [measureViewport]);

  // Uniform scale calculation: scale = max(width / 510.236, height / 729.448)
  const layout = useMemo(() => {
    return calculateMushafScale(viewportSize, {
      width: MUSHAF_PAGE_WIDTH,
      height: MUSHAF_PAGE_HEIGHT,
    });
  }, [viewportSize]);

  const zoomFactor = pageZoom / 100;
  const pageWidthPx = Math.round(layout.scaledWidth * zoomFactor);
  const pageHeightPx = Math.round(layout.scaledHeight * zoomFactor);
  const maxPanX = Math.max(0, (pageWidthPx - viewportSize.width) / 2);
  const maxPanY = Math.max(0, (pageHeightPx - viewportSize.height) / 2);

  const applyStageTransform = useCallback(
    (x: number, y: number, opacity = 1, transition = 'none') => {
      const el = pageStageRef.current;
      if (!el) return;
      el.style.transition = transition;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      el.style.opacity = String(opacity);
    },
    []
  );

  // Handle smooth incoming settle after a swipe flip, or clean instant reset on non-swipe page changes
  useLayoutEffect(() => {
    panOffsetRef.current = { x: 0, y: 0 };
    const enterX = pendingEnterOffsetRef.current;
    if (enterX !== null) {
      pendingEnterOffsetRef.current = null;
      applyStageTransform(enterX, 0, 0.25, 'none');

      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
      }

      let raf1 = 0;
      let raf2 = 0;
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          applyStageTransform(
            0,
            0,
            1,
            'transform 170ms cubic-bezier(0.22, 1, 0.36, 1), opacity 170ms ease-out'
          );
          enterTimerRef.current = setTimeout(() => {
            applyStageTransform(0, 0, 1, 'none');
            isTransitioningRef.current = false;
            enterTimerRef.current = null;
          }, 180);
        });
      });

      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    if (!dragStartRef.current?.active && !isTransitioningRef.current) {
      applyStageTransform(0, 0, 1, 'none');
    }
  }, [currentPage, applyStageTransform]);

  // Clamp DOM pan offset cleanly when zoom or viewport changes without triggering drag resets
  useLayoutEffect(() => {
    const clampedX = clampValue(panOffsetRef.current.x, -maxPanX, maxPanX);
    const clampedY = clampValue(panOffsetRef.current.y, -maxPanY, maxPanY);
    panOffsetRef.current = { x: clampedX, y: clampedY };
    if (!dragStartRef.current?.active && !isTransitioningRef.current) {
      applyStageTransform(clampedX, clampedY, 1, 'none');
    }
  }, [maxPanX, maxPanY, applyStageTransform]);

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

  const warmPageObjectUrl = useCallback(async (page: number) => {
    if (page < 1 || page > 604) return;
    if (svgObjectUrlMapRef.current.has(page)) return;
    try {
      const res = await fetchAndCacheMushafSvg(page);
      if (svgObjectUrlMapRef.current.has(page)) {
        URL.revokeObjectURL(res.objectUrl);
      } else {
        svgObjectUrlMapRef.current.set(page, res.objectUrl);
      }
    } catch {
      // silent prewarm failure
    }
  }, []);

  const pruneDistantObjectUrls = useCallback((anchorPage: number) => {
    for (const [p, url] of svgObjectUrlMapRef.current.entries()) {
      if (Math.abs(p - anchorPage) > 4) {
        URL.revokeObjectURL(url);
        svgObjectUrlMapRef.current.delete(p);
      }
    }
  }, []);

  const loadPageSvg = useCallback(
    async (page: number) => {
      const seq = ++loadSeqRef.current;
      setError(null);

      const memoryCachedUrl = svgObjectUrlMapRef.current.get(page);
      if (memoryCachedUrl) {
        setPageSvgUrl(memoryCachedUrl);
        setFromCache(true);
        setLoading(false);
        pruneDistantObjectUrls(page);
        void warmPageObjectUrl(page - 1);
        void warmPageObjectUrl(page + 1);
        void preloadMushafSvg(page - 2);
        void preloadMushafSvg(page + 2);
        return;
      }

      setLoading((prev) => prev || !svgObjectUrlMapRef.current.size);
      try {
        const res = await fetchAndCacheMushafSvg(page);
        if (loadSeqRef.current !== seq) {
          if (!svgObjectUrlMapRef.current.has(page)) {
            svgObjectUrlMapRef.current.set(page, res.objectUrl);
          } else {
            URL.revokeObjectURL(res.objectUrl);
          }
          return;
        }
        const existing = svgObjectUrlMapRef.current.get(page);
        if (existing) {
          URL.revokeObjectURL(res.objectUrl);
          setPageSvgUrl(existing);
        } else {
          svgObjectUrlMapRef.current.set(page, res.objectUrl);
          setPageSvgUrl(res.objectUrl);
        }
        setFromCache(res.fromCache);
        pruneDistantObjectUrls(page);

        // Warm adjacent pages into memory + Cache API for instant zero-flicker swipes
        void warmPageObjectUrl(page - 1);
        void warmPageObjectUrl(page + 1);
        void preloadMushafSvg(page - 2);
        void preloadMushafSvg(page + 2);
      } catch (err) {
        if (loadSeqRef.current !== seq) return;
        setPageSvgUrl(null);
        setError(
          err instanceof Error
            ? err.message
            : 'تعذر تحميل صفحة المصحف. تحقق من الاتصال بالإنترنت.'
        );
      } finally {
        if (loadSeqRef.current === seq) {
          setLoading(false);
        }
      }
    },
    [pruneDistantObjectUrls, warmPageObjectUrl]
  );

  useEffect(() => {
    void loadPageSvg(currentPage);
  }, [currentPage, loadPageSvg]);

  // Cleanup all cached object URLs & transition timers on unmount
  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      for (const url of svgObjectUrlMapRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      svgObjectUrlMapRef.current.clear();
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

  const currentPageAnchor = useMemo(
    () => getFirstAyahForPage(meta, currentPage),
    [meta, currentPage]
  );

  const activeAudioLocation = useMemo(
    () => getLocationForGlobalAyah(meta, activeAyahGlobalNumber),
    [meta, activeAyahGlobalNumber]
  );

  const audioPage = activeAudioLocation?.page ?? null;

  // Fetch cached/live page text metadata while audio is playing to display active ayah indicator
  useEffect(() => {
    if (!activeTrack) {
      setCurrentPageData(null);
      return;
    }
    let cancelled = false;
    fetchMushafPage(currentPage)
      .then((res) => {
        if (!cancelled) setCurrentPageData(res.data);
      })
      .catch(() => {
        if (!cancelled) setCurrentPageData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTrack, currentPage]);

  // Detect manual page changes vs auto-follow page flips
  useEffect(() => {
    if (lastAutoFlippedPageRef.current === currentPage) {
      lastAutoFlippedPageRef.current = null;
      return;
    }
    if (activeTrack && audioPage !== null) {
      setIsSyncedToAudio(audioPage === currentPage);
    }
  }, [currentPage, activeTrack, audioPage]);

  // Auto-follow: flip page automatically when active recited ayah moves to a new page
  useEffect(() => {
    if (!isPlaying || !isSyncedToAudio || !activeAudioLocation) {
      prevAudioPageRef.current = activeAudioLocation?.page ?? null;
      return;
    }

    const nextAudioPage = activeAudioLocation.page;
    const prevAudioPage = prevAudioPageRef.current;
    prevAudioPageRef.current = nextAudioPage;

    if (dragStartRef.current?.active || isTransitioningRef.current) return;

    if (nextAudioPage !== currentPage && nextAudioPage !== prevAudioPage) {
      lastAutoFlippedPageRef.current = nextAudioPage;
      onChangePage(nextAudioPage);
    }
  }, [isPlaying, isSyncedToAudio, activeAudioLocation, currentPage, onChangePage]);

  const currentReciter = useMemo(
    () => reciters.find((r) => r.id === selectedReciterId) ?? reciters[0] ?? null,
    [reciters, selectedReciterId]
  );

  const isPageBookmarked = bookmarks.some((b) => b.page === currentPage && b.type === 'page');
  const isPageCompleted = completedPages.includes(currentPage);

  const isAudioSyncedOnCurrentPage = Boolean(
    activeTrack &&
      isSyncedToAudio &&
      (audioPage !== null
        ? audioPage === currentPage
        : activeTrack.surahNumber === currentPageAnchor.surahNumber)
  );

  const isPlayingCurrentPage = isAudioSyncedOnCurrentPage && isPlaying;

  const isAudioOnDifferentPage = Boolean(
    activeTrack &&
      activeTrack.kind === 'surah' &&
      audioPage !== null &&
      audioPage !== currentPage
  );

  const startPlaybackFromCurrentPage = useCallback(async () => {
    setSyncNotice(null);
    if (!currentReciter || currentReciter.moshaf.length === 0) {
      setReciterSheetOpen(true);
      return;
    }

    const targetSurah = currentPageAnchor.surahNumber;
    const targetSurahRef = meta?.surahs.references.find((s) => s.number === targetSurah);
    const targetSurahName =
      targetSurahRef?.name ??
      (targetSurah === primarySurah.surahNumber
        ? primarySurah.surahName
        : `سورة رقم ${toArabicDigits(targetSurah)}`);

    const moshaf = currentReciter.moshaf.find((m) =>
      getAvailableSurahsForMoshaf(m).has(targetSurah)
    );

    if (!moshaf) {
      setSyncNotice('هذه السورة غير متوفرة لدى القارئ المختار، اختر قارئاً آخر.');
      setReciterSheetOpen(true);
      return;
    }

    const availableSet = getAvailableSurahsForMoshaf(moshaf);
    const queueSurahs = (meta?.surahs.references ?? [])
      .filter((s) => availableSet.has(s.number))
      .map((s) => ({ number: s.number, name: s.name }));

    setIsSyncedToAudio(true);
    await jumpToSurahAyah(
      currentReciter,
      moshaf,
      targetSurah,
      targetSurahName,
      currentPageAnchor.ayahNumber,
      queueSurahs.length > 0
        ? queueSurahs
        : [{ number: targetSurah, name: targetSurahName }],
      currentPageAnchor.globalAyahNumber
    );
  }, [
    currentPageAnchor,
    currentReciter,
    jumpToSurahAyah,
    meta,
    primarySurah.surahName,
    primarySurah.surahNumber,
  ]);

  const handlePlayPageSurah = async () => {
    if (isAudioSyncedOnCurrentPage) {
      togglePlayPause();
      return;
    }
    await startPlaybackFromCurrentPage();
  };

  useEffect(() => {
    if (!syncNotice) return;
    const t = setTimeout(() => setSyncNotice(null), 4000);
    return () => clearTimeout(t);
  }, [syncNotice]);

  const activePageAyahObj = useMemo(() => {
    if (!isAudioSyncedOnCurrentPage || !activeAudioLocation || !currentPageData?.ayahs) {
      return null;
    }
    return (
      currentPageData.ayahs.find(
        (a) =>
          a.number === activeAudioLocation.globalAyahNumber ||
          (a.surah?.number === activeAudioLocation.surahNumber &&
            a.numberInSurah === activeAudioLocation.ayahNumberInSurah)
      ) ?? null
    );
  }, [activeAudioLocation, currentPageData, isAudioSyncedOnCurrentPage]);

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

  // Pointer pan + swipe / mouse drag handlers (Arabic RTL book: right = next page, left = prev page)
  // Direct DOM transform updates via pageStageRef avoid React re-renders during drag.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isTransitioningRef.current) return;
    if (activeModal !== null || reciterSheetOpen) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (dragStartRef.current?.active) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore pointer capture unsupported
    }
    dragStartRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startPanX: panOffsetRef.current.x,
      startPanY: panOffsetRef.current.y,
      t: Date.now(),
      lockedAxis: null,
      lastSwipeDeltaX: 0,
      hasFlipped: false,
      active: true,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    if (!drag?.active || drag.pointerId !== e.pointerId || isTransitioningRef.current) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;

    drag.lockedAxis = determineSwipeAxis(dx, dy, drag.lockedAxis, 8);
    if (!drag.lockedAxis) return;

    const visual = computeDragVisualOffset({
      dx,
      dy,
      lockedAxis: drag.lockedAxis,
      startPanX: drag.startPanX,
      startPanY: drag.startPanY,
      maxPanX,
      maxPanY,
      currentPage,
    });

    panOffsetRef.current = { x: visual.nextPanX, y: visual.nextPanY };
    drag.lastSwipeDeltaX = visual.swipeDeltaX;
    applyStageTransform(visual.translateX, visual.translateY, 1, 'none');
  };

  const finishSwipeCancel = (targetPanX: number, targetPanY: number, hadSwipeOffset: boolean) => {
    if (!hadSwipeOffset) {
      applyStageTransform(targetPanX, targetPanY, 1, 'none');
      return;
    }
    isTransitioningRef.current = true;
    applyStageTransform(
      targetPanX,
      targetPanY,
      1,
      'transform 170ms cubic-bezier(0.22, 1, 0.36, 1)'
    );
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => {
      applyStageTransform(targetPanX, targetPanY, 1, 'none');
      isTransitioningRef.current = false;
      transitionTimerRef.current = null;
    }, 175);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    if (!drag?.active || drag.pointerId !== e.pointerId) return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const dt = Date.now() - drag.t;
    const alreadyFlipped = drag.hasFlipped;

    dragStartRef.current = null;

    if (alreadyFlipped || isTransitioningRef.current) return;

    // Tap (<10px displacement, <300ms) toggles controls visibility with ~3s auto-hide
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 300) {
      setControlsVisible((prev) => {
        const next = !prev;
        if (!next) {
          clearHideTimer();
        }
        return next;
      });
      return;
    }

    const finalAxis = determineSwipeAxis(dx, dy, drag.lockedAxis, 8);
    const finalVisual = computeDragVisualOffset({
      dx,
      dy,
      lockedAxis: finalAxis,
      startPanX: drag.startPanX,
      startPanY: drag.startPanY,
      maxPanX,
      maxPanY,
      currentPage,
    });
    panOffsetRef.current = { x: finalVisual.nextPanX, y: finalVisual.nextPanY };

    const release = evaluateSwipeRelease({
      swipeDeltaX: finalVisual.swipeDeltaX,
      dt,
      lockedAxis: finalAxis,
      viewportWidth: viewportSize.width,
      currentPage,
    });

    if (release.targetPage === null) {
      finishSwipeCancel(
        panOffsetRef.current.x,
        panOffsetRef.current.y,
        Math.abs(finalVisual.swipeDeltaX) > 0.5
      );
      return;
    }

    // Lock further pointer input until single eased page transition completes
    drag.hasFlipped = true;
    isTransitioningRef.current = true;
    const targetPage = release.targetPage;
    void warmPageObjectUrl(targetPage);

    applyStageTransform(
      release.exitOffsetX,
      panOffsetRef.current.y,
      0.15,
      'transform 125ms cubic-bezier(0.32, 0, 0.67, 0), opacity 125ms ease-out'
    );

    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = setTimeout(() => {
      transitionTimerRef.current = null;
      pendingEnterOffsetRef.current = release.enterOffsetX;
      onChangePage(targetPage);
    }, 125);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    if (!drag?.active || drag.pointerId !== e.pointerId) return;
    const hadSwipeOffset = Math.abs(drag.lastSwipeDeltaX) > 0.5;
    dragStartRef.current = null;
    if (!isTransitioningRef.current) {
      finishSwipeCancel(panOffsetRef.current.x, panOffsetRef.current.y, hadSwipeOffset);
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
    <div className="relative flex-1 min-h-0 w-full h-full bg-[#FAF6EC] overflow-hidden">
      {/* Compact Single-Row Floating Controls Bar (hidden by default; toggled on page tap) */}
      <header
        onClick={(e) => {
          e.stopPropagation();
          scheduleAutoHide();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          scheduleAutoHide();
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          scheduleAutoHide();
        }}
        className={
          'fixed top-0 left-0 right-0 z-30 pt-safe border-b border-neutral-200 bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-black/95 transition-opacity duration-300 ' +
          (controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0')
        }
      >
        <div className="mx-auto flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto px-2 py-1.5">
          {/* Index (Surah / Juz / Page) */}
          <button
            type="button"
            onClick={() => {
              setIndexTab('surah');
              setActiveModal('index');
            }}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 px-2.5 text-xs font-bold text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <List className="h-4 w-4 shrink-0" />
            <span>{primarySurah.surahName}</span>
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 tabular-nums">
              · ج{toArabicDigits(currentJuz)}
            </span>
          </button>

          {/* Prev Page */}
          <button
            type="button"
            onClick={() => onChangePage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            aria-label="الصفحة السابقة"
            className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-neutral-200 px-2.5 text-xs font-semibold text-black disabled:opacity-35 hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <ChevronRight className="h-4 w-4 shrink-0" />
            <span>السابقة</span>
          </button>

          {/* Direct Page Jump */}
          <form onSubmit={handlePageJumpSubmit} className="flex shrink-0 items-center gap-1">
            <input
              type="number"
              aria-label="رقم الصفحة من ١ إلى ٦٠٤"
              min={1}
              max={604}
              value={pageJumpInput}
              onChange={(e) => setPageJumpInput(e.target.value)}
              className="h-10 w-14 rounded-xl border border-neutral-200 bg-white px-1.5 text-center text-xs font-bold tabular-nums text-black focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
            />
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
              /{toArabicDigits(604)}
            </span>
            <button
              type="submit"
              className="h-10 rounded-xl border border-neutral-200 px-2.5 text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
            >
              انتقال
            </button>
          </form>

          {/* Next Page */}
          <button
            type="button"
            onClick={() => onChangePage(Math.min(604, currentPage + 1))}
            disabled={currentPage >= 604}
            aria-label="الصفحة التالية"
            className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-neutral-200 px-2.5 text-xs font-semibold text-black disabled:opacity-35 hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <span>التالية</span>
            <ChevronLeft className="h-4 w-4 shrink-0" />
          </button>

          {/* Play / Pause Surah Audio */}
          <button
            type="button"
            onClick={() => void handlePlayPageSurah()}
            aria-label={isPlayingCurrentPage ? 'إيقاف تلاوة الصفحة' : 'تشغيل تلاوة الصفحة'}
            title="تشغيل تلاوة الصفحة"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black text-white dark:bg-white dark:text-black transition-transform active:scale-95"
          >
            {isPlayingCurrentPage ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>

          {/* Reciter Picker */}
          <button
            type="button"
            onClick={() => setReciterSheetOpen(true)}
            aria-label="اختيار القارئ"
            title="اختيار القارئ"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 px-2.5 text-xs font-medium text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <Mic className="h-4 w-4 shrink-0" />
            <span className="max-w-[100px] truncate">
              {currentReciter ? currentReciter.name : 'القارئ'}
            </span>
          </button>

          {/* Bookmark Current Page */}
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
            className={
              'flex h-10 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-xs font-medium transition-colors whitespace-nowrap ' +
              (isPageBookmarked
                ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                : 'border-neutral-200 text-neutral-700 hover:text-black dark:border-neutral-800 dark:text-neutral-300 dark:hover:text-white')
            }
          >
            <Bookmark className="h-3.5 w-3.5 shrink-0" fill={isPageBookmarked ? 'currentColor' : 'none'} />
            <span>{isPageBookmarked ? 'محفوظة' : 'حفظ الصفحة'}</span>
          </button>

          {/* Mark Page Completed for Khatma */}
          <button
            type="button"
            onClick={() => onTogglePageCompleted(currentPage)}
            aria-label="تحديد كمقروءة للختمة"
            className={
              'flex h-10 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ' +
              (isPageCompleted
                ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                : 'border-neutral-200 text-neutral-700 hover:text-black dark:border-neutral-800 dark:text-neutral-300 dark:hover:text-white')
            }
          >
            <BookOpenCheck className="h-3.5 w-3.5 shrink-0" />
            <span>{isPageCompleted ? 'تمت قراءة الصفحة' : 'تحديد كمقروءة'}</span>
          </button>

          {/* Resume Last Read */}
          {lastRead && lastRead.page !== currentPage && (
            <button
              type="button"
              onClick={() => onChangePage(lastRead.page)}
              className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-neutral-200 px-2.5 text-xs font-medium text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
            >
              <span>متابعة (ص {toArabicDigits(lastRead.page)})</span>
            </button>
          )}

          {/* Search Quran */}
          <button
            type="button"
            onClick={() => setActiveModal('search')}
            aria-label="بحث في القرآن"
            title="بحث في القرآن"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Bookmarks List */}
          <button
            type="button"
            onClick={() => setActiveModal('bookmarks')}
            aria-label="العلامات المرجعية"
            title="العلامات المرجعية"
            className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-neutral-200 px-2.5 text-xs font-medium text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <Bookmark className="h-4 w-4 shrink-0" />
            <span>العلامات</span>
          </button>

          {/* Zoom */}
          <button
            type="button"
            onClick={() => setActiveModal('zoom')}
            aria-label="تكبير وتصغير عرض الصفحة"
            title="تكبير وتصغير عرض الصفحة"
            className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-neutral-200 px-2.5 text-xs font-medium text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950 whitespace-nowrap"
          >
            <ZoomIn className="h-4 w-4 shrink-0" />
            <span className="tabular-nums">{toArabicDigits(pageZoom)}%</span>
          </button>

          {/* Dark Mode Toggle */}
          <button
            type="button"
            onClick={onToggleDark}
            aria-label={isDark ? 'الوضع الفاتح' : 'الوضع الليلي'}
            title={isDark ? 'الوضع الفاتح' : 'الوضع الليلي'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* Offline / Cached Indicator */}
          {(fromCache || isOffline) && (
            <span className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl border border-neutral-200 px-2.5 text-[11px] font-medium text-black dark:border-neutral-800 dark:text-white whitespace-nowrap">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              <span>{isOffline ? 'دون اتصال' : 'محفوظ'}</span>
            </span>
          )}
        </div>
      </header>

      {/* Authentic Madani Mushaf SVG Page Canvas: Edge-to-edge uniform scaling with DOM-direct swipe/pan */}
      <main
        ref={viewportRef}
        dir="ltr"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerCancel}
        className="w-full h-full touch-none select-none cursor-grab active:cursor-grabbing bg-[#FAF6EC] overflow-hidden flex items-center justify-center"
      >
        <div
          ref={pageStageRef}
          className="relative shrink-0 flex items-center justify-center bg-[#FAF6EC]"
          style={{
            width: `${pageWidthPx}px`,
            height: `${pageHeightPx}px`,
            willChange: 'transform, opacity',
          }}
        >
          {loading && !pageSvgUrl ? (
            <div
              dir="rtl"
              className="flex flex-col items-center justify-center gap-3 text-sm text-neutral-700"
            >
              <Loader2 className="h-7 w-7 animate-spin text-black" />
              <span>جارٍ تحميل صفحة {toArabicDigits(currentPage)}...</span>
            </div>
          ) : error && !pageSvgUrl ? (
            <div
              dir="rtl"
              className="flex flex-col items-center justify-center gap-4 px-6 text-center"
            >
              <p className="text-sm font-medium text-neutral-800 max-w-sm">
                {error || 'تعذر تحميل صورة الصفحة'}
              </p>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={() => void loadPageSvg(currentPage)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-semibold text-white"
              >
                <RotateCcw className="h-4 w-4" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          ) : (
            <>
              {pageSvgUrl && (
                <img
                  src={pageSvgUrl}
                  alt={`صفحة ${currentPage} من المصحف المدني`}
                  width={pageWidthPx}
                  height={pageHeightPx}
                  draggable={false}
                  style={{
                    width: `${pageWidthPx}px`,
                    height: `${pageHeightPx}px`,
                    maxWidth: 'none',
                    maxHeight: 'none',
                  }}
                  className="block object-contain pointer-events-none select-none"
                />
              )}
              {loading && pageSvgUrl && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#FAF6EC]/30 pointer-events-none">
                  <Loader2 className="h-6 w-6 animate-spin text-black/50" />
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Audio Sync Action Bar (when audio is playing on another page) or Live Ayah Indicator */}
      {isAudioOnDifferentPage && audioPage !== null && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          className="fixed bottom-[150px] left-3 right-3 z-30 flex justify-center pointer-events-none"
        >
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-md dark:border-neutral-800 dark:bg-black/95">
            <button
              type="button"
              onClick={() => void startPlaybackFromCurrentPage()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-black px-3.5 py-1.5 text-xs font-bold text-white dark:bg-white dark:text-black transition-transform active:scale-95"
            >
              <Play className="h-3.5 w-3.5 shrink-0" />
              <span>تشغيل من هذه الصفحة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSyncedToAudio(true);
                onChangePage(audioPage);
              }}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-900"
            >
              <span>متابعة التلاوة (ص {toArabicDigits(audioPage)})</span>
            </button>
          </div>
        </div>
      )}

      {!isAudioOnDifferentPage && isAudioSyncedOnCurrentPage && activeAudioLocation && (
        <div className="fixed bottom-[150px] left-3 right-3 z-20 flex justify-center pointer-events-none">
          <div className="max-w-md rounded-2xl border border-neutral-200/90 bg-white/92 px-3.5 py-1.5 text-center shadow-xs backdrop-blur-md dark:border-neutral-800 dark:bg-black/92">
            <div className="text-[11px] font-bold text-black dark:text-white">
              {meta?.surahs.references.find((s) => s.number === activeAudioLocation.surahNumber)?.name ??
                primarySurah.surahName}{' '}
              · الآية {toArabicDigits(activeAudioLocation.ayahNumberInSurah)}
            </div>
            {activePageAyahObj?.text && (
              <p className="mt-0.5 truncate font-quran text-xs text-neutral-600 dark:text-neutral-300">
                {activePageAyahObj.text}
              </p>
            )}
          </div>
        </div>
      )}

      {syncNotice && (
        <div className="fixed top-16 left-3 right-3 z-40 flex justify-center pointer-events-none">
          <div className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-black shadow-sm dark:border-neutral-700 dark:bg-black dark:text-white">
            {syncNotice}
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
