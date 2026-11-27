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

export interface PageMenuItem {
  id: 'surah' | 'page_display' | 'jump';
  title: string;
}

export const PAGE_MENU_ITEMS: readonly PageMenuItem[] = [
  { id: 'surah', title: 'السورة والجزء' },
  { id: 'page_display', title: 'الصفحة الحالية' },
  { id: 'jump', title: 'الانتقال إلى صفحة' },
] as const;

export interface AyahHighlightRect {
  topPercent: number;
  leftPercent: number;
  widthPercent: number;
  heightPercent: number;
  surahNumber: number;
  ayahNumberInSurah: number;
}

export interface AyahLayoutInput {
  number: number;
  numberInSurah: number;
  text?: string;
  surahNumber?: number;
}

export interface ComputeAyahHighlightParams {
  page: number;
  surahNumber: number;
  ayahNumberInSurah: number;
  globalAyahNumber?: number;
  ayahsOnPage?: AyahLayoutInput[] | null;
  pageStartSurah?: number;
  pageStartAyah?: number;
  nextPageStartSurah?: number;
  nextPageStartAyah?: number;
}

export function computeAyahHighlightRect(
  params: ComputeAyahHighlightParams
): AyahHighlightRect | null {
  const {
    page,
    surahNumber,
    ayahNumberInSurah,
    globalAyahNumber,
    ayahsOnPage,
    pageStartSurah,
    pageStartAyah,
    nextPageStartSurah,
    nextPageStartAyah,
  } = params;

  if (page < 1 || page > 604 || surahNumber < 1 || surahNumber > 114 || ayahNumberInSurah < 1) {
    return null;
  }

  // Madani Mushaf layout bounds
  const isOpeningSpread = page === 1 || page === 2;
  const contentTop = isOpeningSpread ? 26.0 : 9.2;
  const contentHeight = isOpeningSpread ? 47.0 : 82.2;
  const contentLeft = isOpeningSpread ? 16.5 : 7.5;
  const contentWidth = isOpeningSpread ? 67.0 : 85.0;
  const minLineHeight = isOpeningSpread ? 6.5 : 5.2;

  // Case 1: Accurate layout using current page ayahs text lengths and surah header banners
  if (ayahsOnPage && ayahsOnPage.length > 0) {
    const matchIndex = ayahsOnPage.findIndex((a) => {
      if (globalAyahNumber !== undefined && a.number === globalAyahNumber) {
        return true;
      }
      const sNum = a.surahNumber ?? surahNumber;
      return sNum === surahNumber && a.numberInSurah === ayahNumberInSurah;
    });

    if (matchIndex !== -1) {
      const weights: number[] = [];
      const headerWeights: number[] = [];

      for (let i = 0; i < ayahsOnPage.length; i++) {
        const a = ayahsOnPage[i];
        const sNum = a.surahNumber ?? surahNumber;
        // Decorative Surah title banner & Basmala occupy vertical space on the page
        const hasSurahHeader =
          !isOpeningSpread &&
          a.numberInSurah === 1 &&
          sNum !== 1 &&
          sNum !== 9;

        headerWeights.push(hasSurahHeader ? 90 : 0);
        weights.push(Math.max(20, (a.text || '').length));
      }

      let totalWeight = 0;
      for (let i = 0; i < ayahsOnPage.length; i++) {
        totalWeight += headerWeights[i] + weights[i];
      }
      if (totalWeight <= 0) totalWeight = 1;

      let cumulativeBefore = 0;
      for (let i = 0; i < matchIndex; i++) {
        cumulativeBefore += headerWeights[i] + weights[i];
      }
      cumulativeBefore += headerWeights[matchIndex];

      const matchWeight = weights[matchIndex];
      const startFrac = Math.max(0, Math.min(1, cumulativeBefore / totalWeight));
      const spanFrac = Math.max(0, Math.min(1, matchWeight / totalWeight));

      const rawTop = contentTop + startFrac * contentHeight;
      const rawHeight = spanFrac * contentHeight;
      const heightPercent = Math.max(minLineHeight, rawHeight);
      const maxTop = contentTop + contentHeight - heightPercent;
      const topPercent = Math.min(Math.max(contentTop, rawTop), Math.max(contentTop, maxTop));

      return {
        topPercent,
        leftPercent: contentLeft,
        widthPercent: contentWidth,
        heightPercent,
        surahNumber,
        ayahNumberInSurah,
      };
    }
    // If not found in ayahsOnPage (e.g. stale data from another page), fall through to Case 2!
  }

  // Case 2: Fast proportional estimation from page meta before ayahs are fetched
  if (pageStartSurah !== undefined && pageStartAyah !== undefined) {
    if (surahNumber < pageStartSurah) return null;
    if (nextPageStartSurah !== undefined && surahNumber > nextPageStartSurah) return null;
    if (surahNumber === pageStartSurah && ayahNumberInSurah < pageStartAyah) return null;
    if (
      nextPageStartSurah !== undefined &&
      nextPageStartAyah !== undefined &&
      surahNumber === nextPageStartSurah &&
      ayahNumberInSurah >= nextPageStartAyah
    ) {
      return null;
    }

    const isSingleSurahPage =
      nextPageStartSurah === undefined || nextPageStartSurah === pageStartSurah;
    const estimatedAyahsOnPage =
      isSingleSurahPage && nextPageStartAyah !== undefined
        ? Math.max(1, nextPageStartAyah - pageStartAyah)
        : 10;

    const offsetIndex = Math.max(0, ayahNumberInSurah - pageStartAyah);
    const startFrac = Math.min(0.9, offsetIndex / estimatedAyahsOnPage);
    const spanFrac = 1 / estimatedAyahsOnPage;

    const rawTop = contentTop + startFrac * contentHeight;
    const rawHeight = spanFrac * contentHeight;
    const heightPercent = Math.max(minLineHeight, rawHeight);
    const maxTop = contentTop + contentHeight - heightPercent;
    const topPercent = Math.min(Math.max(contentTop, rawTop), Math.max(contentTop, maxTop));

    return {
      topPercent,
      leftPercent: contentLeft,
      widthPercent: contentWidth,
      heightPercent,
      surahNumber,
      ayahNumberInSurah,
    };
  }

  return null;
}

