import { Check, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_AYAH_SAMPLE_FALLBACK,
  ALQURAN_BASE,
  MP3QURAN_RECITERS_URL,
} from '../lib/api';
import { toArabicDigits } from '../lib/arabic';
import { clearAllCaches, getCacheStats } from '../lib/cache';
import type { AppSettings, Reciter, ThemeMode } from '../types/quran';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  reciters: Reciter[];
}

export function SettingsView({
  settings,
  onUpdateSettings,
  reciters,
}: SettingsViewProps) {
  const [cacheStats, setCacheStats] = useState<{
    textEntries: number;
    audioEntries: number;
  } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearedNotice, setClearedNotice] = useState(false);

  const refreshStats = useCallback(async () => {
    const stats = await getCacheStats();
    setCacheStats(stats);
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const handleClearCache = async () => {
    setClearing(true);
    setClearedNotice(false);
    try {
      await clearAllCaches();
      await refreshStats();
      setClearedNotice(true);
      setTimeout(() => setClearedNotice(false), 3000);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-5 pb-8 space-y-6">
      <header className="border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-black dark:text-white">
          الإعدادات
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          تخصيص المظهر، الخط، القارئ الافتراضي، وإدارة البيانات المحفوظة
        </p>
      </header>

      {/* Theme Selector */}
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-3">
        <h2 className="text-sm font-bold text-black dark:text-white">المظهر</h2>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'light', label: 'فاتح' },
              { id: 'dark', label: 'داكن' },
              { id: 'system', label: 'النظام' },
            ] as Array<{ id: ThemeMode; label: string }>
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() =>
                onUpdateSettings((prev) => ({ ...prev, theme: opt.id }))
              }
              className={`min-h-[44px] rounded-xl text-xs font-bold transition-colors ${
                settings.theme === opt.id
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'border border-neutral-200 text-neutral-700 hover:border-black dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Font Size */}
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-black dark:text-white">حجم خط المصحف</h2>
          <span className="text-xs font-bold tabular-nums text-neutral-500 dark:text-neutral-400">
            {toArabicDigits(settings.fontSize)} px
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onUpdateSettings((prev) => ({
                ...prev,
                fontSize: Math.max(18, prev.fontSize - 2),
              }))
            }
            className="flex h-10 w-12 items-center justify-center rounded-xl border border-neutral-200 text-xs font-bold dark:border-neutral-800"
          >
            A-
          </button>
          <input
            type="range"
            aria-label="حجم خط المصحف"
            min={18}
            max={38}
            step={1}
            value={settings.fontSize}
            onChange={(e) =>
              onUpdateSettings((prev) => ({
                ...prev,
                fontSize: Number(e.target.value),
              }))
            }
            className="flex-1 accent-black dark:accent-white"
          />
          <button
            type="button"
            onClick={() =>
              onUpdateSettings((prev) => ({
                ...prev,
                fontSize: Math.min(38, prev.fontSize + 2),
              }))
            }
            className="flex h-10 w-12 items-center justify-center rounded-xl border border-neutral-200 text-sm font-bold dark:border-neutral-800"
          >
            A+
          </button>
        </div>

        <div className="mushaf-page-surface rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-center">
          <p
            className="font-quran text-black dark:text-white leading-[2.1]"
            style={{ fontSize: `${settings.fontSize}px` }}
          >
            بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ﴿١﴾
          </p>
        </div>
      </section>

      {/* Default Reciter & Tajweed */}
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-4">
        <div>
          <label
            htmlFor="default-reciter-select"
            className="mb-2 block text-sm font-bold text-black dark:text-white"
          >
            القارئ الافتراضي
          </label>
          <select
            id="default-reciter-select"
            value={settings.defaultReciterId}
            onChange={(e) =>
              onUpdateSettings((prev) => ({
                ...prev,
                defaultReciterId: Number(e.target.value),
              }))
            }
            className="w-full min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 text-sm font-semibold text-black focus:border-black focus:outline-none dark:border-neutral-800 dark:bg-black dark:text-white dark:focus:border-white"
          >
            {reciters.length > 0 ? (
              reciters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))
            ) : (
              <option value={settings.defaultReciterId}>
                القارئ رقم {toArabicDigits(settings.defaultReciterId)}
              </option>
            )}
          </select>
        </div>

        <button
          type="button"
          onClick={() =>
            onUpdateSettings((prev) => ({
              ...prev,
              tajweedEnabled: !prev.tajweedEnabled,
            }))
          }
          className="flex w-full min-h-[48px] items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 text-sm font-semibold dark:border-neutral-800"
        >
          <span>تفعيل ألوان التجويد التقريبية افتراضياً</span>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
              settings.tajweedEnabled
                ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                : 'border-neutral-300 dark:border-neutral-700'
            }`}
          >
            {settings.tajweedEnabled && <Check className="h-3.5 w-3.5" />}
          </span>
        </button>
      </section>

      {/* Offline Cache Management */}
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-black dark:text-white">
              ذاكرة التخزين المؤقت (القراءة والاستماع دون اتصال)
            </h2>
            {cacheStats && (
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
                الصفحات والسور والتفاسير المحفوظة: {toArabicDigits(cacheStats.textEntries)}{' '}
                · الملفات الصوتية المحفوظة: {toArabicDigits(cacheStats.audioEntries)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={clearing}
            onClick={() => void handleClearCache()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-neutral-300 px-4 text-xs font-bold text-black hover:bg-neutral-50 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-950 disabled:opacity-50"
          >
            {clearing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            <span>مسح ذاكرة التخزين المؤقت</span>
          </button>
          {clearedNotice && (
            <span className="text-xs font-semibold text-black dark:text-white">
              تم مسح الذاكرة المؤقتة بنجاح
            </span>
          )}
        </div>
      </section>

      {/* About & Real API Data Sources */}
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-3">
        <h2 className="text-sm font-bold text-black dark:text-white">
          عن تطبيق صديق المسلم ومصادر البيانات
        </h2>
        <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
          يعتمد التطبيق بشكل كامل على جلب النص القرآني العثماني، والتفسير، والتلاوات
          الصوتية الحية من المصادر الموثوقة التالية دون أي نصوص مخزنة مسبقاً أو
          مصطنعة. التفسير الافتراضي هو تفسير ابن كثير من منصة Quran.com، مع إتاحة
          التفاسير الأخرى (الميسر، القرطبي، الجلالين، البغوي، الوسيط) من AlQuran Cloud.
        </p>
        <div>
          <button
            type="button"
            onClick={() =>
              window.open('https://apps-showcase.pages.dev', '_blank', 'noopener,noreferrer')
            }
            className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-black px-5 py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-black"
          >
            <span>تطبيقاتنا</span>
            <ExternalLink className="h-4 w-4 shrink-0" />
          </button>
        </div>
        <ul className="space-y-2 text-xs">
          <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
            <span className="font-semibold text-black dark:text-white">
              تفسير ابن كثير الافتراضي (Quran.com v4)
            </span>
            <a
              href="https://api.quran.com/api/v4/tafsirs/14"
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              className="inline-flex items-center gap-1 text-neutral-600 hover:text-black dark:text-neutral-400 dark:hover:text-white underline break-all"
            >
              <span>https://api.quran.com/api/v4/tafsirs/14</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </li>
          <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
            <span className="font-semibold text-black dark:text-white">
              النص العثماني والتفاسير الأخرى والبحث (AlQuran Cloud)
            </span>
            <a
              href={ALQURAN_BASE}
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              className="inline-flex items-center gap-1 text-neutral-600 hover:text-black dark:text-neutral-400 dark:hover:text-white underline break-all"
            >
              <span>{ALQURAN_BASE}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </li>
          <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
            <span className="font-semibold text-black dark:text-white">
              التلاوات الصوتية للقرّاء (MP3Quran v3)
            </span>
            <a
              href={MP3QURAN_RECITERS_URL}
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              className="inline-flex items-center gap-1 text-neutral-600 hover:text-black dark:text-neutral-400 dark:hover:text-white underline break-all"
            >
              <span>{MP3QURAN_RECITERS_URL}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </li>
          <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
            <span className="font-semibold text-black dark:text-white">
              عينات تلاوة الآيات الفردية (Islamic Network CDN)
            </span>
            <span dir="ltr" className="text-neutral-500 dark:text-neutral-400 break-all">
              {DEFAULT_AYAH_SAMPLE_FALLBACK.url}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
