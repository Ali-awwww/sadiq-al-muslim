import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareAyahAsImage, wrapArabicLines } from '../src/lib/shareImage';

describe('wrapArabicLines', () => {
  const fakeCtx = {
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as unknown as CanvasRenderingContext2D;

  it('keeps short text on a single line', () => {
    const lines = wrapArabicLines(fakeCtx, 'نص قصير', 200);
    expect(lines).toEqual(['نص قصير']);
  });

  it('splits "aaaa bbbb cccc" into ["aaaa", "bbbb", "cccc"] when maxWidth is 50', () => {
    const lines = wrapArabicLines(fakeCtx, 'aaaa bbbb cccc', 50);
    expect(lines).toEqual(['aaaa', 'bbbb', 'cccc']);
  });

  it('keeps a single word longer than maxWidth on a single line without splitting', () => {
    const lines = wrapArabicLines(fakeCtx, 'wordtoolongformaxwidth', 50);
    expect(lines).toEqual(['wordtoolongformaxwidth']);
  });

  it('returns empty array [] for empty text or spaces only', () => {
    expect(wrapArabicLines(fakeCtx, '', 50)).toEqual([]);
    expect(wrapArabicLines(fakeCtx, '   ', 50)).toEqual([]);
    expect(wrapArabicLines(fakeCtx, '\t\n  ', 50)).toEqual([]);
  });
});

describe('shareAyahAsImage', () => {
  let createdCanvases: Array<{
    width: number;
    height: number;
    ctx: any;
  }> = [];
  let createdAnchors: Array<{
    href: string;
    download: string;
    click: any;
    remove: any;
  }> = [];
  let filledTexts: string[] = [];
  let fillStylesUsed: string[] = [];
  let shareMock: any;
  let canShareMock: any;
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    createdCanvases = [];
    createdAnchors = [];
    filledTexts = [];
    fillStylesUsed = [];

    shareMock = vi.fn().mockResolvedValue(undefined);
    canShareMock = vi.fn().mockReturnValue(true);

    // Mock global navigator safely in Node
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        canShare: canShareMock,
        share: shareMock,
      },
      configurable: true,
      writable: true,
    });

    // Mock URL methods
    if (!globalThis.URL.createObjectURL) {
      globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    } else {
      vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    }
    if (!globalThis.URL.revokeObjectURL) {
      globalThis.URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => {});
    }

    // Mock document and canvas elements
    Object.defineProperty(globalThis, 'document', {
      value: {
        fonts: {
          ready: Promise.resolve(),
        },
        body: {
          appendChild: vi.fn(),
        },
        createElement: (tagName: string) => {
          if (tagName === 'canvas') {
            let currentFont = '';
            let currentFillStyle = '';
            const mockCtx = {
              get font() {
                return currentFont;
              },
              set font(f: string) {
                currentFont = f;
              },
              get fillStyle() {
                return currentFillStyle;
              },
              set fillStyle(s: string) {
                currentFillStyle = s;
                fillStylesUsed.push(s);
              },
              strokeStyle: '',
              lineWidth: 1,
              textAlign: '',
              direction: '',
              textBaseline: '',
              measureText: (text: string) => ({ width: text.length * 10 }),
              fillRect: vi.fn(),
              strokeRect: vi.fn(),
              beginPath: vi.fn(),
              moveTo: vi.fn(),
              lineTo: vi.fn(),
              stroke: vi.fn(),
              fillText: vi.fn((text: string) => {
                filledTexts.push(text);
              }),
            };

            const canvasObj = {
              width: 0,
              height: 0,
              ctx: mockCtx,
              getContext: (type: string) => (type === '2d' ? mockCtx : null),
              toBlob: (callback: (blob: Blob) => void, type = 'image/png') => {
                const fakeBlob = new Blob(['mock-png-data'], { type });
                callback(fakeBlob);
              },
            };
            createdCanvases.push(canvasObj);
            return canvasObj;
          }

          if (tagName === 'a') {
            const anchorObj = {
              href: '',
              download: '',
              click: vi.fn(),
              remove: vi.fn(),
            };
            createdAnchors.push(anchorObj);
            return anchorObj;
          }

          return {};
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    }
  });

  it('calls navigator.share with file sadiq-ayah-7.png, type image/png, and correct title & text when canShare is supported', async () => {
    await shareAyahAsImage({
      ayahText: 'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ',
      surahName: 'الفاتحة',
      ayahNumber: 7,
      darkMode: false,
    });

    expect(canShareMock).toHaveBeenCalled();
    expect(shareMock).toHaveBeenCalledTimes(1);

    const sharePayload = shareMock.mock.calls[0][0];
    expect(sharePayload).toBeDefined();

    // Verify share title & text
    expect(['صديق المسلم', 'آية من القرآن الكريم']).toContain(sharePayload.title);
    expect(sharePayload.text).toMatch(/سورة الفاتحة.*الآية ٧/);

    // Verify file properties
    expect(sharePayload.files).toHaveLength(1);
    const sharedFile = sharePayload.files[0];
    expect(sharedFile.name).toBe('sadiq-ayah-7.png');
    expect(sharedFile.type).toBe('image/png');
  });

  it('falls back to browser anchor download with file name sadiq-ayah-7.png when canShare is absent or false', async () => {
    canShareMock.mockReturnValue(false);

    await shareAyahAsImage({
      ayahText: 'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ',
      surahName: 'الفاتحة',
      ayahNumber: 7,
      darkMode: false,
    });

    expect(shareMock).not.toHaveBeenCalled();
    expect(createdAnchors.length).toBeGreaterThanOrEqual(1);

    const anchor = createdAnchors[createdAnchors.length - 1];
    expect(anchor.download).toBe('sadiq-ayah-7.png');
    expect(anchor.click).toHaveBeenCalled();
  });

  it('uses 1080 canvas width, height >= 900, and verifies light/dark background colors', async () => {
    // Light mode test
    await shareAyahAsImage({
      ayahText: 'بسم الله الرحمن الرحيم',
      surahName: 'الفاتحة',
      ayahNumber: 1,
      darkMode: false,
    });

    const lightCanvas = createdCanvases[createdCanvases.length - 1];
    expect(lightCanvas.width).toBe(1080);
    expect(lightCanvas.height).toBeGreaterThanOrEqual(900);
    // Verifies light background is either '#f6f0e0' or monochrome '#ffffff'
    expect(fillStylesUsed.some((s) => s === '#f6f0e0' || s === '#ffffff')).toBe(true);

    // Dark mode test
    fillStylesUsed = [];
    await shareAyahAsImage({
      ayahText: 'بسم الله الرحمن الرحيم',
      surahName: 'الفاتحة',
      ayahNumber: 1,
      darkMode: true,
    });

    const darkCanvas = createdCanvases[createdCanvases.length - 1];
    expect(darkCanvas.width).toBe(1080);
    expect(darkCanvas.height).toBeGreaterThanOrEqual(900);
    // Verifies dark background is either '#141c18' or monochrome '#000000'
    expect(fillStylesUsed.some((s) => s === '#141c18' || s === '#000000')).toBe(true);
  });

  it('does not duplicate "سورة" when surahName already starts with "سورة"', async () => {
    await shareAyahAsImage({
      ayahText: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
      surahName: 'سورة الفاتحة',
      ayahNumber: 2,
      darkMode: false,
    });

    // Ensure no attribution text repeats "سورة سورة"
    const hasRepeatedSurah = filledTexts.some((t) => t.includes('سورة سورة'));
    expect(hasRepeatedSurah).toBe(false);

    // Ensure the attribution contains "سورة الفاتحة"
    const hasCorrectAttribution = filledTexts.some((t) => t.includes('سورة الفاتحة') && t.includes('الآية ٢'));
    expect(hasCorrectAttribution).toBe(true);
  });
});
