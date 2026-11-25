import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudio } from '../context/AudioContext';
import { fetchSurahUthmani, fetchTafsir, TAFSIR_EDITIONS } from '../lib/api';
import { stripLeadingBasmala, toArabicDigits } from '../lib/arabic';
import type { MemoStats, QuranMeta, SurahData } from '../types/quran';
import { TajweedLegend, TajweedText } from './TajweedText';

interface UnderstandingViewProps {
  meta: QuranMeta | null;
  initialSurah: number;
  initialAyah: number;
  isDark: boolean;
  memoStats: MemoStats;
  onUpdateMemoStats: (updater: (prev: MemoStats) => MemoStats) => void;
}

type SubMode = 'tafsir' | 'tajweed' | 'memorization';
type MemoMode = 'hide' | 'selftest';

export function UnderstandingView({
  meta,
  initialSurah,
  initialAyah,
  isDark,
  memoStats,
  onUpdateMemoStats,
}: UnderstandingViewProps) {
  const { playAyahSample } = useAudio();

  const [subMode, setSubMode] = useState<SubMode>('tafsir');
  const [selectedSurah, setSelectedSurah] = useState<number>(initialSurah || 1);
  const [selectedAyahNum, setSelectedAyahNum] = useState<number>(initialAyah || 1);

  const [uthmaniData, setUthmaniData] = useState<SurahData | null>(null);
  const [tafsirData, setTafsirData] = useState<(SurahData & { editionName?: string }) | null>(null);
  const [tafsirEdition, setTafsirEdition] = useState<string>('ar.muyassar');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tajweed state
  const [tajweedActive, setTajweedActive] = useState(true);

  // Memorization state
  const [memoMode, setMemoMode] = useState<MemoMode>('hide');
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(10);
  const [revealedAyahs, setRevealedAyahs] = useState<Record<number, boolean>>({});
  const [testedResult, setTestedResult] = useState<Record<number, 'correct' | 'retry'>>({});

  useEffect(() => {
    if (initialSurah) {
      setSelectedSurah(initialSurah);
      setSelectedAyahNum(initialAyah || 1);
    }
  }, [initialSurah, initialAyah]);

  const loadSurahAndTafsir = useCallback(async (surahNum: number, editionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [uRes, tRes] = await Promise.all([
        fetchSurahUthmani(surahNum),
        fetchTafsir(surahNum, editionId),
      ]);
      setUthmaniData(uRes.data);
      setTafsirData(tRes.data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر تحميل التفسير أو النص القرآني. تحقق من الاتصال.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSurahAndTafsir(selectedSurah, tafsirEdition);
    setRevealedAyahs({});
    setTestedResult({});
    setRangeStart(1);
    setRangeEnd(10);
  }, [selectedSurah, tafsirEdition, loadSurahAndTafsir]);

  const surahRefs = meta?.surahs.references ?? [];
  const totalAyahsInSurah = uthmaniData?.numberOfAyahs ?? 7;

  const safeAyahNum = Math.max(1, Math.min(totalAyahsInSurah, selectedAyahNum));

  const currentUthmaniAyah = useMemo(
    () => uthmaniData?.ayahs.find((a) => a.numberInSurah === safeAyahNum) ?? null,
    [uthmaniData, safeAyahNum]
  );

  const currentTafsirAyah = useMemo(
    () => tafsirData?.ayahs.find((a) => a.numberInSurah === safeAyahNum) ?? null,
    [tafsirData, safeAyahNum]
  );

  const memoAyahs = useMemo(() => {
    if (!uthmaniData) return [];
    const start = Math.max(1, Math.min(rangeStart, uthmaniData.numberOfAyahs));
    const end = Math.max(start, Math.min(rangeEnd, uthmaniData.numberOfAyahs));
    return uthmaniData.ayahs.filter(
      (a) => a.numberInSurah >= start && a.numberInSurah <= end
    );
  }, [uthmaniData, rangeStart, rangeEnd]);

  const totalAttempts = memoStats.correctCount + memoStats.retryCount;
  const accuracyPct =
    totalAttempts > 0 ? Math.round((memoStats.correctCount / totalAttempts) * 100) : 0;

  const handleMarkTestResult = (ayahNum: number, outcome: 'correct' | 'retry') => {
    if (testedResult[ayahNum]) return;
    setTestedResult((prev) => ({ ...prev, [ayahNum]: outcome }));
    onUpdateMemoStats((prev) => ({
      ...prev,
      correctCount: prev.correctCount + (outcome === 'correct' ? 1 : 0),
      retryCount: prev.retryCount + (outcome === 'retry' ? 1 : 0),
      sessionsCompleted:
        Object.keys(testedResult).length === 0
          ? prev.sessionsCompleted + 1
          : prev.sessionsCompleted,
    }));
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-5 pb-8">
      <header className="mb-5 border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-black dark:text-white">
          التفسير والحفظ
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          التفسير، التلوين التقريبي للتجويد، وأدوات الحفظ والاختبار الذاتي
        </p>

        {/* Sub-mode Segmented Control */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-900">
          {(
            [
              { id: 'tafsir', label: 'التفسير' },
              { id: 'tajweed', label: 'التجويد' },
              { id: 'memorization', label: 'الحفظ والاختبار' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubMode(tab.id)}
              className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                subMode === tab.id
                  ? 'bg-white text-black shadow-xs dark:bg-black dark:text-white'
                  : 'text-neutral-600 hover:text-black dark:text-neutral-400 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Surah Selector shared across all 3 sub-modes */}
      <div className="mb-5 flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label
            htmlFor="understanding-surah"
            className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400"
          >
            السورة
          </label>
          <select
            id="understanding-surah"
            value={selectedSurah}
            onChange={(e) => {
              setSelectedSurah(Number(e.target.value));
              setSelectedAyahNum(1);
            }}
            className="w-full min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-sm font-semibold text-black focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
          >
            {surahRefs.length > 0
              ? surahRefs.map((s) => (
                  <option key={s.number} value={s.number}>
                    {toArabicDigits(s.number)}. {s.name}
                  </option>
                ))
              : Array.from({ length: 114 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    سورة رقم {toArabicDigits(n)}
                  </option>
                ))}
          </select>
        </div>

        {subMode === 'tafsir' && (
          <div className="w-full sm:w-44">
            <label
              htmlFor="understanding-ayah"
              className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400"
            >
              رقم الآية
            </label>
            <select
              id="understanding-ayah"
              value={safeAyahNum}
              onChange={(e) => setSelectedAyahNum(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-sm font-semibold tabular-nums text-black focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
            >
              {Array.from({ length: totalAyahsInSurah }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  الآية {toArabicDigits(n)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-sm text-neutral-500">
          <Loader2 className="h-7 w-7 animate-spin text-black dark:text-white" />
          <span>جارٍ تحميل السورة والتفسير...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{error}</p>
          <button
            type="button"
            onClick={() => void loadSurahAndTafsir(selectedSurah, tafsirEdition)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
          >
            <RotateCcw className="h-4 w-4" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      ) : subMode === 'tafsir' ? (
        /* TAFSIR VIEW */
        <div className="space-y-4">
          {currentUthmaniAyah && (
            <div className="mushaf-page-surface rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span>
                  {uthmaniData?.name} · الآية {toArabicDigits(safeAyahNum)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void playAyahSample(currentUthmaniAyah, uthmaniData?.name ?? '')
                  }
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-black hover:bg-neutral-100 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-900"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>استماع (عينة)</span>
                </button>
              </div>
              <p className="font-quran text-2xl sm:text-[26px] leading-[2.2] text-black dark:text-white">
                {stripLeadingBasmala(
                  currentUthmaniAyah.text,
                  selectedSurah,
                  currentUthmaniAyah.numberInSurah
                )}{' '}
                <span className="text-xl">﴿{toArabicDigits(safeAyahNum)}﴾</span>
              </p>
            </div>
          )}

          <article className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-black dark:text-white">
                التفسير · {tafsirData?.editionName || 'التفسير الميسر'}
              </h2>
              <select
                aria-label="اختيار كتاب التفسير"
                value={tafsirEdition}
                onChange={(e) => setTafsirEdition(e.target.value)}
                className="min-h-[36px] rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-semibold text-black dark:border-neutral-800 dark:bg-black dark:text-white"
              >
                {TAFSIR_EDITIONS.map((ed) => (
                  <option key={ed.id} value={ed.id}>
                    {ed.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              تفسير ابن كثير غير متوفر في واجهة AlQuran Cloud، والتفاسير المعروضة هي المتوفرة فعلياً في الواجهة.
            </p>
            <p className="text-sm sm:text-base leading-[1.95] text-neutral-800 dark:text-neutral-200 whitespace-pre-line">
              {currentTafsirAyah?.text || 'لا يتوفر نص تفسير لهذه الآية.'}
            </p>
          </article>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={safeAyahNum <= 1}
              onClick={() => setSelectedAyahNum((a) => Math.max(1, a - 1))}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 px-4 text-xs font-semibold text-black disabled:opacity-35 dark:border-neutral-800 dark:text-white"
            >
              <ChevronRight className="h-4 w-4" />
              <span>الآية السابقة</span>
            </button>

            <span className="text-xs font-medium tabular-nums text-neutral-500 dark:text-neutral-400">
              {toArabicDigits(safeAyahNum)} / {toArabicDigits(totalAyahsInSurah)}
            </span>

            <button
              type="button"
              disabled={safeAyahNum >= totalAyahsInSurah}
              onClick={() =>
                setSelectedAyahNum((a) => Math.min(totalAyahsInSurah, a + 1))
              }
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 px-4 text-xs font-semibold text-black disabled:opacity-35 dark:border-neutral-800 dark:text-white"
            >
              <span>الآية التالية</span>
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : subMode === 'tajweed' ? (
        /* TAJWEED VIEW */
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
            <div>
              <div className="text-sm font-bold text-black dark:text-white">
                تلوين أحكام التجويد (تقريبي)
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                تمييز بصري مبني على قواعد الرسم العثماني للمساعدة في التلاوة
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTajweedActive((v) => !v)}
              className={`min-h-[40px] rounded-xl px-4 text-xs font-bold transition-colors ${
                tajweedActive
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'border border-neutral-300 text-black dark:border-neutral-700 dark:text-white'
              }`}
            >
              {tajweedActive ? 'مُفعّل' : 'مُعطّل'}
            </button>
          </div>

          <TajweedLegend isDark={isDark} />

          <div className="mushaf-page-surface rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 sm:p-7 space-y-4">
            <h2 className="font-quran text-xl font-bold text-center text-black dark:text-white">
              {uthmaniData?.name}
            </h2>
            <div className="font-quran text-2xl leading-[2.3] text-justify text-black dark:text-white">
              {uthmaniData?.ayahs.slice(0, 40).map((ayah) => (
                <span key={ayah.number}>
                  <TajweedText
                    text={stripLeadingBasmala(
                      ayah.text,
                      selectedSurah,
                      ayah.numberInSurah
                    )}
                    enabled={tajweedActive}
                    isDark={isDark}
                  />{' '}
                  <span className="text-[0.8em] select-none">
                    ﴿{toArabicDigits(ayah.numberInSurah)}﴾
                  </span>{' '}
                </span>
              ))}
              {uthmaniData && uthmaniData.ayahs.length > 40 && (
                <p className="mt-4 font-ui text-xs text-center text-neutral-500 dark:text-neutral-400">
                  تُعرض أول ٤٠ آية هنا للمعاينة السريعة؛ يمكنك تفعيل التجويد لكامل المصحف من
                  شاشة المصحف.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* MEMORIZATION & SELF-TEST VIEW */
        <div className="space-y-4">
          {/* Stats Summary */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3.5 text-center">
              <div className="text-lg font-bold tabular-nums text-black dark:text-white">
                {toArabicDigits(memoStats.correctCount)}
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                إجابات صحيحة
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3.5 text-center">
              <div className="text-lg font-bold tabular-nums text-black dark:text-white">
                {toArabicDigits(memoStats.retryCount)}
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                بحاجة لمراجعة
              </div>
            </div>
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3.5 text-center">
              <div className="text-lg font-bold tabular-nums text-black dark:text-white">
                {toArabicDigits(accuracyPct)}%
              </div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                دقة الحفظ
              </div>
            </div>
          </div>

          {/* Mode & Ayah Range Controls */}
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMemoMode('hide');
                  setRevealedAyahs({});
                }}
                className={`min-h-[42px] rounded-xl text-xs font-bold transition-colors ${
                  memoMode === 'hide'
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'border border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300'
                }`}
              >
                إخفاء الآيات (اضغط للكشف)
              </button>
              <button
                type="button"
                onClick={() => {
                  setMemoMode('selftest');
                  setRevealedAyahs({});
                  setTestedResult({});
                }}
                className={`min-h-[42px] rounded-xl text-xs font-bold transition-colors ${
                  memoMode === 'selftest'
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'border border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300'
                }`}
              >
                اختبار الحفظ (بداية الآية فقط)
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">من آية</span>
                <input
                  type="number"
                  min={1}
                  max={totalAyahsInSurah}
                  value={rangeStart}
                  onChange={(e) => setRangeStart(Math.max(1, Number(e.target.value)))}
                  className="w-16 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-center font-bold tabular-nums dark:border-neutral-700 dark:bg-black"
                />
                <span className="text-neutral-500 dark:text-neutral-400">إلى</span>
                <input
                  type="number"
                  min={1}
                  max={totalAyahsInSurah}
                  value={rangeEnd}
                  onChange={(e) =>
                    setRangeEnd(Math.min(totalAyahsInSurah, Math.max(1, Number(e.target.value))))
                  }
                  className="w-16 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-center font-bold tabular-nums dark:border-neutral-700 dark:bg-black"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const all: Record<number, boolean> = {};
                    memoAyahs.forEach((a) => {
                      all[a.numberInSurah] = true;
                    });
                    setRevealedAyahs(all);
                  }}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold dark:border-neutral-800"
                >
                  إظهار الكل
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRevealedAyahs({});
                    setTestedResult({});
                  }}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold dark:border-neutral-800"
                >
                  إخفاء الكل
                </button>
              </div>
            </div>
          </div>

          {/* Ayah Memorization Cards */}
          <div className="space-y-3">
            {memoAyahs.map((ayah) => {
              const cleanText = stripLeadingBasmala(
                ayah.text,
                selectedSurah,
                ayah.numberInSurah
              );
              const isRevealed = Boolean(revealedAyahs[ayah.numberInSurah]);
              const words = cleanText.trim().split(/\s+/);
              const hintWords = words.slice(0, Math.min(3, words.length)).join(' ');
              const outcome = testedResult[ayah.numberInSurah];

              return (
                <div
                  key={ayah.number}
                  className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black p-4 sm:p-5"
                >
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold tabular-nums text-neutral-500 dark:text-neutral-400">
                      الآية {toArabicDigits(ayah.numberInSurah)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setRevealedAyahs((prev) => ({
                          ...prev,
                          [ayah.numberInSurah]: !prev[ayah.numberInSurah],
                        }))
                      }
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-black dark:border-neutral-800 dark:text-white"
                    >
                      {isRevealed ? (
                        <>
                          <EyeOff className="h-3.5 w-3.5" />
                          <span>إخفاء</span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" />
                          <span>كشف الآية</span>
                        </>
                      )}
                    </button>
                  </div>

                  {memoMode === 'hide' ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setRevealedAyahs((prev) => ({
                          ...prev,
                          [ayah.numberInSurah]: !prev[ayah.numberInSurah],
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setRevealedAyahs((prev) => ({
                            ...prev,
                            [ayah.numberInSurah]: !prev[ayah.numberInSurah],
                          }));
                        }
                      }}
                      className="cursor-pointer rounded-xl p-2 transition-all"
                    >
                      <p
                        className={`font-quran text-2xl leading-[2.2] text-black dark:text-white transition-all ${
                          isRevealed ? 'blur-none opacity-100' : 'blur-md opacity-30 select-none'
                        }`}
                      >
                        {cleanText}
                      </p>
                      {!isRevealed && (
                        <p className="mt-1 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
                          اضغط لكشف الآية
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="font-quran text-2xl leading-[2.2] text-black dark:text-white">
                        {isRevealed ? cleanText : `${hintWords} ...`}
                      </p>

                      {isRevealed && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={Boolean(outcome)}
                            onClick={() =>
                              handleMarkTestResult(ayah.numberInSurah, 'correct')
                            }
                            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-colors ${
                              outcome === 'correct'
                                ? 'bg-black text-white dark:bg-white dark:text-black'
                                : 'border border-neutral-300 text-black hover:bg-neutral-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-950'
                            } disabled:opacity-70`}
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>أحسنت (صحيح)</span>
                          </button>

                          <button
                            type="button"
                            disabled={Boolean(outcome)}
                            onClick={() =>
                              handleMarkTestResult(ayah.numberInSurah, 'retry')
                            }
                            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 text-xs font-bold transition-colors ${
                              outcome === 'retry'
                                ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-black'
                                : 'border border-neutral-300 text-black hover:bg-neutral-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-950'
                            } disabled:opacity-70`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>أعد المحاولة</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
