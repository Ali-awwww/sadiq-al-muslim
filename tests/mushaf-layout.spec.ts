import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  calculateMushafScale,
  computeAyahHighlightRect,
  computeDragVisualOffset,
  determineSwipeAxis,
  evaluateSwipeRelease,
  MUSHAF_PAGE_ASPECT_RATIO,
  MUSHAF_PAGE_HEIGHT,
  MUSHAF_PAGE_WIDTH,
  PAGE_MENU_ITEMS,
} from '../src/lib/mushafLayout';

describe('mushafLayout - calculateMushafScale', () => {
  it('exports standard Madani Mushaf page dimensions', () => {
    expect(MUSHAF_PAGE_WIDTH).toBeCloseTo(510.236, 3);
    expect(MUSHAF_PAGE_HEIGHT).toBeCloseTo(729.448, 3);
    expect(MUSHAF_PAGE_ASPECT_RATIO).toBeCloseTo(510.236 / 729.448, 5);
  });

  describe('calculates uniform contain scale across different screen form factors', () => {
    it('handles tall screens (e.g. mobile 390x844) with fit-width', () => {
      const viewport = { width: 390, height: 844 };
      const res = calculateMushafScale(viewport);

      const expectedScaleX = 390 / MUSHAF_PAGE_WIDTH;
      const expectedScaleY = 844 / MUSHAF_PAGE_HEIGHT;
      const expectedScale = Math.min(expectedScaleX, expectedScaleY);

      expect(res.scale).toBeCloseTo(expectedScale, 5);
      // For tall screens, width scale is smaller so page fits width exactly without side clipping
      expect(res.scaledWidth).toBeCloseTo(390, 2);
      expect(res.scaledHeight).toBeLessThanOrEqual(viewport.height);
      expect(res.offsetX).toBeCloseTo(0, 2);
      expect(res.offsetY).toBeGreaterThanOrEqual(0); // Symmetrical vertical centering margin
    });

    it('handles wide screens (e.g. tablet landscape 1280x800) with fit-height', () => {
      const viewport = { width: 1280, height: 800 };
      const res = calculateMushafScale(viewport);

      const expectedScaleX = 1280 / MUSHAF_PAGE_WIDTH;
      const expectedScaleY = 800 / MUSHAF_PAGE_HEIGHT;
      const expectedScale = Math.min(expectedScaleX, expectedScaleY);

      expect(res.scale).toBeCloseTo(expectedScale, 5);
      // For wide screens, height scale is smaller so page fits height exactly without top/bottom clipping
      expect(res.scaledHeight).toBeCloseTo(800, 2);
      expect(res.scaledWidth).toBeLessThanOrEqual(viewport.width);
      expect(res.offsetY).toBeCloseTo(0, 2);
      expect(res.offsetX).toBeGreaterThanOrEqual(0); // Symmetrical horizontal centering margin
    });

    it('handles square-ish screens (e.g. foldable/square 600x600) with fit-height', () => {
      const viewport = { width: 600, height: 600 };
      const res = calculateMushafScale(viewport);

      const scaleX = 600 / MUSHAF_PAGE_WIDTH; // ~1.176
      const scaleY = 600 / MUSHAF_PAGE_HEIGHT; // ~0.822
      expect(scaleX).toBeGreaterThan(scaleY);
      expect(res.scale).toBeCloseTo(scaleY, 5);
      expect(res.scaledHeight).toBeCloseTo(600, 2);
      expect(res.scaledWidth).toBeLessThanOrEqual(600);
      expect(res.offsetY).toBeCloseTo(0, 2);
      expect(res.offsetX).toBeGreaterThanOrEqual(0);
    });
  });

  describe('preserves aspect ratio without distortion and fits inside viewport completely', () => {
    const viewports = [
      { name: 'phone portrait', width: 360, height: 800 },
      { name: 'phone tall', width: 412, height: 915 },
      { name: 'tablet portrait', width: 800, height: 1280 },
      { name: 'tablet landscape', width: 1366, height: 768 },
      { name: 'square', width: 700, height: 700 },
    ];

    viewports.forEach(({ name, width, height }) => {
      it(`fits within viewport and preserves aspect ratio on ${name} (${width}x${height})`, () => {
        const res = calculateMushafScale({ width, height });

        // Fits inside viewport completely without clipping
        expect(res.scaledWidth).toBeLessThanOrEqual(width + 0.001);
        expect(res.scaledHeight).toBeLessThanOrEqual(height + 0.001);

        // Aspect ratio is strictly preserved (no distortion)
        const computedRatio = res.scaledWidth / res.scaledHeight;
        expect(computedRatio).toBeCloseTo(MUSHAF_PAGE_ASPECT_RATIO, 4);

        // Entire page is visible inside screen (no negative offsets)
        expect(res.offsetX).toBeGreaterThanOrEqual(-0.001);
        expect(res.offsetY).toBeGreaterThanOrEqual(-0.001);
      });
    });
  });

  describe('ensures symmetrical centering for even margins', () => {
    it('verifies horizontal and vertical centering offsets are mathematically symmetrical', () => {
      const viewports = [
        { width: 375, height: 812 },
        { width: 1024, height: 768 },
        { width: 500, height: 500 },
      ];

      for (const vp of viewports) {
        const res = calculateMushafScale(vp);

        // Left margin equals right margin: left space = res.offsetX, right edge = res.offsetX + res.scaledWidth
        const rightSpace = vp.width - (res.offsetX + res.scaledWidth);
        expect(rightSpace).toBeCloseTo(res.offsetX, 5);

        // Top margin equals bottom margin
        const bottomSpace = vp.height - (res.offsetY + res.scaledHeight);
        expect(bottomSpace).toBeCloseTo(res.offsetY, 5);
      }
    });
  });
});

