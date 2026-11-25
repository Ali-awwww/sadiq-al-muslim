export type TajweedRule = 'none' | 'ghunnah' | 'qalqalah' | 'madd' | 'noon_tanwin';

export interface TajweedSegment {
  text: string;
  rule: TajweedRule;
}

export const TAJWEED_LEGEND: Array<{
  rule: Exclude<TajweedRule, 'none'>;
  label: string;
  description: string;
  lightColor: string;
  darkColor: string;
}> = [
  {
    rule: 'noon_tanwin',
    label: 'النون الساكنة والتنوين',
    description: 'ن ساكنة أو تنوين (إظهار / إدغام / إقلاب / إخفاء)',
    lightColor: '#15803d',
    darkColor: '#4ade80',
  },
  {
    rule: 'madd',
    label: 'المدود',
    description: 'حروف المد وعلامات المد (~، آ، الألف الخنجرية)',
    lightColor: '#b91c1c',
    darkColor: '#f87171',
  },
  {
    rule: 'qalqalah',
    label: 'القلقلة',
    description: 'حروف (ق ط ب ج د) عند السكون',
    lightColor: '#1d4ed8',
    darkColor: '#60a5fa',
  },
  {
    rule: 'ghunnah',
    label: 'الغنة',
    description: 'النون والميم المشددتان (نّ / مّ)',
    lightColor: '#7e22ce',
    darkColor: '#c084fc',
  },
];

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;
const SHADDA = '\u0651';
const SUKUN = '\u0652';
const UTHMANI_SUKUN = '\u06E1'; // ۡ small high dotless head of khah (Uthmani sukun)
const MADDAH = '\u0653'; // ٓ
const SUPERSCRIPT_ALEF = '\u0670'; // ٰ
const TANWIN_CHARS = new Set(['\u064B', '\u064C', '\u064D']); // ً ٌ ٍ
const QALQALAH_LETTERS = new Set(['ق', 'ط', 'ب', 'ج', 'د']);

/**
 * Splits Uthmani Quranic text into grapheme clusters (base letter + trailing diacritics)
 * and classifies approximate rule-based Tajweed markings.
 */
export function tokenizeTajweed(text: string): TajweedSegment[] {
  const clusters: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ARABIC_DIACRITICS.test(ch) && clusters.length > 0) {
      clusters[clusters.length - 1] += ch;
    } else {
      clusters.push(ch);
    }
  }

  const classified: TajweedSegment[] = clusters.map((cluster, idx) => {
    const base = cluster[0];
    const marks = cluster.slice(1);
    let rule: TajweedRule = 'none';

    const hasShadda = marks.includes(SHADDA);
    const hasSukun = marks.includes(SUKUN) || marks.includes(UTHMANI_SUKUN);
    const hasTanwin = [...marks].some((m) => TANWIN_CHARS.has(m));
    const hasMaddMark =
      marks.includes(MADDAH) ||
      marks.includes(SUPERSCRIPT_ALEF) ||
      base === 'آ' ||
      base === '\u0670';

    // 1. Ghunnah on Noon or Meem with Shadda
    if ((base === 'ن' || base === 'م') && hasShadda) {
      rule = 'ghunnah';
    }
    // 2. Tanwin or Noon Sakinah (or bare Noon before another letter without vowel)
    else if (hasTanwin || (base === 'ن' && (hasSukun || marks.length === 0))) {
      // Check it's not the final standalone word boundary unless tanwin
      if (hasTanwin || hasSukun || (marks.length === 0 && idx < clusters.length - 1 && clusters[idx + 1] !== ' ')) {
        rule = 'noon_tanwin';
      }
    }
    // 3. Qalqalah letters with Sukun
    else if (QALQALAH_LETTERS.has(base) && hasSukun) {
      rule = 'qalqalah';
    }
    // 4. Madd (explicit Maddah, superscript alef, or Alef preceded by Fatha)
    else if (hasMaddMark) {
      rule = 'madd';
    } else if (base === 'ا' && marks.length === 0 && idx > 0) {
      const prev = clusters[idx - 1];
      if (prev.includes('\u064E') && prev[0] !== 'و') {
        rule = 'madd';
      }
    }

    return { text: cluster, rule };
  });

  // Merge adjacent segments with identical rules for cleaner rendering
  const merged: TajweedSegment[] = [];
  for (const seg of classified) {
    const last = merged[merged.length - 1];
    if (last && last.rule === seg.rule) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}
