import { toArabicDigits } from './arabic';

interface ShareAyahOptions {
  ayahText: string;
  surahName: string;
  ayahNumber: number;
  darkMode: boolean;
}

export function wrapArabicLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = ctx.measureText(candidate).width;
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function shareAyahAsImage({
  ayahText,
  surahName,
  ayahNumber,
  darkMode,
}: ShareAyahOptions): Promise<void> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const width = 1080;
  const paddingX = 110;
  const maxTextWidth = width - paddingX * 2;

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) throw new Error('تعذر إنشاء بطاقة الصورة');

  const fontSize = ayahText.length > 260 ? 40 : ayahText.length > 140 ? 48 : 56;
  const lineHeight = Math.round(fontSize * 1.95);
  tempCtx.font = `${fontSize}px "Amiri Quran", "Amiri", serif`;
  const lines = wrapArabicLines(tempCtx, ayahText, maxTextWidth);

  const headerHeight = 160;
  const footerHeight = 180;
  const textBlockHeight = lines.length * lineHeight;
  const height = Math.max(900, headerHeight + textBlockHeight + footerHeight + 160);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر تهيئة الرسم');

  const bg = darkMode ? '#000000' : '#ffffff';
  const fg = darkMode ? '#ffffff' : '#000000';
  const muted = darkMode ? '#a3a3a3' : '#525252';
  const border = darkMode ? '#262626' : '#e5e5e5';

  // Pure monochrome background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle double hairline frame
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, width - 96, height - 96);
  ctx.strokeRect(60, 60, width - 120, height - 120);

  // Top title
  ctx.fillStyle = muted;
  ctx.textAlign = 'center';
  ctx.direction = 'rtl';
  ctx.font = '600 28px "Cairo", sans-serif';
  ctx.fillText('صديق المسلم', width / 2, 130);

  // Divider line
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 90, 160);
  ctx.lineTo(width / 2 + 90, 160);
  ctx.stroke();

  // Ayah text
  ctx.fillStyle = fg;
  ctx.font = `${fontSize}px "Amiri Quran", "Amiri", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const startY = headerHeight + 80 + lineHeight / 2;
  lines.forEach((line, idx) => {
    ctx.fillText(line, width / 2, startY + idx * lineHeight);
  });

  // Surah & Ayah attribution
  const refY = height - 155;
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 120, refY - 45);
  ctx.lineTo(width / 2 + 120, refY - 45);
  ctx.stroke();

  ctx.fillStyle = fg;
  ctx.font = '600 30px "Cairo", sans-serif';
  const cleanSurah = surahName.startsWith('سُورَةُ') || surahName.startsWith('سورة')
    ? surahName
    : `سورة ${surahName}`;
  ctx.fillText(`${cleanSurah} · الآية ${toArabicDigits(ayahNumber)}`, width / 2, refY);

  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('فشل تصدير الصورة'));
        return;
      }
      const filename = `sadiq-ayah-${ayahNumber}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      let shared = false;
      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'آية من القرآن الكريم',
            text: `سورة ${surahName} · الآية ${toArabicDigits(ayahNumber)}`,
            files: [file],
          });
          shared = true;
        } catch (err: any) {
          if (err?.name !== 'AbortError') {
            // fall back to download
          }
        }
      }

      if (!shared) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      resolve();
    }, 'image/png');
  });
}
