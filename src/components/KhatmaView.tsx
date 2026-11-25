import {
  Bell,
  BookOpen,
  Image as ImageIcon,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fetchAyahByNumber } from '../lib/api';
import {
  getDeterministicAyahOfDayNumber,
  getTodayDateString,
  stripLeadingBasmala,
  toArabicDigits,
} from '../lib/arabic';
import { shareAyahAsImage } from '../lib/shareImage';
import type { Ayah, KhatmaState, LastReadPosition } from '../types/quran';

interface KhatmaViewProps {
  khatma: KhatmaState;
  onUpdateKhatma: (updater: (prev: KhatmaState) => KhatmaState) => void;
  lastRead: LastReadPosition | null;
  onJumpToPage: (page: number, highlightAyahGlobal?: number) => void;
  isDark: boolean;
}

export function KhatmaView({
  khatma,
  onUpdateKhatma,
  lastRead,
  onJumpToPage,
  isDark,
}: KhatmaViewProps) {
  const [ayahOfDay, setAyahOfDay] = useState<Ayah | null>(null);
  const [ayahLoading, setAyahLoading] = useState(true);
  const [ayahError, setAyahError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const [notifStatus, setNotifStatus] = useState<string>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  });
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);

  const today = getTodayDateString();
  const pagesReadToday = khatma.todayDate === today ? khatma.pagesReadToday : 0;
  const totalCompleted = khatma.completedPages.length;
  const progressPct = Math.min(100, Math.round((totalCompleted / 604) * 100));
  const remainingPages = Math.max(0, 604 - totalCompleted);
  const daysRemaining =
    khatma.dailyGoalPages > 0
      ? Math.ceil(remainingPages / khatma.dailyGoalPages)
      : remainingPages;

  const wirdStartPage = lastRead?.page ?? 1;
  const wirdEndPage = Math.min(604, wirdStartPage + Math.max(1, khatma.dailyGoalPages) - 1);

  const loadAyahOfDay = useCallback(async () => {
    setAyahLoading(true);
    setAyahError(null);
    try {
      const globalNum = getDeterministicAyahOfDayNumber(today);
      const res = await fetchAyahByNumber(globalNum);
      setAyahOfDay(res.data);
    } catch (err) {
      setAyahError(
        err instanceof Error ? err.message : 'تعذر تحميل آية اليوم من الخادم'
      );
    } finally {
      setAyahLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void loadAyahOfDay();
  }, [loadAyahOfDay]);

  const handleLogPages = (delta: number) => {
    onUpdateKhatma((prev) => {
      const prevTodayCount = prev.todayDate === today ? prev.pagesReadToday : 0;
      const nextTodayCount = Math.max(0, prevTodayCount + delta);

      const nextSet = new Set(prev.completedPages);
      if (delta > 0) {
        let added = 0;
        let p = lastRead?.page ?? 1;
        while (added < delta && p <= 604) {
          if (!nextSet.has(p)) {
            nextSet.add(p);
            added++;
          }
          p++;
        }
        // Fallback fill if pages near end were already marked
        for (let i = 1; i <= 604 && added < delta; i++) {
          if (!nextSet.has(i)) {
            nextSet.add(i);
            added++;
          }
        }
      }

      return {
        ...prev,
        todayDate: today,
        pagesReadToday: nextTodayCount,
        completedPages: Array.from(nextSet).sort((a, b) => a - b),
      };
    });
  };

  const handleToggleReminder = async () => {
    setReminderNotice(null);
    if (khatma.reminderEnabled) {
      onUpdateKhatma((prev) => ({ ...prev, reminderEnabled: false }));
      return;
    }

    if (typeof Notification === 'undefined') {
      setNotifStatus('unsupported');
      setReminderNotice('المتصفح الحالي لا يدعم إشعارات النظام.');
      return;
    }

    let perm = Notification.permission;
    if (perm === 'default') {
      perm = await Notification.requestPermission();
    }
    setNotifStatus(perm);

    if (perm === 'granted') {
      onUpdateKhatma((prev) => ({ ...prev, reminderEnabled: true }));
      new Notification('صديق المسلم — تذكير الورد اليومي', {
        body: `تم تفعيل التذكير اليومي لوردك (${toArabicDigits(khatma.dailyGoalPages)} صفحات).`,
      });
    } else {
      setReminderNotice('يرجى السماح بالإشعارات من إعدادات المتصفح لتفعيل التذكير.');
    }
  };

  const handleSendTestNotification = () => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      setReminderNotice('الإذن غير ممنوح لإرسال الإشعارات.');
      return;
    }
    new Notification('صديق المسلم — وردك اليومي', {
      body: `ورد اليوم: من صفحة ${toArabicDigits(wirdStartPage)} إلى صفحة ${toArabicDigits(wirdEndPage)}.`,
    });
  };

  const handleShareAyahOfDay = async () => {
    if (!ayahOfDay) return;
    setSharing(true);
    try {
      await shareAyahAsImage({
        ayahText: stripLeadingBasmala(
          ayahOfDay.text,
          ayahOfDay.surah?.number ?? 1,
          ayahOfDay.numberInSurah
        ),
        surahName: ayahOfDay.surah?.name ?? '',
        ayahNumber: ayahOfDay.numberInSurah,
        darkMode: isDark,
      });
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-5 pb-8 space-y-6">
      <header className="border-b border-neutral-200 dark:border-neutral-800 pb-4">
        <h1 className="text-xl sm:text-2xl font-bold text-black dark:text-white">
          الختمة والورد اليومي
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
          تابع تقدمك في ختم القرآن الكريم، حدد وردك اليومي، وتدبّر آية اليوم
        </p>
      </header>

      {/* Ayah of the Day */}
      <section className="mushaf-page-surface rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span className="font-bold text-black dark:text-white">آية اليوم</span>
          {ayahOfDay && (
            <span>
              {ayahOfDay.surah?.name} · الآية {toArabicDigits(ayahOfDay.numberInSurah)}
            </span>
          )}
        </div>

        {ayahLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-xs text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin text-black dark:text-white" />
            <span>جارٍ جلب آية اليوم...</span>
          </div>
        ) : ayahError ? (
          <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">{ayahError}</p>
            <button
              type="button"
              onClick={() => void loadAyahOfDay()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        ) : ayahOfDay ? (
          <>
            <p className="font-quran text-2xl leading-[2.2] text-black dark:text-white mb-4">
              {stripLeadingBasmala(
                ayahOfDay.text,
                ayahOfDay.surah?.number ?? 1,
                ayahOfDay.numberInSurah
              )}{' '}
              <span className="text-xl">﴿{toArabicDigits(ayahOfDay.numberInSurah)}﴾</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onJumpToPage(ayahOfDay.page, ayahOfDay.number)}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-black px-4 text-xs font-semibold text-white dark:bg-white dark:text-black"
              >
                <BookOpen className="h-4 w-4" />
                <span>اقرأ في المصحف (ص {toArabicDigits(ayahOfDay.page)})</span>
              </button>
              <button
                type="button"
                disabled={sharing}
                onClick={() => void handleShareAyahOfDay()}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-neutral-300 px-4 text-xs font-semibold text-black hover:bg-neutral-100 dark:border-neutral-700 dark:text-white dark:hover:bg-neutral-900 disabled:opacity-50"
              >
                {sharing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                <span>مشاركة كصورة</span>
              </button>
            </div>
          </>
        ) : null}
      </section>

      {/* Khatma Progress & Daily Goal */}
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-black dark:text-white">تقدم الختمة</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
              {toArabicDigits(totalCompleted)} من {toArabicDigits(604)} صفحة · المتبقي{' '}
              {toArabicDigits(daysRemaining)} يوم تقريباً
            </p>
          </div>
          <span className="text-2xl font-bold tabular-nums text-black dark:text-white">
            {toArabicDigits(progressPct)}%
          </span>
        </div>

        {/* Monochrome progress bar */}
        <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-black dark:bg-white transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Today's metrics & logging */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              قراءة اليوم
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xl font-bold tabular-nums text-black dark:text-white">
                {toArabicDigits(pagesReadToday)} / {toArabicDigits(khatma.dailyGoalPages)} صفحة
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleLogPages(-1)}
                  disabled={pagesReadToday <= 0}
                  aria-label="إنقاص صفحة"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-black disabled:opacity-35 dark:border-neutral-800 dark:text-white"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleLogPages(1)}
                  aria-label="إضافة صفحة مقروءة"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-black text-white dark:bg-white dark:text-black"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
            <label
              htmlFor="daily-goal-input"
              className="block text-xs text-neutral-500 dark:text-neutral-400"
            >
              الهدف اليومي (صفحات)
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              {[4, 10, 20].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    onUpdateKhatma((prev) => ({ ...prev, dailyGoalPages: preset }))
                  }
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-bold tabular-nums transition-colors ${
                    khatma.dailyGoalPages === preset
                      ? 'bg-black text-white dark:bg-white dark:text-black'
                      : 'border border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {toArabicDigits(preset)}
                </button>
              ))}
              <input
                id="daily-goal-input"
                type="number"
                min={1}
                max={100}
                value={khatma.dailyGoalPages}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(100, Number(e.target.value) || 1));
                  onUpdateKhatma((prev) => ({ ...prev, dailyGoalPages: val }));
                }}
                className="w-16 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-center text-xs font-bold tabular-nums dark:border-neutral-800 dark:bg-black"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              onUpdateKhatma((prev) => ({
                ...prev,
                completedPages: [],
                pagesReadToday: 0,
                todayDate: today,
              }))
            }
            className="text-xs font-medium text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white"
          >
            إعادة ضبط سجل الختمة
          </button>
        </div>
      </section>

      {/* Daily Wird & Browser Notification Reminder */}
      <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-black dark:text-white">الورد اليومي</h2>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
              من صفحة {toArabicDigits(wirdStartPage)} إلى صفحة {toArabicDigits(wirdEndPage)} (
              {toArabicDigits(wirdEndPage - wirdStartPage + 1)} صفحات)
            </p>
          </div>
          <button
            type="button"
            onClick={() => onJumpToPage(wirdStartPage)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-black px-5 text-xs font-bold text-white dark:bg-white dark:text-black"
          >
            <BookOpen className="h-4 w-4" />
            <span>ابدأ ورد اليوم</span>
          </button>
        </div>

        <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Bell className="h-5 w-5 shrink-0 text-black dark:text-white" />
            <div>
              <div className="text-sm font-semibold text-black dark:text-white">
                تذكير الورد اليومي
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {notifStatus === 'unsupported'
                  ? 'إشعارات المتصفح غير مدعومة هنا'
                  : khatma.reminderEnabled
                    ? 'مفعّل بإذن المتصفح'
                    : 'تفعيل تنبيه يومي للقراءة'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              aria-label="وقت التذكير"
              value={khatma.reminderTime}
              onChange={(e) =>
                onUpdateKhatma((prev) => ({ ...prev, reminderTime: e.target.value }))
              }
              className="min-h-[40px] rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold tabular-nums dark:border-neutral-800 dark:bg-black"
            />
            <button
              type="button"
              onClick={() => void handleToggleReminder()}
              className={`min-h-[40px] rounded-xl px-4 text-xs font-bold transition-colors ${
                khatma.reminderEnabled
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'border border-neutral-300 text-black dark:border-neutral-700 dark:text-white'
              }`}
            >
              {khatma.reminderEnabled ? 'إيقاف التذكير' : 'تفعيل التذكير'}
            </button>
            {khatma.reminderEnabled && notifStatus === 'granted' && (
              <button
                type="button"
                onClick={handleSendTestNotification}
                className="min-h-[40px] rounded-xl border border-neutral-200 px-3 text-xs font-semibold dark:border-neutral-800"
              >
                تجربة الإشعار
              </button>
            )}
          </div>
        </div>

        {reminderNotice && (
          <p className="text-xs text-neutral-600 dark:text-neutral-400">{reminderNotice}</p>
        )}
      </section>
    </div>
  );
}
