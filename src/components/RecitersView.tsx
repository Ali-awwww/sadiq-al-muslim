import {
  ArrowRight,
  Check,
  Download,
  Headphones,
  ListMusic,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudio } from '../context/AudioContext';
import { getAvailableSurahsForMoshaf, getSurahAudioUrl } from '../lib/api';
import {
  formatAudioTime,
  getRevelationLabel,
  resolveJuzFromMeta,
  toArabicDigits,
} from '../lib/arabic';
import { cacheAndDownloadAudio, isAudioUrlCached } from '../lib/cache';
import type { QuranMeta, Reciter, SurahReference } from '../types/quran';

interface RecitersViewProps {
  reciters: Reciter[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  meta: QuranMeta | null;
  selectedDefaultReciterId: number;
}

export function RecitersView({
  reciters,
  loading,
  error,
  onRetry,
  meta,
  selectedDefaultReciterId,
}: RecitersViewProps) {
  const {
    activeTrack,
    isPlaying,
    isLoading: audioLoading,
    duration: activeDuration,
    playSurahFromReciter,
    togglePlayPause,
  } = useAudio();

  const [openReciterId, setOpenReciterId] = useState<number | null>(null);
  const [selectedMoshafIdx, setSelectedMoshafIdx] = useState(0);
  const [juzFilter, setJuzFilter] = useState<number | 'all'>('all');
  const [surahQuery, setSurahQuery] = useState('');

  const [cachedUrls, setCachedUrls] = useState<Record<string, boolean>>({});
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [albumDownloadState, setAlbumDownloadState] = useState<{
    active: boolean;
    done: number;
    total: number;
  }>({ active: false, done: 0, total: 0 });
  const cancelAlbumDownloadRef = useRef(false);

  const [durationsMap, setDurationsMap] = useState<Record<string, number>>({});
  const [loadingDurations, setLoadingDurations] = useState<Record<string, boolean>>({});

  const openReciter = useMemo(
    () => reciters.find((r) => r.id === openReciterId) ?? null,
    [reciters, openReciterId]
  );

  const activeMoshaf = useMemo(() => {
    if (!openReciter || openReciter.moshaf.length === 0) return null;
    return openReciter.moshaf[selectedMoshafIdx] ?? openReciter.moshaf[0];
  }, [openReciter, selectedMoshafIdx]);

  const availableSurahSet = useMemo(
    () => getAvailableSurahsForMoshaf(activeMoshaf ?? undefined),
    [activeMoshaf]
  );

  const allSurahs = useMemo<SurahReference[]>(
    () => meta?.surahs.references ?? [],
    [meta]
  );

  const filteredSurahs = useMemo(() => {
    return allSurahs.filter((s) => {
      if (juzFilter !== 'all') {
        const sJuz = resolveJuzFromMeta(meta?.juzs.references, s.number, 1);
        if (sJuz !== juzFilter) return false;
      }
      const q = surahQuery.trim();
      if (q) {
        return (
          s.name.includes(q) ||
          s.englishName.toLowerCase().includes(q.toLowerCase()) ||
          String(s.number) === q
        );
      }
      return true;
    });
  }, [allSurahs, juzFilter, meta, surahQuery]);

  // Check Cache API status for current moshaf surahs
  useEffect(() => {
    if (!activeMoshaf || allSurahs.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, boolean> = {};
      for (const s of allSurahs) {
        const url = getSurahAudioUrl(activeMoshaf, s.number);
        if (await isAudioUrlCached(url)) {
          next[url] = true;
        }
      }
      if (!cancelled) {
        setCachedUrls((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMoshaf, allSurahs]);

  // Store active playing track's real duration once loaded
  useEffect(() => {
    if (activeTrack && activeDuration > 0) {
      setDurationsMap((prev) => ({ ...prev, [activeTrack.url]: activeDuration }));
    }
  }, [activeTrack, activeDuration]);

  // Probe real audio duration from metadata for a surah on demand
  const probeDuration = useCallback(
    (url: string) => {
      if (durationsMap[url] || loadingDurations[url]) return;
      setLoadingDurations((prev) => ({ ...prev, [url]: true }));
      const audio = new Audio();
      audio.preload = 'metadata';
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onMeta);
        audio.removeEventListener('error', onErr);
        audio.removeAttribute('src');
        setLoadingDurations((prev) => {
          const copy = { ...prev };
          delete copy[url];
          return copy;
        });
      };
      const onMeta = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDurationsMap((prev) => ({ ...prev, [url]: audio.duration }));
        }
        cleanup();
      };
      const onErr = () => {
        cleanup();
      };
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('error', onErr);
      audio.src = url;
    },
    [durationsMap, loadingDurations]
  );

  // Gently probe first 10 visible surahs metadata when album opens
  useEffect(() => {
    if (!activeMoshaf || filteredSurahs.length === 0) return;
    const firstBatch = filteredSurahs
      .filter((s) => availableSurahSet.has(s.number))
      .slice(0, 8);
    firstBatch.forEach((s) => {
      const url = getSurahAudioUrl(activeMoshaf, s.number);
      probeDuration(url);
    });
  }, [activeMoshaf, availableSurahSet, filteredSurahs, probeDuration]);

  const handlePlayWholeQuran = async () => {
    if (!openReciter || !activeMoshaf) return;
    const queueList = allSurahs
      .filter((s) => availableSurahSet.has(s.number))
      .map((s) => ({ number: s.number, name: s.name }));
    if (queueList.length === 0) return;
    await playSurahFromReciter(
      openReciter,
      activeMoshaf,
      queueList[0].number,
      queueList[0].name,
      queueList
    );
  };

  const handleDownloadSingleSurah = async (surah: SurahReference) => {
    if (!openReciter || !activeMoshaf) return;
    const url = getSurahAudioUrl(activeMoshaf, surah.number);
    setDownloadingUrl(url);
    try {
      const filename = `${openReciter.name} - ${surah.name}.mp3`;
      const result = await cacheAndDownloadAudio(url, filename, true);
      if (result.cached) {
        setCachedUrls((prev) => ({ ...prev, [url]: true }));
      }
    } finally {
      setDownloadingUrl(null);
    }
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const [currentDownloadSurah, setCurrentDownloadSurah] = useState<string>('');

  const handleDownloadAlbum = async () => {
    if (!openReciter || !activeMoshaf) return;
    const targets = allSurahs.filter((s) => availableSurahSet.has(s.number));
    if (targets.length === 0) return;

    abortControllerRef.current = new AbortController();
    cancelAlbumDownloadRef.current = false;
    setAlbumDownloadState({ active: true, done: 0, total: targets.length });
    setCurrentDownloadSurah('');

    let done = 0;
    try {
      for (const s of targets) {
        if (cancelAlbumDownloadRef.current || abortControllerRef.current.signal.aborted) {
          break;
        }
        setCurrentDownloadSurah(s.name);
        const url = getSurahAudioUrl(activeMoshaf, s.number);
        if (!cachedUrls[url]) {
          const res = await cacheAndDownloadAudio(
            url,
            `${openReciter.name} - ${s.name}.mp3`,
            false,
            abortControllerRef.current.signal
          );
          if (res.cached) {
            setCachedUrls((prev) => ({ ...prev, [url]: true }));
          }
        }
        done += 1;
        setAlbumDownloadState({ active: true, done, total: targets.length });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Download error:', err);
      }
    } finally {
      abortControllerRef.current = null;
      setAlbumDownloadState((prev) => ({ ...prev, active: false }));
      setCurrentDownloadSurah('');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-20 flex flex-col items-center justify-center gap-3 text-sm text-neutral-500">
        <Loader2 className="h-7 w-7 animate-spin text-black dark:text-white" />
        <span>جارٍ تحميل قائمة القراء...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-20 flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
        >
          <RotateCcw className="h-4 w-4" />
          <span>إعادة المحاولة</span>
        </button>
      </div>
    );
  }

  // Album Detail View for a selected Reciter
  if (openReciter) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-4 pb-8">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <button
            type="button"
            onClick={() => {
              setOpenReciterId(null);
              setSelectedMoshafIdx(0);
              setJuzFilter('all');
              setSurahQuery('');
            }}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 px-3 text-xs font-semibold text-black hover:bg-neutral-50 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-950"
          >
            <ArrowRight className="h-4 w-4" />
            <span>القرّاء</span>
          </button>
          <h1 className="text-base sm:text-lg font-bold text-black dark:text-white truncate">
            {openReciter.name}
          </h1>
          <div className="w-16" />
        </div>

        {/* Moshaf switcher if multiple */}
        {openReciter.moshaf.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {openReciter.moshaf.map((m, idx) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMoshafIdx(idx)}
                className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  idx === selectedMoshafIdx
                    ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                    : 'border-neutral-200 text-neutral-700 hover:border-black dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-white'
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        {/* Album Primary Actions */}
        <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void handlePlayWholeQuran()}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-black px-4 py-3 text-xs sm:text-sm font-bold text-white dark:bg-white dark:text-black transition-transform active:scale-[0.99]"
          >
            <ListMusic className="h-4 w-4" />
            <span>تشغيل المصحف كاملاً</span>
          </button>

          {albumDownloadState.active ? (
            <button
              type="button"
              onClick={() => {
                cancelAlbumDownloadRef.current = true;
                if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                }
              }}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-black px-4 py-3 text-xs sm:text-sm font-bold text-black dark:border-white dark:text-white"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="tabular-nums">
                {currentDownloadSurah ? `سورة ${currentDownloadSurah} · ` : ''}
                ({toArabicDigits(albumDownloadState.done)}/{toArabicDigits(albumDownloadState.total)})
                {albumDownloadState.total > 0
                  ? ` (${toArabicDigits(Math.round((albumDownloadState.done / albumDownloadState.total) * 100))}%)`
                  : ''}{' '}
                · إلغاء
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleDownloadAlbum()}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-neutral-300 px-4 py-3 text-xs sm:text-sm font-bold text-black hover:bg-neutral-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-950"
            >
              <Download className="h-4 w-4" />
              <span>تحميل الألبوم للاستماع دون اتصال</span>
            </button>
          )}
        </div>

        {/* Search & Juz Filter */}
        <div className="mb-4 flex flex-col sm:flex-row gap-2.5">
          <input
            type="search"
            value={surahQuery}
            onChange={(e) => setSurahQuery(e.target.value)}
            placeholder="ابحث عن سورة..."
            className="flex-1 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-black placeholder:text-neutral-400 focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
          />
          <select
            aria-label="تصفية حسب الجزء"
            value={juzFilter}
            onChange={(e) =>
              setJuzFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
            className="min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold text-black focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
          >
            <option value="all">جميع الأجزاء (٣٠)</option>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((j) => (
              <option key={j} value={j}>
                الجزء {toArabicDigits(j)}
              </option>
            ))}
          </select>
        </div>

        {/* 114 Surahs List */}
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-800">
          {filteredSurahs.map((surah) => {
            const isAvailable = availableSurahSet.has(surah.number);
            const url = activeMoshaf ? getSurahAudioUrl(activeMoshaf, surah.number) : '';
            const isThisActive = activeTrack?.url === url;
            const isThisPlaying = isThisActive && isPlaying;
            const isThisLoading = isThisActive && audioLoading;
            const isCached = Boolean(cachedUrls[url]);
            const isDownloadingThis = downloadingUrl === url;
            const knownDuration =
              isThisActive && activeDuration > 0 ? activeDuration : durationsMap[url];
            const isProbingDuration = Boolean(loadingDurations[url]);

            return (
              <div
                key={surah.number}
                onMouseEnter={() => {
                  if (isAvailable && url) probeDuration(url);
                }}
                className={`flex min-h-[64px] items-center justify-between gap-3 px-4 py-3 ${
                  isThisActive ? 'bg-neutral-100/80 dark:bg-neutral-900/70' : ''
                }`}
              >
                <button
                  type="button"
                  disabled={!isAvailable || !activeMoshaf}
                  onClick={() => {
                    if (!activeMoshaf || !isAvailable) return;
                    if (isThisActive) {
                      togglePlayPause();
                    } else {
                      const queueSurahs = filteredSurahs
                        .filter((s) => availableSurahSet.has(s.number))
                        .map((s) => ({ number: s.number, name: s.name }));
                      void playSurahFromReciter(
                        openReciter,
                        activeMoshaf,
                        surah.number,
                        surah.name,
                        queueSurahs
                      );
                    }
                  }}
                  className="flex flex-1 items-center gap-3 text-right disabled:opacity-40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-300 dark:border-neutral-700 text-black dark:text-white">
                    {isThisLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isThisPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                        {toArabicDigits(surah.number)}.
                      </span>
                      <span className="font-quran text-base font-bold text-black dark:text-white truncate">
                        {surah.name}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                      <span>{getRevelationLabel(surah.revelationType)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{toArabicDigits(surah.numberOfAyahs)} آية</span>
                      {knownDuration ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{formatAudioTime(knownDuration)}</span>
                        </>
                      ) : isProbingDuration ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>جارٍ التحقق من المدة...</span>
                        </>
                      ) : null}
                      {isCached && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-black dark:text-white">محفوظ</span>
                        </>
                      )}
                      {!isAvailable && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>غير متوفرة في هذا المصحف</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                {isAvailable && (
                  <button
                    type="button"
                    disabled={isDownloadingThis}
                    onClick={() => void handleDownloadSingleSurah(surah)}
                    aria-label={`تحميل ${surah.name}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-black hover:bg-neutral-100 dark:border-neutral-800 dark:text-white dark:hover:bg-neutral-900"
                  >
                    {isDownloadingThis ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isCached ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 5 Reciter Cards Directory
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-5 pb-8">
      <header className="mb-6 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-black dark:text-white">القرّاء</h1>
        <p className="mt-1 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          استمع إلى المصحف المرتل كاملاً أو احفظ السور للاستماع دون اتصال
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {reciters.map((reciter) => {
          const primaryMoshaf = reciter.moshaf[0];
          const isDefault = reciter.id === selectedDefaultReciterId;
          return (
            <button
              key={reciter.id}
              type="button"
              onClick={() => {
                setOpenReciterId(reciter.id);
                setSelectedMoshafIdx(0);
              }}
              className="flex min-h-[112px] flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-5 text-right transition-colors hover:border-black dark:border-neutral-800 dark:bg-black dark:hover:border-white"
            >
              <div className="flex w-full items-start justify-between gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-800">
                  <Headphones className="h-5 w-5 text-black dark:text-white" />
                </div>
                {isDefault && (
                  <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                    القارئ الافتراضي
                  </span>
                )}
              </div>

              <div className="mt-4">
                <h2 className="text-base font-bold text-black dark:text-white">
                  {reciter.name}
                </h2>
                {primaryMoshaf && (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {primaryMoshaf.name} · {toArabicDigits(primaryMoshaf.surah_total)} سورة
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
