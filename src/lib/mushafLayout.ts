export const MUSHAF_PAGE_WIDTH = 510.236;
export const MUSHAF_PAGE_HEIGHT = 729.448;
export const MUSHAF_PAGE_ASPECT_RATIO = MUSHAF_PAGE_WIDTH / MUSHAF_PAGE_HEIGHT;

export interface Dimensions {
  width: number;
  height: number;
}

export interface MushafLayoutResult {
  scale: number;
  scaledWidth: number;
  scaledHeight: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Calculates uniform scale and symmetrical centering offsets to display the Mushaf page
 * edge-to-edge (cover) without aspect-ratio distortion:
 * scale = max(viewport.width / page.width, viewport.height / page.height)
 *
 * Excess dimensions extend symmetrically outside the viewport, allowing equal cropping.
 */
export function calculateMushafScale(
  viewport: Dimensions,
  page: Dimensions = { width: MUSHAF_PAGE_WIDTH, height: MUSHAF_PAGE_HEIGHT }
): MushafLayoutResult {
  const safeViewportWidth = Math.max(1, viewport.width);
  const safeViewportHeight = Math.max(1, viewport.height);
  const safePageWidth = Math.max(1, page.width);
  const safePageHeight = Math.max(1, page.height);

  const scaleX = safeViewportWidth / safePageWidth;
  const scaleY = safeViewportHeight / safePageHeight;
  const scale = Math.max(scaleX, scaleY);

  const scaledWidth = safePageWidth * scale;
  const scaledHeight = safePageHeight * scale;

  // Symmetrical centering offsets: negative value indicates excess cropped evenly on both sides
  const offsetX = (safeViewportWidth - scaledWidth) / 2;
  const offsetY = (safeViewportHeight - scaledHeight) / 2;

  return {
    scale,
    scaledWidth,
    scaledHeight,
    offsetX,
    offsetY,
  };
}
