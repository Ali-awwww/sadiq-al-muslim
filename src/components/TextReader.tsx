import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { fetchIbnKathirByAyah, fetchSurahUthmani } from '../lib/api';
import { sanitizeTafsirHtml } from '../lib/sanitize';
import {
  BASMALA_UTHMANI,
  getRevelationLabel,
  resolvePageFromMeta,
  stripLeadingBasmala,
  toArabicDigits,
} from '../lib/arabic';
import type { Ayah, QuranMeta, SurahData } from '../types/quran';

interface TextReaderProps {
  surahNumber: number;
  surahName: string;
  meta: QuranMeta | null;
  /** Global ayah number of the first ayah of the current Mushaf page. */
  anchorGlobalAyah: number;
  /** Global ayah number currently being recited, if any. */
  audioGlobalAyah: number | null;
  isAudioPlaying: boolean;
  hasActiveAudio: boolean;
  /** Same 60..130 setting as the page zoom; in text mode it scales the font. */
  textSizePercent: number;
  onVisiblePageChange: (page: number) => void;
  onToggleControls: () => void;
}

interface VisibleInfo {
  page: number;
  hizbQuarter?: number;
  global: number;
}

/** Small ornate medallion holding the ayah number inside it, flowing inline
 *  with the text like the printed Mushaf — a bordered pill, the digits
 *  centred inside it, no margins, so the text flows continuously. */
const AYAH_MARKER_CLASS =
  'whitespace-nowrap rounded-full border border-amber-700/70 bg-amber-500/10 px-[0.32em] py-[0.06em] align-middle text-[0.6em] font-bold leading-none text-amber-700 dark:border-amber-400/70 dark:bg-amber-400/10 dark:text-amber-400';

/** «الحزب ٣» / «الحزب ٣ · ربع الحزب» / «… · نصف الحزب» / «… · ثلاثة أرباع الحزب» */
function hizbLabel(hizbQuarter?: number): string | null {
  if (!hizbQuarter || hizbQuarter < 1 || hizbQuarter > 240) return null;
  const hizb = Math.ceil(hizbQuarter / 4);
  const quarter = ((hizbQuarter - 1) % 4) + 1;
  const quarterLabel =
    quarter === 1
      ? ''
      : quarter === 2
        ? ' · ربع الحزب'
        : quarter === 3
          ? ' · نصف الحزب'
          : ' · ثلاثة أرباع الحزب';
  return `الحزب ${toArabicDigits(hizb)}${quarterLabel}`;
}

function cleanAyahText(text: string): string {
  return text.replace(/^\uFEFF+/, '').trim();
}

