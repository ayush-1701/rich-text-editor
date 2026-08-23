import { blockIndex, blockLength, getBlock } from './doc';
import type { BlockRange, Doc, Point, Selection } from './types';

export function createPoint(blockId: string, offset: number): Point {
  return { blockId, offset };
}

export function collapsedSelection(point: Point): Selection {
  return { anchor: point, focus: point };
}

export function createSelection(anchor: Point, focus: Point): Selection {
  return { anchor, focus };
}

export function pointsEqual(a: Point | null, b: Point | null): boolean {
  if (a === null || b === null) return a === b;
  return a.blockId === b.blockId && a.offset === b.offset;
}

export function selectionsEqual(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return pointsEqual(a.anchor, b.anchor) && pointsEqual(a.focus, b.focus);
}

export function isCollapsed(selection: Selection): boolean {
  return pointsEqual(selection.anchor, selection.focus);
}

/** -1 if a precedes b, 1 if a follows b, 0 if equal. Unknown blocks sort last. */
export function comparePoints(doc: Doc, a: Point, b: Point): -1 | 0 | 1 {
  if (a.blockId === b.blockId) {
    if (a.offset === b.offset) return 0;
    return a.offset < b.offset ? -1 : 1;
  }
  const indexA = blockIndex(doc, a.blockId);
  const indexB = blockIndex(doc, b.blockId);
  if (indexA === indexB) return 0;
  return indexA < indexB ? -1 : 1;
}

/** Normalize anchor/focus into document order. */
export function orderedRange(doc: Doc, selection: Selection): { start: Point; end: Point } {
  const direction = comparePoints(doc, selection.anchor, selection.focus);
  return direction <= 0
    ? { start: selection.anchor, end: selection.focus }
    : { start: selection.focus, end: selection.anchor };
}

/** Clamp a point into the document, or null if its block no longer exists. */
export function clampPoint(doc: Doc, point: Point): Point | null {
  const block = getBlock(doc, point.blockId);
  if (!block) return null;
  const max = blockLength(block);
  const offset = Math.min(Math.max(point.offset, 0), max);
  return offset === point.offset ? point : createPoint(point.blockId, offset);
}

export function clampSelection(doc: Doc, selection: Selection | null): Selection | null {
  if (!selection) return null;
  const anchor = clampPoint(doc, selection.anchor);
  const focus = clampPoint(doc, selection.focus);
  if (!anchor || !focus) return null;
  return { anchor, focus };
}

/**
 * Project a (possibly cross-block) selection onto each block it touches as a
 * half-open [start, end) character range. Every range-based operation —
 * delete, mark toggle, mark inspection — is written against this, so none of
 * them need their own cross-block logic.
 */
export function blockRanges(doc: Doc, selection: Selection): BlockRange[] {
  const { start, end } = orderedRange(doc, selection);
  const startIndex = blockIndex(doc, start.blockId);
  const endIndex = blockIndex(doc, end.blockId);
  if (startIndex < 0 || endIndex < 0) return [];

  const ranges: BlockRange[] = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    const block = doc.blocks[i];
    if (!block) continue;
    const length = blockLength(block);
    ranges.push({
      blockId: block.id,
      start: i === startIndex ? Math.min(start.offset, length) : 0,
      end: i === endIndex ? Math.min(end.offset, length) : length,
    });
  }
  return ranges;
}

/** True when the selection covers no characters at all. */
export function isRangeEmpty(ranges: readonly BlockRange[]): boolean {
  return ranges.every((range) => range.end <= range.start);
}
