import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { toArabicDigits } from '../lib/arabic';
import type { Reciter } from '../types/quran';

interface ReciterSheetProps {
  open: boolean;
  onClose: () => void;
  reciters: Reciter[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedReciterId: number;
  onSelectReciter: (reciterId: number) => void;
}

export function ReciterSheet({
  open,
  onClose,
  reciters,
  loading,
  error,
  onRetry,
  selectedReciterId,
  onSelectReciter,
}: ReciterSheetProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="اختيار القارئ"
        className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-black max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700 sm:hidden" />

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-black dark:text-white">اختر القارئ</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 hover:text-black dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-sm text-neutral-500 dark:text-neutral-400">
            <Loader2 className="h-6 w-6 animate-spin text-black dark:text-white" />
            <span>جارٍ تحميل قائمة القراء...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
            >
              <RotateCcw className="h-4 w-4" />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {reciters.map((reciter) => {
              const isSelected = reciter.id === selectedReciterId;
              const moshaf = reciter.moshaf[0];
              return (
                <button
                  key={reciter.id}
                  type="button"
                  onClick={() => {
                    onSelectReciter(reciter.id);
                    onClose();
                  }}
                  className="flex w-full min-h-[56px] items-center justify-between gap-3 py-3 px-2 text-right transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-950 rounded-xl"
                >
                  <div>
                    <div className="text-sm font-semibold text-black dark:text-white">
                      {reciter.name}
                    </div>
                    {moshaf && (
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                        {moshaf.name} · {toArabicDigits(moshaf.surah_total)} سورة
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