describe('mushafLayout - pure swipe gesture and axis-locking logic', () => {
  it('locks axis once movement crosses threshold and prevents switching mid-gesture', () => {
    expect(determineSwipeAxis(4, 3, null, 8)).toBeNull();
    expect(determineSwipeAxis(12, 3, null, 8)).toBe('x');
    expect(determineSwipeAxis(3, 15, null, 8)).toBe('y');

    // Already locked to 'x': even a huge vertical move keeps 'x' locked
    expect(determineSwipeAxis(12, 120, 'x', 8)).toBe('x');
    // Already locked to 'y': even a huge horizontal move keeps 'y' locked
    expect(determineSwipeAxis(120, 15, 'y', 8)).toBe('y');
  });

  it('tracks horizontal finger movement at 100% zoom without vertical drift and applies edge resistance', () => {
    const mid = computeDragVisualOffset({
      dx: 90,
      dy: 30,
      lockedAxis: 'x',
      startPanX: 0,
      startPanY: 0,
      maxPanX: 0,
      maxPanY: 0,
      currentPage: 2,
    });
    expect(mid.translateX).toBe(90);
    expect(mid.translateY).toBe(0);
    expect(mid.swipeDeltaX).toBe(90);

    // At page 1 swiping left (before minPage) applies 0.35x resistance
    const minEdge = computeDragVisualOffset({
      dx: -100,
      dy: 0,
      lockedAxis: 'x',
      startPanX: 0,
      startPanY: 0,
      maxPanX: 0,
      maxPanY: 0,
      currentPage: 1,
    });
    expect(minEdge.translateX).toBeCloseTo(-35, 3);

    // At page 604 swiping right (past maxPage) applies 0.35x resistance
    const maxEdge = computeDragVisualOffset({
      dx: 100,
      dy: 0,
      lockedAxis: 'x',
      startPanX: 0,
      startPanY: 0,
      maxPanX: 0,
      maxPanY: 0,
      currentPage: 604,
    });
    expect(maxEdge.translateX).toBeCloseTo(35, 3);
  });

  it('supports vertical pan when zoomed without triggering horizontal swipe offset', () => {
    const verticalPan = computeDragVisualOffset({
      dx: 50,
      dy: -80,
      lockedAxis: 'y',
      startPanX: 10,
      startPanY: 0,
      maxPanX: 60,
      maxPanY: 120,
      currentPage: 5,
    });
    expect(verticalPan.translateX).toBe(10);
    expect(verticalPan.translateY).toBe(-80);
    expect(verticalPan.swipeDeltaX).toBe(0);

    // Zoomed horizontal drag pans inside maxPanX before producing swipeDeltaX overscroll
    const zoomedPanOnly = computeDragVisualOffset({
      dx: 40,
      dy: 0,
      lockedAxis: 'x',
      startPanX: 0,
      startPanY: 0,
      maxPanX: 60,
      maxPanY: 120,
      currentPage: 5,
    });
    expect(zoomedPanOnly.nextPanX).toBe(40);
    expect(zoomedPanOnly.swipeDeltaX).toBe(0);

    const zoomedOverscroll = computeDragVisualOffset({
      dx: 120,
      dy: 0,
      lockedAxis: 'x',
      startPanX: 0,
      startPanY: 0,
      maxPanX: 60,
      maxPanY: 120,
      currentPage: 5,
    });
    expect(zoomedOverscroll.nextPanX).toBe(60);
    expect(zoomedOverscroll.swipeDeltaX).toBe(60);
  });

  it('evaluates swipe release with RTL book direction, distance/velocity thresholds, and cancellation', () => {
    // RTL: swipe right (+dx) -> next page (1 -> 2)
    const nextRes = evaluateSwipeRelease({
      swipeDeltaX: 85,
      dt: 240,
      lockedAxis: 'x',
      viewportWidth: 390,
      currentPage: 1,
    });
    expect(nextRes.direction).toBe('next');
    expect(nextRes.targetPage).toBe(2);
    expect(nextRes.exitOffsetX).toBeGreaterThan(0);
    expect(nextRes.enterOffsetX).toBeLessThan(0);

    // RTL: swipe left (-dx) -> previous page (3 -> 2)
    const prevRes = evaluateSwipeRelease({
      swipeDeltaX: -85,
      dt: 240,
      lockedAxis: 'x',
      viewportWidth: 390,
      currentPage: 3,
    });
    expect(prevRes.direction).toBe('prev');
    expect(prevRes.targetPage).toBe(2);
    expect(prevRes.exitOffsetX).toBeLessThan(0);
    expect(prevRes.enterOffsetX).toBeGreaterThan(0);

    // Fast short flick flips even below distance ratio
    const flickRes = evaluateSwipeRelease({
      swipeDeltaX: 38,
      dt: 95,
      lockedAxis: 'x',
      viewportWidth: 390,
      currentPage: 2,
    });
    expect(flickRes.direction).toBe('next');
    expect(flickRes.targetPage).toBe(3);

    // Slow short drag below threshold cancels cleanly
    const cancelShort = evaluateSwipeRelease({
      swipeDeltaX: 25,
      dt: 400,
      lockedAxis: 'x',
      viewportWidth: 390,
      currentPage: 2,
    });
    expect(cancelShort.direction).toBe('cancel');
    expect(cancelShort.targetPage).toBeNull();

    // Vertical-locked gesture never flips pages
    const cancelVertical = evaluateSwipeRelease({
      swipeDeltaX: 120,
      dt: 150,
      lockedAxis: 'y',
      viewportWidth: 390,
      currentPage: 2,
    });
    expect(cancelVertical.direction).toBe('cancel');
    expect(cancelVertical.targetPage).toBeNull();

    // Boundary pages do not exceed 1..604
    expect(
      evaluateSwipeRelease({
        swipeDeltaX: -120,
        dt: 150,
        lockedAxis: 'x',
        viewportWidth: 390,
        currentPage: 1,
      }).targetPage
    ).toBeNull();

    expect(
      evaluateSwipeRelease({
        swipeDeltaX: 120,
        dt: 150,
        lockedAxis: 'x',
        viewportWidth: 390,
        currentPage: 604,
      }).targetPage
    ).toBeNull();
  });
});

