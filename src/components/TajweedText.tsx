import { useMemo } from 'react';
import { TAJWEED_LEGEND, tokenizeTajweed } from '../lib/tajweed';

interface TajweedTextProps {
  text: string;
  enabled: boolean;
  isDark: boolean;
}

const RULE_MAP = new Map(TAJWEED_LEGEND.map((item) => [item.rule, item]));

export function TajweedText({ text, enabled, isDark }: TajweedTextProps) {
  const segments = useMemo(() => {
    if (!enabled) return null;
    return tokenizeTajweed(text);
  }, [text, enabled]);

  if (!enabled || !segments) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.rule === 'none') {
          return <span key={i}>{seg.text}</span>;
        }
        const def = RULE_MAP.get(seg.rule);
        const color = def ? (isDark ? def.darkColor : def.lightColor) : undefined;
        return (
          <span key={i} style={{ color }} title={def?.label}>
            {seg.text}
          </span>
        );
      })}
    </>
  );
}

export function TajweedLegend({ isDark }: { isDark: boolean }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3.5 bg-neutral-50/70 dark:bg-neutral-950">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-xs font-bold text-black dark:text-white">
          دليل ألوان التجويد
        </span>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
          تلوين تقريبي للأحكام
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {TAJWEED_LEGEND.map((item) => (
          <div key={item.rule} className="flex items-start gap-2 text-xs">
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: isDark ? item.darkColor : item.lightColor }}
            />
            <div>
              <div className="font-semibold text-black dark:text-white">{item.label}</div>
              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {item.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
