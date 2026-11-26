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

  describe('calculates uniform scale across different screen form factors', () => {
    it('handles tall screens (e.g. mobile 390x844)', () => {
      const viewport = { width: 390, height: 844 };
      const res = calculateMushafScale(viewport);

      const expectedScaleX = 390 / MUSHAF_PAGE_WIDTH;
      const expectedScaleY = 844 / MUSHAF_PAGE_HEIGHT;
      const expectedScale = Math.max(expectedScaleX, expectedScaleY);

      expect(res.scale).toBeCloseTo(expectedScale, 5);
      // For tall screens, height scale dominates so scaledHeight matches viewport height
      expect(res.scaledHeight).toBeCloseTo(844, 2);
      expect(res.scaledWidth).toBeGreaterThanOrEqual(viewport.width);
      expect(res.offsetY).toBeCloseTo(0, 2);
      expect(res.offsetX).toBeLessThan(0); // Symmetrical horizontal crop
    });

    it('handles wide screens (e.g. tablet landscape 1280x800)', () => {
      const viewport = { width: 1280, height: 800 };
      const res = calculateMushafScale(viewport);

      const expectedScaleX = 1280 / MUSHAF_PAGE_WIDTH;
      const expectedScaleY = 800 / MUSHAF_PAGE_HEIGHT;
      const expectedScale = Math.max(expectedScaleX, expectedScaleY);

      expect(res.scale).toBeCloseTo(expectedScale, 5);
      // For wide screens, width scale dominates so scaledWidth matches viewport width
      expect(res.scaledWidth).toBeCloseTo(1280, 2);
      expect(res.scaledHeight).toBeGreaterThanOrEqual(viewport.height);
      expect(res.offsetX).toBeCloseTo(0, 2);
      expect(res.offsetY).toBeLessThan(0); // Symmetrical vertical crop
    });

    it('handles square-ish screens (e.g. foldable/square 600x600)', () => {
      const viewport = { width: 600, height: 600 };
      const res = calculateMushafScale(viewport);

      const scaleX = 600 / MUSHAF_PAGE_WIDTH; // ~1.176
      const scaleY = 600 / MUSHAF_PAGE_HEIGHT; // ~0.822
      expect(scaleX).toBeGreaterThan(scaleY);
      expect(res.scale).toBeCloseTo(scaleX, 5);
      expect(res.scaledWidth).toBeCloseTo(600, 2);
      expect(res.scaledHeight).toBeGreaterThan(600);
      expect(res.offsetX).toBeCloseTo(0, 2);
      expect(res.offsetY).toBeLessThan(0);
    });
  });

  describe('preserves aspect ratio without distortion and fills the viewport completely', () => {
    const viewports = [
      { name: 'phone portrait', width: 360, height: 800 },
      { name: 'phone tall', width: 412, height: 915 },
      { name: 'tablet portrait', width: 800, height: 1280 },
      { name: 'tablet landscape', width: 1366, height: 768 },
      { name: 'square', width: 700, height: 700 },
    ];

    viewports.forEach(({ name, width, height }) => {
      it(`fills viewport and preserves aspect ratio on ${name} (${width}x${height})`, () => {
        const res = calculateMushafScale({ width, height });

        // Fills the viewport without letterboxing
        expect(res.scaledWidth).toBeGreaterThanOrEqual(width - 0.001);
        expect(res.scaledHeight).toBeGreaterThanOrEqual(height - 0.001);

        // Aspect ratio is strictly preserved (no distortion)
        const computedRatio = res.scaledWidth / res.scaledHeight;
        expect(computedRatio).toBeCloseTo(MUSHAF_PAGE_ASPECT_RATIO, 4);
      });
    });
  });

  describe('ensures symmetrical centering for even cropping', () => {
    it('verifies horizontal and vertical centering offsets are mathematically symmetrical', () => {
      const viewports = [
        { width: 375, height: 812 },
        { width: 1024, height: 768 },
        { width: 500, height: 500 },
      ];

      for (const vp of viewports) {
        const res = calculateMushafScale(vp);

        // Left crop equals right crop: left margin = res.offsetX, right edge = res.offsetX + res.scaledWidth
        // So distance from right edge to viewport width: vp.width - (res.offsetX + res.scaledWidth)
        const rightSpace = vp.width - (res.offsetX + res.scaledWidth);
        expect(rightSpace).toBeCloseTo(res.offsetX, 5);

        // Top crop equals bottom crop
        const bottomSpace = vp.height - (res.offsetY + res.scaledHeight);
        expect(bottomSpace).toBeCloseTo(res.offsetY, 5);
      }
    });
  });
});
