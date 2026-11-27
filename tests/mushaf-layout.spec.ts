import { describe, expect, it } from 'vitest';
import {
  calculateMushafScale,
  computeDragVisualOffset,
  determineSwipeAxis,
  evaluateSwipeRelease,
  MUSHAF_PAGE_ASPECT_RATIO,
  MUSHAF_PAGE_HEIGHT,
  MUSHAF_PAGE_WIDTH,
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
