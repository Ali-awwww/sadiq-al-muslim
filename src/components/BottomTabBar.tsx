import { BookOpen, CheckCircle2, Headphones, Layers, Settings } from 'lucide-react';
import type { AppTab } from '../types/quran';

interface BottomTabBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}

const TABS: Array<{ id: AppTab; label: string; icon: typeof BookOpen }> = [
  { id: 'mushaf', label: 'المصحف', icon: BookOpen },
  { id: 'reciters', label: 'القرّاء', icon: Headphones },
  { id: 'understanding', label: 'التفسير والحفظ', icon: Layers },
  { id: 'khatma', label: 'الختمة', icon: CheckCircle2 },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

export function BottomTabBar({ activeTab, onSelectTab }: BottomTabBarProps) {
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-black/95 pb-safe"
    >
      <div className="mx-auto grid max-w-4xl grid-cols-5 items-center h-15">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 transition-colors focus-visible:outline-2 focus-visible:outline-black dark:focus-visible:outline-white ${
                isActive
                  ? 'text-black dark:text-white font-bold'
                  : 'text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white font-medium'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.4 : 1.7} />
              <span className="text-[10px] sm:text-[11px] leading-tight whitespace-nowrap truncate max-w-full">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