describe('mushafLayout - 2-column grid page menu items', () => {
  it('contains exactly the 3 required elements: surah, page_display, and jump', () => {
    expect(PAGE_MENU_ITEMS).toHaveLength(3);
    const ids = PAGE_MENU_ITEMS.map((item) => item.id);
    expect(ids).toEqual(['surah', 'page_display', 'jump']);
  });

  it('does not contain any previous or next page flipping buttons', () => {
    const ids = PAGE_MENU_ITEMS.map((item) => item.id);
    expect(ids).not.toContain('prev');
    expect(ids).not.toContain('next');
    expect(ids).not.toContain('previous');
    expect(ids).not.toContain('chevron');

    const titles = PAGE_MENU_ITEMS.map((item) => item.title);
    for (const title of titles) {
      expect(title).not.toMatch(/سابق|تالي|Chevron/i);
    }
  });

  it('has non-empty titles and valid configurations for all items', () => {
    for (const item of PAGE_MENU_ITEMS) {
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(typeof item.title).toBe('string');
      expect(item.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('mushafLayout - on-page translucent yellow ayah highlight', () => {
  const samplePage8Ayahs = [
    { number: 56, numberInSurah: 49, text: 'وَإِذْ نَجَّيْنَاكُم مِّنْ آلِ فِرْعَوْنَ', surahNumber: 2 },
    { number: 57, numberInSurah: 50, text: 'وَإِذْ فَرَقْنَا بِكُمُ الْبَحْرَ فَأَنجَيْنَاكُمْ', surahNumber: 2 },
    { number: 58, numberInSurah: 51, text: 'وَإِذْ وَاعَدْنَا مُوسَىٰ أَرْبَعِينَ لَيْلَةً', surahNumber: 2 },
    { number: 59, numberInSurah: 52, text: 'ثُمَّ عَفَوْنَا عَنكُم مِّن بَعْدِ ذَٰلِكَ لَعَلَّكُمْ تَشْكُرُونَ', surahNumber: 2 },
    { number: 60, numberInSurah: 53, text: 'وَإِذْ آتَيْنَا مُوسَى الْكِتَابَ وَالْفُرْقَانَ لَعَلَّكُمْ تَهْتَدُونَ', surahNumber: 2 },
    { number: 61, numberInSurah: 54, text: 'وَإِذْ قَالَ مُوسَىٰ لِقَوْمِهِ يَا قَوْمِ إِنَّكُمْ ظَلَمْتُمْ أَنفُسَكُم', surahNumber: 2 },
    { number: 62, numberInSurah: 55, text: 'وَإِذْ قُلْتُمْ يَا مُوسَىٰ لَن نُّؤْمِنَ لَكَ حَتَّىٰ نَرَى اللَّهَ جَهْرَةً', surahNumber: 2 },
    { number: 63, numberInSurah: 56, text: 'ثُمَّ بَعَثْنَاكُم مِّن بَعْدِ مَوْتِكُمْ لَعَلَّكُمْ تَشْكُرُونَ', surahNumber: 2 },
    { number: 64, numberInSurah: 57, text: 'وَظَلَّلْنَا عَلَيْكُمُ الْغَمَامَ وَأَنزَلْنَا عَلَيْكُمُ الْمَنَّ وَالسَّلْوَىٰ', surahNumber: 2 },
  ];

  it('calculates accurate highlight bounds across sequential ayahs on a page', () => {
    // Ayah 49 at the top of page 8
    const topAyah = computeAyahHighlightRect({
      page: 8,
      surahNumber: 2,
      ayahNumberInSurah: 49,
      ayahsOnPage: samplePage8Ayahs,
    });
    expect(topAyah).not.toBeNull();
    expect(topAyah!.surahNumber).toBe(2);
    expect(topAyah!.ayahNumberInSurah).toBe(49);
    expect(topAyah!.topPercent).toBeCloseTo(9.2, 1);
    expect(topAyah!.leftPercent).toBe(7.5);
    expect(topAyah!.widthPercent).toBe(85.0);
    expect(topAyah!.heightPercent).toBeGreaterThanOrEqual(5.2);

    // Ayah 53 in the middle of page 8
    const midAyah = computeAyahHighlightRect({
      page: 8,
      surahNumber: 2,
      ayahNumberInSurah: 53,
      ayahsOnPage: samplePage8Ayahs,
    });
    expect(midAyah).not.toBeNull();
    expect(midAyah!.topPercent).toBeGreaterThan(topAyah!.topPercent);

    // Ayah 57 near the bottom of page 8
    const botAyah = computeAyahHighlightRect({
      page: 8,
      surahNumber: 2,
      ayahNumberInSurah: 57,
      ayahsOnPage: samplePage8Ayahs,
    });
    expect(botAyah).not.toBeNull();
    expect(botAyah!.topPercent).toBeGreaterThan(midAyah!.topPercent);
    expect(botAyah!.topPercent + botAyah!.heightPercent).toBeLessThanOrEqual(91.5);
  });

  it('returns null when active recited ayah belongs to a different page', () => {
    // Ayah 58 is on page 9, not page 8
    const diffPage = computeAyahHighlightRect({
      page: 8,
      surahNumber: 2,
      ayahNumberInSurah: 58,
      ayahsOnPage: samplePage8Ayahs,
    });
    expect(diffPage).toBeNull();

    // Surah 3 is not on page 8
    const diffSurah = computeAyahHighlightRect({
      page: 8,
      surahNumber: 3,
      ayahNumberInSurah: 1,
      ayahsOnPage: samplePage8Ayahs,
    });
    expect(diffSurah).toBeNull();
  });

  it('handles special opening spread pages (e.g. page 1 Al-Fatihah) within illuminated frame', () => {
    const fatihahAyahs = [
      { number: 1, numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', surahNumber: 1 },
      { number: 2, numberInSurah: 2, text: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ', surahNumber: 1 },
      { number: 3, numberInSurah: 3, text: 'الرَّحْمَٰنِ الرَّحِيمِ', surahNumber: 1 },
      { number: 4, numberInSurah: 4, text: 'مَالِكِ يَوْمِ الدِّينِ', surahNumber: 1 },
      { number: 5, numberInSurah: 5, text: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ', surahNumber: 1 },
      { number: 6, numberInSurah: 6, text: 'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ', surahNumber: 1 },
      { number: 7, numberInSurah: 7, text: 'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ', surahNumber: 1 },
    ];

    const res = computeAyahHighlightRect({
      page: 1,
      surahNumber: 1,
      ayahNumberInSurah: 1,
      ayahsOnPage: fatihahAyahs,
    });
    expect(res).not.toBeNull();
    // On page 1, inner text area starts at ~26%
    expect(res!.topPercent).toBeCloseTo(26.0, 1);
    expect(res!.leftPercent).toBe(16.5);
    expect(res!.widthPercent).toBe(67.0);
    expect(res!.heightPercent).toBeGreaterThanOrEqual(6.5);
  });

  it('guarantees minimum readable height for very short ayahs', () => {
    const shortAyahs = [
      { number: 1, numberInSurah: 1, text: 'الم', surahNumber: 2 },
      { number: 2, numberInSurah: 2, text: 'ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ', surahNumber: 2 },
    ];
    const res = computeAyahHighlightRect({
      page: 3,
      surahNumber: 2,
      ayahNumberInSurah: 1,
      ayahsOnPage: shortAyahs,
    });
    expect(res).not.toBeNull();
    expect(res!.heightPercent).toBeGreaterThanOrEqual(5.2);
  });

  it('verifies that the previous floating ayah card is removed and on-page highlight is integrated in reader', () => {
    const readerSource = fs.readFileSync(
      path.resolve(__dirname, '../src/components/MushafReader.tsx'),
      'utf8'
    );

    // Confirms yellow translucent on-page highlight is present
    expect(readerSource).toContain('data-testid="ayah-highlight"');
    expect(readerSource).toContain('bg-yellow-400/35');
    expect(readerSource).toContain('mix-blend-multiply');

    // Confirms old floating current ayah card above player is completely deleted
    expect(readerSource).not.toContain('activePageAyahObj');
    expect(readerSource).not.toContain('truncate font-quran text-xs text-neutral-600');
  });

  it('computes accurate highlight on Page 2 (Al-Baqarah ayahs 2, 3, 4) after page flip, even before page data loads', () => {
    // Before page 2 ayahs are fetched (using page meta fallback)
    const fallbackAyah3 = computeAyahHighlightRect({
      page: 2,
      surahNumber: 2,
      ayahNumberInSurah: 3,
      globalAyahNumber: 10,
      ayahsOnPage: null,
      pageStartSurah: 2,
      pageStartAyah: 1,
      nextPageStartSurah: 2,
      nextPageStartAyah: 6,
    });
    expect(fallbackAyah3).not.toBeNull();
    expect(fallbackAyah3!.surahNumber).toBe(2);
    expect(fallbackAyah3!.ayahNumberInSurah).toBe(3);
    expect(fallbackAyah3!.topPercent).toBeGreaterThanOrEqual(26.0);
    expect(fallbackAyah3!.topPercent + fallbackAyah3!.heightPercent).toBeLessThanOrEqual(73.0);

    // When page 2 ayahs data is loaded
    const page2Ayahs = [
      { number: 8, numberInSurah: 1, text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الم', surahNumber: 2 },
      { number: 9, numberInSurah: 2, text: 'ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ', surahNumber: 2 },
      { number: 10, numberInSurah: 3, text: 'الَّذِينَ يُؤْمِنُونَ بِالْغَيْبِ وَيُقِيمُونَ الصَّلَاةَ وَمِمَّا رَزَقْنَاهُمْ يُنفِقُونَ', surahNumber: 2 },
      { number: 11, numberInSurah: 4, text: 'وَالَّذِينَ يُؤْمِنُونَ بِمَا أُنزِلَ إِلَيْكَ وَمَا أُنزِلَ مِن قَبْلِكَ وَبِالْآخِرَةِ هُمْ يُوقِنُونَ', surahNumber: 2 },
      { number: 12, numberInSurah: 5, text: 'أُولَٰئِكَ عَلَىٰ هُدًى مِّن رَّبِّهِمْ ۖ وَأُولَٰئِكَ هُمُ الْمُفْلِحُونَ', surahNumber: 2 },
    ];

    for (const ayahNum of [2, 3, 4]) {
      const res = computeAyahHighlightRect({
        page: 2,
        surahNumber: 2,
        ayahNumberInSurah: ayahNum,
        globalAyahNumber: 7 + ayahNum,
        ayahsOnPage: page2Ayahs,
        pageStartSurah: 2,
        pageStartAyah: 1,
        nextPageStartSurah: 2,
        nextPageStartAyah: 6,
      });
      expect(res).not.toBeNull();
      expect(res!.ayahNumberInSurah).toBe(ayahNum);
      expect(res!.topPercent).toBeGreaterThanOrEqual(26.0);
      expect(res!.topPercent + res!.heightPercent).toBeLessThanOrEqual(73.5);
    }
  });

  it('correctly transitions ayah highlight across page boundaries within the same surah (page 2 to page 3 at ayah 7)', () => {
    const page3Ayahs = [
      { number: 13, numberInSurah: 6, text: 'إِنَّ الَّذِينَ كَفَرُوا سَوَاءٌ عَلَيْهِمْ أَأَنذَرْتَهُمْ أَمْ لَمْ تُنذِرْهُمْ لَا يُؤْمِنُونَ', surahNumber: 2 },
      { number: 14, numberInSurah: 7, text: 'خَتَمَ اللَّهُ عَلَىٰ قُلُوبِهِمْ وَعَلَىٰ سَمْعِهِمْ ۖ وَعَلَىٰ أَبْصَارِهِمْ غِشَاوَةٌ ۖ وَلَهُمْ عَذَابٌ عَظِيمٌ', surahNumber: 2 },
    ];

    // On page 2, ayah 7 belongs to page 3 -> must be null on page 2
    const onPage2 = computeAyahHighlightRect({
      page: 2,
      surahNumber: 2,
      ayahNumberInSurah: 7,
      globalAyahNumber: 14,
      pageStartSurah: 2,
      pageStartAyah: 1,
      nextPageStartSurah: 2,
      nextPageStartAyah: 6,
    });
    expect(onPage2).toBeNull();

    // On page 3, ayah 7 is rendered cleanly at its position
    const onPage3 = computeAyahHighlightRect({
      page: 3,
      surahNumber: 2,
      ayahNumberInSurah: 7,
      globalAyahNumber: 14,
      ayahsOnPage: page3Ayahs,
      pageStartSurah: 2,
      pageStartAyah: 6,
      nextPageStartSurah: 2,
      nextPageStartAyah: 17,
    });
    expect(onPage3).not.toBeNull();
    expect(onPage3!.ayahNumberInSurah).toBe(7);
    expect(onPage3!.topPercent).toBeGreaterThanOrEqual(9.2);
    expect(onPage3!.topPercent + onPage3!.heightPercent).toBeLessThanOrEqual(91.5);
  });
});



