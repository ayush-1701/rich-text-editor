import { blockLength, cloneMarks, getBlock, markSetsEqual, marksEqual, sortMarks } from './doc';
import { blockRanges, isCollapsed, isRangeEmpty, orderedRange } from './selection';
import type { Block, Doc, InlineSpan, Mark, MarkType, Point, Selection } from './types';

export function hasMark(marks: readonly Mark[], type: MarkType): boolean {
  return marks.some((mark) => mark.type === type);
}

export function getMark(marks: readonly Mark[], type: MarkType): Mark | null {
  return marks.find((mark) => mark.type === type) ?? null;
}

/** Add a mark, replacing any existing mark of the same type (link href swap). */
export function withMark(marks: readonly Mark[], mark: Mark): Mark[] {
  return sortMarks([...marks.filter((m) => m.type !== mark.type), { ...mark }]);
}

export function withoutMark(marks: readonly Mark[], type: MarkType): Mark[] {
  return sortMarks(cloneMarks(marks.filter((mark) => mark.type !== type)));
}

/** The span covering character index `index`, or null if out of bounds. */
function spanAtIndex(block: Block, index: number): InlineSpan | null {
  if (index < 0) return null;
  let pos = 0;
  for (const span of block.children) {
    const end = pos + span.text.length;
    if (index >= pos && index < end) return span;
    pos = end;
  }
  return null;
}

/** Marks of the character immediately before `offset`, else the one after. */
export function marksAtOffset(block: Block, offset: number): Mark[] {
  const before = spanAtIndex(block, offset - 1);
  if (before) return cloneMarks(before.marks);
  const after = spanAtIndex(block, offset);
  return after ? cloneMarks(after.marks) : [];
}

/**
 * Marks a newly typed character should inherit at a collapsed caret.
 *
 * Bold/italic behave "stickily": typing at the right edge of bold text stays
 * bold. Links deliberately do not — typing at the tail of a link must not
 * silently grow the link, so the link mark is only inherited when the caret is
 * strictly *inside* a run of the same link.
 */
export function inheritedMarksAt(block: Block, offset: number): Mark[] {
  const base = marksAtOffset(block, offset);
  const link = getMark(base, 'link');
  if (!link) return base;

  const after = spanAtIndex(block, offset);
  const afterLink = after ? getMark(after.marks, 'link') : null;
  const inside = afterLink !== null && marksEqual(link, afterLink);
  return inside ? base : withoutMark(base, 'link');
}

/** Every (span, length) pair intersecting the selection, ignoring empty slices. */
function coveredSpans(doc: Doc, selection: Selection): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const range of blockRanges(doc, selection)) {
    if (range.end <= range.start) continue;
    const block = getBlock(doc, range.blockId);
    if (!block) continue;
    let pos = 0;
    for (const span of block.children) {
      const spanStart = pos;
      const spanEnd = pos + span.text.length;
      pos = spanEnd;
      const from = Math.max(range.start, spanStart);
      const to = Math.min(range.end, spanEnd);
      if (to > from) out.push(span);
    }
  }
  return out;
}

/** True only if *every* character in the range carries the mark (R4). */
export function rangeHasMarkEverywhere(
  doc: Doc,
  selection: Selection,
  type: MarkType,
): boolean {
  const spans = coveredSpans(doc, selection);
  if (spans.length === 0) return false;
  return spans.every((span) => hasMark(span.marks, type));
}

/** Intersection of the mark sets across the selection. */
function intersectMarks(spans: readonly InlineSpan[]): Mark[] {
  if (spans.length === 0) return [];
  let result = cloneMarks(spans[0]!.marks);
  for (const span of spans.slice(1)) {
    result = result.filter((mark) => span.marks.some((other) => marksEqual(mark, other)));
    if (result.length === 0) break;
  }
  return sortMarks(result);
}

/**
 * What the toolbar renders as "on" (R6).
 * Collapsed caret: pending marks if the user pre-toggled, else inherited marks.
 * Range: only marks shared by the whole range.
 */
export function activeMarks(
  doc: Doc,
  selection: Selection | null,
  pendingMarks: Mark[] | null = null,
): Mark[] {
  if (!selection) return [];

  const ranges = blockRanges(doc, selection);
  if (isCollapsed(selection) || isRangeEmpty(ranges)) {
    if (pendingMarks) return sortMarks(cloneMarks(pendingMarks));
    const { start } = orderedRange(doc, selection);
    const block = getBlock(doc, start.blockId);
    return block ? inheritedMarksAt(block, start.offset) : [];
  }

  return intersectMarks(coveredSpans(doc, selection));
}

export function markSetsAreEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  return markSetsEqual(a, b);
}

export interface LinkRange {
  blockId: string;
  start: number;
  end: number;
  href: string;
}

/**
 * The full extent of the link under a point, if any. Used so that clicking
 * inside a link and hitting "remove link" affects the whole link rather than a
 * zero-width slice of it.
 */
export function linkRangeAt(doc: Doc, point: Point): LinkRange | null {
  const block = getBlock(doc, point.blockId);
  if (!block) return null;

  const probe = spanAtIndex(block, point.offset) ?? spanAtIndex(block, point.offset - 1);
  const link = probe ? getMark(probe.marks, 'link') : null;
  if (!link || link.type !== 'link') return null;

  // Build span extents once, then expand across the contiguous run of spans
  // carrying the same href (a link can be split by an overlapping bold run).
  const extents: Array<{ start: number; end: number; matches: boolean }> = [];
  let pos = 0;
  for (const span of block.children) {
    const spanLink = getMark(span.marks, 'link');
    extents.push({
      start: pos,
      end: pos + span.text.length,
      matches: spanLink !== null && marksEqual(spanLink, link),
    });
    pos += span.text.length;
  }

  const seedIndex = extents.findIndex(
    (extent) =>
      extent.matches && point.offset >= extent.start && point.offset <= extent.end,
  );
  if (seedIndex < 0) return null;

  let first = seedIndex;
  let last = seedIndex;
  while (first > 0 && extents[first - 1]!.matches) first -= 1;
  while (last < extents.length - 1 && extents[last + 1]!.matches) last += 1;

  return {
    blockId: block.id,
    start: extents[first]!.start,
    end: Math.min(extents[last]!.end, blockLength(block)),
    href: link.href,
  };
}
