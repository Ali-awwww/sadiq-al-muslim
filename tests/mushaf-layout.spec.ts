import { describe, expect, it } from 'vitest';
import {
  calculateMushafScale,
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