export function TextReader({
  surahNumber,
  surahName,
  meta,
  anchorGlobalAyah,
  audioGlobalAyah,
  isAudioPlaying,
  hasActiveAudio,
  textSizePercent,
  onVisiblePageChange,
  onToggleControls,
}: TextReaderProps) {
  const [surahData, setSurahData] = useState<SurahData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGlobal, setSelectedGlobal] = useState<number | null>(null);
  const [visibleInfo, setVisibleInfo] = useState<VisibleInfo | null>(null);
  // Ibn Kathir tafsir for the selected ayah (bottom sheet).
  const [tafsirHtml, setTafsirHtml] = useState<string | null>(null);
  const [tafsirLoading, setTafsirLoading] = useState(false);
  const [tafsirError, setTafsirError] = useState<string | null>(null);

  const selectedAyah =
    surahData?.ayahs.find((a) => a.number === selectedGlobal) ?? null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ayahElsRef = useRef<Map<number, HTMLSpanElement>>(new Map());
  const lastReportedPageRef = useRef<number | null>(null);
  const prevAudioRef = useRef<number | null>(null);
  const onVisiblePageChangeRef = useRef(onVisiblePageChange);
  onVisiblePageChangeRef.current = onVisiblePageChange;

  const loadSurah = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSurahUthmani(surahNumber);
      setSurahData(res.data);
    } catch (err) {
      setSurahData(null);
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر تحميل نص السورة. تحقق من الاتصال بالإنترنت.'
      );
    } finally {
      setLoading(false);
    }
  }, [surahNumber]);

  const loadTafsirFor = useCallback(
    (ayahNumberInSurah: number) => {
      setTafsirLoading(true);
      setTafsirError(null);
      setTafsirHtml(null);
      void fetchIbnKathirByAyah(surahNumber, ayahNumberInSurah)
        .then((res) => setTafsirHtml(sanitizeTafsirHtml(res.data.text)))
        .catch((err: unknown) => {
          setTafsirError(
            err instanceof Error
              ? err.message
              : 'تعذر تحميل التفسير. تحقق من الاتصال بالإنترنت.'
          );
        })
        .finally(() => setTafsirLoading(false));
    },
    [surahNumber]
  );

  // Load the tafsir whenever the selected ayah changes; close the sheet
  // (clear the tafsir) when nothing is selected.
  useEffect(() => {
    if (!selectedAyah) {
      setTafsirHtml(null);
      setTafsirError(null);
      setTafsirLoading(false);
      return;
    }
    let cancelled = false;
    setTafsirLoading(true);
    setTafsirError(null);
    setTafsirHtml(null);
    void fetchIbnKathirByAyah(surahNumber, selectedAyah.numberInSurah)
      .then((res) => {
        if (!cancelled) setTafsirHtml(sanitizeTafsirHtml(res.data.text));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTafsirError(
            err instanceof Error
              ? err.message
              : 'تعذر تحميل التفسير. تحقق من الاتصال بالإنترنت.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setTafsirLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAyah, surahNumber]);

  useEffect(() => {
    setSelectedGlobal(null);
    setVisibleInfo(null);
    lastReportedPageRef.current = null;
    prevAudioRef.current = null;
    void loadSurah();
  }, [surahNumber, loadSurah]);

  // When a surah finishes loading: set the initial page/hizb indicator and
  // scroll to the recited ayah (if it is in this surah) or to the first ayah
  // of the current Mushaf page.
  useEffect(() => {
    if (!surahData) return;
    const inSurah = (g: number | null) =>
      g != null && surahData.ayahs.some((a) => a.number === g);
    const target =
      hasActiveAudio && inSurah(audioGlobalAyah)
        ? audioGlobalAyah!
        : inSurah(anchorGlobalAyah)
          ? anchorGlobalAyah
          : (surahData.ayahs[0]?.number ?? null);
    const anchorAyah =
      surahData.ayahs.find((a) => a.number === anchorGlobalAyah) ??
      surahData.ayahs[0];
    if (anchorAyah) {
      setVisibleInfo({
        page: anchorAyah.page,
        hizbQuarter: anchorAyah.hizbQuarter,
        global: anchorAyah.number,
      });
    }
    if (target == null) return;
    requestAnimationFrame(() => {
      const el = ayahElsRef.current.get(target);
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surahData]);

  // While audio plays, follow the recited ayah: highlight + auto-scroll.
  useEffect(() => {
    if (audioGlobalAyah == null) {
      prevAudioRef.current = null;
      return;
    }
    if (!surahData || !isAudioPlaying) return;
    if (prevAudioRef.current === audioGlobalAyah) return;
    prevAudioRef.current = audioGlobalAyah;
    const el = ayahElsRef.current.get(audioGlobalAyah);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [audioGlobalAyah, isAudioPlaying, surahData]);

  // Track which ayah sits in the middle band of the viewport so the bottom
  // indicator always shows the page + hizb of the text being read.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !surahData) return;
    const els = Array.from(ayahElsRef.current.values());
    if (els.length === 0) return;
    lastReportedPageRef.current = null;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((en) => en.isIntersecting);
        if (visible.length === 0) return;
        visible.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
        );
        const topEl = visible[0].target as HTMLElement;
        const page = Number(topEl.dataset.page);
        const hizbQuarter = topEl.dataset.hizbQuarter
          ? Number(topEl.dataset.hizbQuarter)
          : undefined;
        const global = Number(topEl.dataset.ayah);
        if (Number.isFinite(global) && Number.isFinite(page)) {
          setVisibleInfo({ page, hizbQuarter, global });
        }
        if (Number.isFinite(page) && page >= 1 && page <= 604) {
          if (lastReportedPageRef.current !== page) {
            lastReportedPageRef.current = page;
            onVisiblePageChangeRef.current(page);
          }
        }
      },
      { root: container, rootMargin: '-40% 0px -50% 0px' }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [surahData]);

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Taps on ayahs are handled by the ayah spans; taps on buttons too.
    if ((e.target as HTMLElement).closest('button, a, [data-ayah]')) return;
    setSelectedGlobal(null);
    onToggleControls();
  };

  const jumpToSurahStartPage = (targetSurah: number) => {
    const page = resolvePageFromMeta(meta?.pages.references, targetSurah, 1);
    onVisiblePageChangeRef.current(page);
  };

  const fontSizePx = Math.round((30 * textSizePercent) / 100);

  const firstAyah = surahData?.ayahs[0] ?? null;
  const firstAyahDisplay =
    firstAyah && surahNumber !== 1 && surahNumber !== 9
      ? stripLeadingBasmala(firstAyah.text, surahNumber, 1)
      : firstAyah
        ? cleanAyahText(firstAyah.text)
        : '';
  // Show the Basmala as its own centred line only when it was actually
  // stripped from ayah 1 (otherwise it would appear twice).
  const rawFirst = firstAyah ? cleanAyahText(firstAyah.text) : '';
  const showBasmalaLine =
    surahNumber !== 1 &&
    surahNumber !== 9 &&
    firstAyahDisplay.length > 0 &&
    firstAyahDisplay.length < rawFirst.length - 10;

  const nextSurah =
    surahNumber < 114
      ? (meta?.surahs.references.find((s) => s.number === surahNumber + 1) ??
        null)
      : null;
  const prevSurah =
    surahNumber > 1
      ? (meta?.surahs.references.find((s) => s.number === surahNumber - 1) ??
        null)
      : null;

  // The text shown for an ayah: ayah 1 without its leading Basmala
  // (shown as its own line above), everything else as-is.
  const getDisplayText = (ayah: Ayah): string =>
    ayah.numberInSurah === 1 && surahNumber !== 1 && surahNumber !== 9
      ? firstAyahDisplay
      : cleanAyahText(ayah.text);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#FAF6EC] text-neutral-900 dark:bg-[#16130e] dark:text-neutral-100">
      <div
        ref={scrollRef}
        onClick={handleContainerClick}
        className="h-full w-full overflow-y-auto overscroll-contain"
      >
        {loading && !surahData ? (
          <div
            dir="rtl"
            className="flex h-full flex-col items-center justify-center gap-3 text-sm text-neutral-700 dark:text-neutral-300"
          >
            <Loader2 className="h-7 w-7 animate-spin text-black dark:text-white" />
            <span>جارٍ تحميل نص السورة...</span>
          </div>
        ) : error && !surahData ? (
          <div
            dir="rtl"
            className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
          >
            <p className="max-w-sm text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void loadSurah()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
            >
              <RotateCcw className="h-4 w-4" />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        ) : surahData ? (
          <div
            className="mx-auto w-full max-w-2xl px-5 pt-6"
            style={{ paddingBottom: hasActiveAudio ? 190 : 120 }}
          >
            {/* Surah header */}
            <div className="mb-6 rounded-2xl border border-amber-900/20 bg-amber-100/50 px-4 py-3 text-center dark:border-amber-200/20 dark:bg-amber-200/10">
              <div className="font-quran text-xl font-bold">{surahName}</div>
              <div className="mt-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                {getRevelationLabel(surahData.revelationType)} ·{' '}
                {toArabicDigits(surahData.numberOfAyahs)} آية
              </div>
            </div>

            {/* Basmala as its own centred line (surahs 2..114 except 9) */}
            {showBasmalaLine && (
              <p
                className="font-quran mb-6 text-center"
                style={{ fontSize: Math.round(fontSizePx * 1.05) }}
              >
                {BASMALA_UTHMANI}
              </p>
            )}

            {/* Flowing Uthmani text: one continuous paragraph, tap an ayah to box-highlight it */}
            <p
              className="font-quran text-justify"
              style={{ fontSize: fontSizePx, lineHeight: 2.15 }}
            >
              {surahData.ayahs.map((ayah: Ayah) => {
                const displayText = getDisplayText(ayah);
                const isAudio = audioGlobalAyah === ayah.number;
                const isSelected = selectedGlobal === ayah.number;
                const highlightClass =
                  isSelected && isAudio
                    ? 'bg-yellow-400/45 shadow-[0_0_0_2px_rgba(217,119,6,0.65)]'
                    : isSelected
                      ? 'bg-amber-500/25 shadow-[0_0_0_2px_rgba(217,119,6,0.65)]'
                      : isAudio
                        ? 'bg-yellow-400/45'
                        : '';
                return (
                  <Fragment key={ayah.number}>
                    <span
                      ref={(el) => {
                        if (el) ayahElsRef.current.set(ayah.number, el);
                        else ayahElsRef.current.delete(ayah.number);
                      }}
                      data-ayah={ayah.number}
                      data-page={ayah.page}
                      data-hizb-quarter={ayah.hizbQuarter ?? ''}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedGlobal((prev) =>
                          prev === ayah.number ? null : ayah.number
                        );
                      }}
                      className={`cursor-pointer rounded-md px-1 transition-colors ${highlightClass}`}
                      style={{
                        boxDecorationBreak: 'clone',
                        WebkitBoxDecorationBreak: 'clone',
                      }}
                    >
                      {displayText}{'\u00A0'}
                      <span aria-hidden="true" className={AYAH_MARKER_CLASS}>
                        {toArabicDigits(ayah.numberInSurah)}
                      </span>
                    </span>{' '}
                  </Fragment>
                );
              })}
            </p>

            {/* Surah navigation footer */}
            <div className="mt-10 flex items-center justify-between gap-3 pb-2">
              {prevSurah ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpToSurahStartPage(prevSurah.number);
                  }}
                  className="min-h-[44px] rounded-xl border border-neutral-300 bg-white/70 px-4 py-2 text-xs font-bold text-black dark:border-neutral-700 dark:bg-black/60 dark:text-white"
                >
                  السورة السابقة: {prevSurah.name}
                </button>
              ) : (
                <span />
              )}
              {nextSurah ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpToSurahStartPage(nextSurah.number);
                  }}
                  className="min-h-[44px] rounded-xl border border-neutral-300 bg-white/70 px-4 py-2 text-xs font-bold text-black dark:border-neutral-700 dark:bg-black/60 dark:text-white"
                >
                  السورة التالية: {nextSurah.name}
                </button>
              ) : (
                <span />
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Tafsir bottom sheet: tapping an ayah shows its text + Ibn Kathir tafsir.
          It sits above the scroll area (a sibling, not a child), so taps inside
          it never reach the container's empty-space handler. */}
      {selectedAyah && (
        <div
          dir="rtl"
          role="dialog"
          aria-label={`تفسير الآية ${toArabicDigits(selectedAyah.numberInSurah)}`}
          className={`absolute inset-x-0 z-30 flex max-h-[62%] flex-col overflow-hidden rounded-t-3xl border-t border-neutral-300/70 bg-[#FAF6EC] shadow-2xl dark:border-neutral-700 dark:bg-[#16130e] ${
            hasActiveAudio ? 'bottom-[136px]' : 'bottom-0'
          }`}
        >
          <div className="flex shrink-0 justify-center pt-2">
            <span className="h-1.5 w-12 rounded-full bg-neutral-300 dark:bg-neutral-700" />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-1">
            <div className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              تفسير ابن كثير · الآية{' '}
              {toArabicDigits(selectedAyah.numberInSurah)}
            </div>
            <button
              type="button"
              aria-label="إغلاق التفسير"
              onClick={() => setSelectedGlobal(null)}
              className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <p className="font-quran mb-4 text-justify text-[22px] leading-[2.1] text-neutral-900 dark:text-neutral-100">
              {getDisplayText(selectedAyah)}{'\u00A0'}
              <span aria-hidden="true" className={AYAH_MARKER_CLASS}>
                {toArabicDigits(selectedAyah.numberInSurah)}
              </span>
            </p>
            {tafsirLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-neutral-600 dark:text-neutral-300">
                <Loader2 className="h-6 w-6 animate-spin text-black dark:text-white" />
                <span>جارٍ تحميل التفسير...</span>
              </div>
            ) : tafsirError ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                <p className="text-sm text-neutral-700 dark:text-neutral-300">
                  {tafsirError}
                </p>
                <button
                  type="button"
                  onClick={() => loadTafsirFor(selectedAyah.numberInSurah)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>إعادة المحاولة</span>
                </button>
              </div>
            ) : tafsirHtml ? (
              <div
                className="text-sm leading-[2] text-neutral-800 dark:text-neutral-200 [&_p]:mb-3 [&_.blue]:font-bold [&_.blue]:text-black dark:[&_.blue]:text-white [&_.arabic]:font-quran [&_.arabic]:text-lg"
                dangerouslySetInnerHTML={{ __html: tafsirHtml }}
              />
            ) : (
              <p className="py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                لا يتوفر نص تفسير لهذه الآية.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bottom indicator: Mushaf page + hizb of the visible text */}
      {visibleInfo && !selectedAyah && (
        <div
          dir="rtl"
          className={`absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-neutral-300/70 bg-white/90 px-4 py-2 text-xs font-bold text-neutral-800 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-black/85 dark:text-neutral-100 ${
            hasActiveAudio ? 'bottom-[136px]' : ''
          }`}
        >
          <span>{surahName}</span>
          <span className="text-neutral-400 dark:text-neutral-500">·</span>
          <span>
            صفحة {toArabicDigits(visibleInfo.page)} / {toArabicDigits(604)}
          </span>
          {hizbLabel(visibleInfo.hizbQuarter) && (
            <>
              <span className="text-neutral-400 dark:text-neutral-500">·</span>
              <span>{hizbLabel(visibleInfo.hizbQuarter)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
