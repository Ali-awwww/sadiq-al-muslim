import { Loader2, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { formatAudioTime, toArabicDigits } from '../lib/arabic';

export function MiniPlayer() {
  const {
    activeTrack,
    queue,
    queueIndex,
    isPlaying,
    isLoading,
    error,
    currentTime,
    duration,
    activeSurahNumber,
    activeAyahInSurah,
    togglePlayPause,
    seek,
    playNext,
    playPrev,
    stop,
    retryCurrent,
  } = useAudio();

  if (!activeTrack) return null;

  const hasQueue = queue.length > 1;
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const displayedAyahNumber =
    activeTrack.ayahNumberInSurah ??
    (activeTrack.surahNumber === activeSurahNumber ? activeAyahInSurah : null);

  return (
    <div
      role="region"
      aria-label="مشغل التلاوة"
      className="fixed bottom-15 left-0 right-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-black/95 pb-safe"
    >
      <div className="mx-auto max-w-4xl px-3 py-2">
        {/* Progress scrubber */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400 w-10 text-left">
            {formatAudioTime(currentTime)}
          </span>
          <input
            type="range"
            aria-label="شريط تقدم التلاوة"
            min={0}
            max={duration || 100}
            step={1}
            value={duration > 0 ? currentTime : 0}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!duration}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-200 accent-black dark:bg-neutral-800 dark:accent-white"
            style={{
              backgroundSize: `${progressPct}% 100%`,
            }}
          />
          <span className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400 w-10 text-right">
            {duration > 0 ? formatAudioTime(duration) : '--:--'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          {/* Track info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-black dark:text-white truncate">
              <span className="truncate">
                {activeTrack.surahName}
                {displayedAyahNumber
                  ? ` · الآية ${toArabicDigits(displayedAyahNumber)}`
                  : ''}
              </span>
              {activeTrack.isSample && (
                <span className="shrink-0 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                  (عينة)
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              {error ? error : activeTrack.reciterName}
              {hasQueue && !error ? ` · ${toArabicDigits(queueIndex + 1)} / ${toArabicDigits(queue.length)}` : ''}
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            {hasQueue && (
              <button
                type="button"
                onClick={playPrev}
                disabled={queueIndex <= 0}
                aria-label="السورة السابقة"
                className="flex h-10 w-10 items-center justify-center rounded-full text-black disabled:opacity-30 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            )}

            {error ? (
              <button
                type="button"
                onClick={retryCurrent}
                aria-label="إعادة المحاولة"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={togglePlayPause}
                aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black transition-transform active:scale-95"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
            )}

            {hasQueue && (
              <button
                type="button"
                onClick={playNext}
                disabled={queueIndex >= queue.length - 1}
                aria-label="السورة التالية"
                className="flex h-10 w-10 items-center justify-center rounded-full text-black disabled:opacity-30 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <SkipBack className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={stop}
              aria-label="إغلاق المشغل"
              className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
