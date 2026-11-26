import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomTabBar } from './components/BottomTabBar';
import { KhatmaView } from './components/KhatmaView';
import { MiniPlayer } from './components/MiniPlayer';
import { MushafReader } from './components/MushafReader';
import { RecitersView } from './components/RecitersView';
import { SettingsView } from './components/SettingsView';
import { UnderstandingView } from './components/UnderstandingView';
import { AudioProvider, useAudio } from './context/AudioContext';
import { useLocalStorage } from './hooks/useLocalStorage';
import { fetchFiveReciters, fetchQuranMeta } from './lib/api';
import { getTodayDateString } from './lib/arabic';
import type {
  AppSettings,
  AppTab,
  BookmarkItem,
  KhatmaState,
  LastReadPosition,
  MemoStats,
  QuranMeta,
  Reciter,
} from './types/quran';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 26,
  defaultReciterId: 112,
  tajweedEnabled: false,
};

const DEFAULT_KHATMA: KhatmaState = {
  dailyGoalPages: 4,
  completedPages: [],
  todayDate: getTodayDateString(),
  pagesReadToday: 0,
  reminderEnabled: false,
  reminderTime: '08:00',
};

const DEFAULT_MEMO_STATS: MemoStats = {
  correctCount: 0,
  retryCount: 0,
  sessionsCompleted: 0,
};

