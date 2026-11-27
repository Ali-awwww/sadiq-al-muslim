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
 * Calculates uniform scale and symmetrical centering offsets to display the entire Mushaf page
 * inside the viewport (contain) without aspect-ratio distortion or any clipping:
 * scale = min(viewport.width / page.width, viewport.height / page.height)
 *
 * Ensures 100% of the page is visible, centered symmetrically on the screen.
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
  const scale = Math.min(scaleX, scaleY);

  const scaledWidth = safePageWidth * scale;
  const scaledHeight = safePageHeight * scale;

  // Symmetrical centering offsets (margins to center the page within the viewport)
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

export type SwipeAxis = 'x' | 'y' | null;

export function clampValue(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, val));
}

/**
 * Locks a pointer gesture cleanly onto either horizontal ('x') or vertical ('y')
 * once movement exceeds lockThreshold, and keeps that axis locked for the entire gesture.
 */
export function determineSwipeAxis(
  dx: number,
  dy: number,
  currentAxis: SwipeAxis,
  lockThreshold = 8
): SwipeAxis {
  if (currentAxis !== null) {
    return currentAxis;
  }
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < lockThreshold && absY < lockThreshold) {
    return null;
  }
  return absX >= absY ? 'x' : 'y';
}

export interface DragVisualOffsetParams {
  dx: number;
  dy: number;
  lockedAxis: SwipeAxis;
  startPanX: number;
  startPanY: number;
  maxPanX: number;
  maxPanY: number;
  currentPage: number;
  minPage?: number;
  maxPage?: number;
}

export interface DragVisualOffsetResult {
  translateX: number;
  translateY: number;
  swipeDeltaX: number;
  nextPanX: number;
  nextPanY: number;
}

/**
 * Computes direct DOM transform coordinates for finger-tracking without React re-renders.
 * - Vertical lock ('y') only pans vertically within zoomed bounds (no horizontal drift).
 * - Horizontal lock ('x') pans zoomed content up to edge, then translates horizontally for page flip.
 * - Applies gentle resistance at Mushaf boundaries (page 1 / page 604).
 */
export function computeDragVisualOffset(
  params: DragVisualOffsetParams
): DragVisualOffsetResult {
  const {
    dx,
    dy,
    lockedAxis,
    startPanX,
    startPanY,
    maxPanX,
    maxPanY,
    currentPage,
    minPage = 1,
    maxPage = 604,
  } = params;

  const isHorizontallyZoomed = maxPanX > 2;
  const isVerticallyZoomed = maxPanY > 2;

  if (lockedAxis === null) {
    return {
      translateX: startPanX,
      translateY: startPanY,
      swipeDeltaX: 0,
      nextPanX: startPanX,
      nextPanY: startPanY,
    };
  }

  if (lockedAxis === 'y') {
    const nextPanY = isVerticallyZoomed
      ? clampValue(startPanY + dy, -maxPanY, maxPanY)
      : startPanY;
    return {
      translateX: startPanX,
      translateY: nextPanY,
      swipeDeltaX: 0,
      nextPanX: startPanX,
      nextPanY,
    };
  }

  // Horizontal axis locked ('x')
  const applyBoundaryResistance = (deltaX: number): number => {
    const atMaxEdge = currentPage >= maxPage && deltaX > 0;
    const atMinEdge = currentPage <= minPage && deltaX < 0;
    return atMaxEdge || atMinEdge ? deltaX * 0.35 : deltaX;
  };

  if (!isHorizontallyZoomed) {
    const swipeDeltaX = applyBoundaryResistance(dx);
    return {
      translateX: swipeDeltaX,
      translateY: startPanY,
      swipeDeltaX,
      nextPanX: 0,
      nextPanY: startPanY,
    };
  }

  const rawPanX = startPanX + dx;
  const nextPanX = clampValue(rawPanX, -maxPanX, maxPanX);
  const overscrollX = applyBoundaryResistance(rawPanX - nextPanX);

  return {
    translateX: nextPanX + overscrollX,
    translateY: startPanY,
    swipeDeltaX: overscrollX,
    nextPanX,
    nextPanY: startPanY,
  };
}

export interface SwipeReleaseParams {
  swipeDeltaX: number;
  dt: number;
  lockedAxis: SwipeAxis;
  viewportWidth: number;
  currentPage: number;
  minPage?: number;
  maxPage?: number;
  distanceRatio?: number;
  minDistancePx?: number;
  velocityThreshold?: number;
}

export interface SwipeReleaseResult {
  targetPage: number | null;
  direction: 'next' | 'prev' | 'cancel';
  exitOffsetX: number;
  enterOffsetX: number;
}

/**
 * Evaluates whether a released horizontal swipe crosses distance or velocity thresholds
 * to settle onto the next/previous page (Arabic RTL book: swipe right = next, left = prev).
 */
export function evaluateSwipeRelease(
  params: SwipeReleaseParams
): SwipeReleaseResult {
  const {
    swipeDeltaX,
    dt,
    lockedAxis,
    viewportWidth,
    currentPage,
    minPage = 1,
    maxPage = 604,
    distanceRatio = 0.16,
    minDistancePx = 44,
    velocityThreshold = 0.28,
  } = params;

  if (lockedAxis !== 'x' || swipeDeltaX === 0) {
    return {
      targetPage: null,
      direction: 'cancel',
      exitOffsetX: 0,
      enterOffsetX: 0,
    };
  }

  const absDx = Math.abs(swipeDeltaX);
  const safeWidth = Math.max(200, viewportWidth);
  const distanceThreshold = Math.max(minDistancePx, safeWidth * distanceRatio);
  const isFlick =
    dt > 0 && dt < 280 && absDx >= 28 && absDx / dt >= velocityThreshold;

  if (absDx < distanceThreshold && !isFlick) {
    return {
      targetPage: null,
      direction: 'cancel',
      exitOffsetX: 0,
      enterOffsetX: 0,
    };
  }

  const exitDistance = Math.max(160, Math.round(safeWidth * 0.45));
  const enterDistance = Math.max(36, Math.round(safeWidth * 0.14));

  // Arabic RTL book: swipe right (dx > 0) = next page; swipe left (dx < 0) = previous page
  if (swipeDeltaX > 0 && currentPage < maxPage) {
    return {
      targetPage: currentPage + 1,
      direction: 'next',
      exitOffsetX: exitDistance,
      enterOffsetX: -enterDistance,
    };
  }

  if (swipeDeltaX < 0 && currentPage > minPage) {
    return {
      targetPage: currentPage - 1,
      direction: 'prev',
      exitOffsetX: -exitDistance,
      enterOffsetX: enterDistance,
    };
  }

  return {
    targetPage: null,
    direction: 'cancel',
    exitOffsetX: 0,
    enterOffsetX: 0,
  };
}