function AppShell() {
  const { activeTrack } = useAudio();

  const [activeTab, setActiveTab] = useState<AppTab>('mushaf');
  const [mushafControlsVisible, setMushafControlsVisible] = useState(false);
  const [settings, setSettings] = useLocalStorage<AppSettings>(
    'sadiq_settings_v1',
    DEFAULT_SETTINGS
  );
  const [bookmarks, setBookmarks] = useLocalStorage<BookmarkItem[]>(
    'sadiq_bookmarks_v1',
    []
  );
  const [lastRead, setLastRead] = useLocalStorage<LastReadPosition | null>(
    'sadiq_last_read_v1',
    null
  );
  const [khatma, setKhatma] = useLocalStorage<KhatmaState>(
    'sadiq_khatma_v1',
    DEFAULT_KHATMA
  );
  const [memoStats, setMemoStats] = useLocalStorage<MemoStats>(
    'sadiq_memo_stats_v1',
    DEFAULT_MEMO_STATS
  );

  const [pageZoom, setPageZoom] = useLocalStorage<number>(
    'sadiq_mushaf_zoom_v1',
    100
  );
  const [currentPage, setCurrentPage] = useState<number>(() => lastRead?.page ?? 1);
  const [tafsirTarget] = useState<{ surah: number; ayah: number }>({
    surah: 1,
    ayah: 1,
  });

  // Meta state
  const [meta, setMeta] = useState<QuranMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Reciters state
  const [reciters, setReciters] = useState<Reciter[]>([]);
  const [recitersLoading, setRecitersLoading] = useState(true);
  const [recitersError, setRecitersError] = useState<string | null>(null);

  // System dark-mode listener
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const isDark = useMemo(() => {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return systemPrefersDark;
  }, [settings.theme, systemPrefersDark]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const res = await fetchQuranMeta();
      setMeta(res.data);
    } catch (err) {
      setMetaError(
        err instanceof Error ? err.message : 'تعذر تحميل فهرس السور والأجزاء'
      );
    } finally {
      setMetaLoading(false);
    }
  }, []);

  const loadReciters = useCallback(async () => {
    setRecitersLoading(true);
    setRecitersError(null);
    try {
      const res = await fetchFiveReciters();
      setReciters(res.data);
    } catch (err) {
      setRecitersError(
        err instanceof Error ? err.message : 'تعذر تحميل قائمة القراء'
      );
    } finally {
      setRecitersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
    void loadReciters();
  }, [loadMeta, loadReciters]);

  // Daily Wird Browser Notification Scheduler
  const lastNotifiedDateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!khatma.reminderEnabled) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }

    const checkReminder = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}`;
      const todayStr = getTodayDateString();
      if (hhmm === khatma.reminderTime && lastNotifiedDateRef.current !== todayStr) {
        lastNotifiedDateRef.current = todayStr;
        new Notification('صديق المسلم — حان وقت وردك اليومي', {
          body: `ابدأ قراءة وردك اليومي من الصفحة ${lastRead?.page ?? 1}.`,
        });
      }
    };

    const interval = setInterval(checkReminder, 30000);
    return () => clearInterval(interval);
  }, [khatma.reminderEnabled, khatma.reminderTime, lastRead?.page]);

  const handleToggleBookmark = useCallback(
    (item: BookmarkItem) => {
      setBookmarks((prev) => {
        const exists = prev.some((b) => b.id === item.id);
        if (exists) {
          return prev.filter((b) => b.id !== item.id);
        }
        return [item, ...prev];
      });
    },
    [setBookmarks]
  );

  const handleTogglePageCompleted = useCallback(
    (page: number) => {
      const today = getTodayDateString();
      setKhatma((prev) => {
        const exists = prev.completedPages.includes(page);
        const prevTodayCount = prev.todayDate === today ? prev.pagesReadToday : 0;
        if (exists) {
          return {
            ...prev,
            todayDate: today,
            pagesReadToday: Math.max(0, prevTodayCount - 1),
            completedPages: prev.completedPages.filter((p) => p !== page),
          };
        }
        return {
          ...prev,
          todayDate: today,
          pagesReadToday: prevTodayCount + 1,
          completedPages: [...prev.completedPages, page].sort((a, b) => a - b),
        };
      });
    },
    [setKhatma]
  );

  const handleToggleDarkQuick = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: isDark ? 'light' : 'dark',
    }));
  }, [isDark, setSettings]);

  const handleJumpToPageFromKhatma = useCallback(
    (page: number) => {
      setCurrentPage(page);
      setActiveTab('mushaf');
    },
    []
  );

  return (
    <div
      dir="rtl"
      className={`min-h-screen bg-white text-black dark:bg-black dark:text-white ${
        activeTrack
          ? 'pb-36'
          : activeTab === 'mushaf' && !mushafControlsVisible
          ? 'pb-0'
          : 'pb-20'
      }`}
    >
      {activeTab === 'mushaf' && (
        <MushafReader
          currentPage={currentPage}
          onChangePage={setCurrentPage}
          meta={meta}
          metaLoading={metaLoading}
          metaError={metaError}
          onRetryMeta={() => void loadMeta()}
          reciters={reciters}
          recitersLoading={recitersLoading}
          recitersError={recitersError}
          onRetryReciters={() => void loadReciters()}
          selectedReciterId={settings.defaultReciterId}
          onSelectReciter={(id) =>
            setSettings((prev) => ({ ...prev, defaultReciterId: id }))
          }
          pageZoom={pageZoom}
          onChangePageZoom={setPageZoom}
          isDark={isDark}
          onToggleDark={handleToggleDarkQuick}
          bookmarks={bookmarks}
          onToggleBookmark={handleToggleBookmark}
          lastRead={lastRead}
          onUpdateLastRead={setLastRead}
          completedPages={khatma.completedPages}
          onTogglePageCompleted={handleTogglePageCompleted}
          onControlsVisibleChange={setMushafControlsVisible}
        />
      )}

      {activeTab === 'reciters' && (
        <RecitersView
          reciters={reciters}
          loading={recitersLoading}
          error={recitersError}
          onRetry={() => void loadReciters()}
          meta={meta}
          selectedDefaultReciterId={settings.defaultReciterId}
        />
      )}

      {activeTab === 'understanding' && (
        <UnderstandingView
          meta={meta}
          initialSurah={tafsirTarget.surah}
          initialAyah={tafsirTarget.ayah}
          isDark={isDark}
          memoStats={memoStats}
          onUpdateMemoStats={setMemoStats}
        />
      )}

      {activeTab === 'khatma' && (
        <KhatmaView
          khatma={khatma}
          onUpdateKhatma={setKhatma}
          lastRead={lastRead}
          onJumpToPage={handleJumpToPageFromKhatma}
          isDark={isDark}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsView
          settings={settings}
          onUpdateSettings={setSettings}
          reciters={reciters}
        />
      )}

      <MiniPlayer />
      {(activeTab !== 'mushaf' || mushafControlsVisible) && (
        <BottomTabBar activeTab={activeTab} onSelectTab={setActiveTab} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AudioProvider>
      <AppShell />
    </AudioProvider>
  );
}
