import {
  blockIndex,
  blockLength,
  createBlock,
  createDoc,
  createId,
  createSpan,
  getBlock,
  mapSpanRange,
  normalizeChildren,
  sliceSpans,
} from './doc';
import { inheritedMarksAt, linkRangeAt, rangeHasMarkEverywhere, withMark, withoutMark } from './marks';
import {
  blockRanges,
  clampSelection,
  collapsedSelection,
  createPoint,
  createSelection,
  isCollapsed,
  isRangeEmpty,
  orderedRange,
} from './selection';
import type { Block, Doc, Mark, MarkType, OpResult, Point, Selection } from './types';

/* -------------------------------------------------------------------------- */
/* Deletion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Remove everything inside the selection. Cross-block deletes merge the tail of
 * the last touched block into the head of the first, which is the same code
 * path backspace-at-start-of-block uses.
 */
export function deleteRange(doc: Doc, selection: Selection): OpResult {
  const ranges = blockRanges(doc, selection);
  const { start, end } = orderedRange(doc, selection);

  // A zero-character range is only a no-op *within* a block. Across blocks the
  // boundary itself is the content being removed, which is what backspace at
  // offset 0 relies on.
  const withinOneBlock = start.blockId === end.blockId;
  if (ranges.length === 0 || (isRangeEmpty(ranges) && withinOneBlock)) {
    return { doc, selection: collapsedSelection(start) };
  }

  const startIndex = blockIndex(doc, start.blockId);
  const endIndex = blockIndex(doc, end.blockId);
  const first = doc.blocks[startIndex];
  const last = doc.blocks[endIndex];
  if (!first || !last) return { doc, selection };

  const head = sliceSpans(first.children, 0, start.offset);
  const tail = sliceSpans(last.children, end.offset, blockLength(last));
  const merged: Block = { ...first, children: normalizeChildren([...head, ...tail]) };

  const blocks = [
    ...doc.blocks.slice(0, startIndex),
    merged,
    ...doc.blocks.slice(endIndex + 1),
  ];

  return {
    doc: createDoc(blocks),
    selection: collapsedSelection(createPoint(merged.id, start.offset)),
  };
}

/** Backspace. Deletes a range, a character, or joins with the previous block. */
export function deleteBackward(doc: Doc, selection: Selection): OpResult {
  if (!isCollapsed(selection)) return deleteRange(doc, selection);

  const point = selection.focus;
  const index = blockIndex(doc, point.blockId);
  if (index < 0) return { doc, selection };

  if (point.offset > 0) {
    const range = createSelection(
      createPoint(point.blockId, point.offset - 1),
      createPoint(point.blockId, point.offset),
    );
    return deleteRange(doc, range);
  }

  const previous = doc.blocks[index - 1];
  if (!previous) return { doc, selection };

  const joinAt = blockLength(previous);
  const range = createSelection(
    createPoint(previous.id, joinAt),
    createPoint(point.blockId, 0),
  );
  return deleteRange(doc, range);
}

/** Delete / forward-delete. Mirrors `deleteBackward`. */
export function deleteForward(doc: Doc, selection: Selection): OpResult {
  if (!isCollapsed(selection)) return deleteRange(doc, selection);

  const point = selection.focus;
  const block = getBlock(doc, point.blockId);
  const index = blockIndex(doc, point.blockId);
  if (!block || index < 0) return { doc, selection };

  if (point.offset < blockLength(block)) {
    const range = createSelection(
      createPoint(point.blockId, point.offset),
      createPoint(point.blockId, point.offset + 1),
    );
    return deleteRange(doc, range);
  }

  const next = doc.blocks[index + 1];
  if (!next) return { doc, selection };

  const range = createSelection(
    createPoint(point.blockId, point.offset),
    createPoint(next.id, 0),
  );
  return deleteRange(doc, range);
}

/* -------------------------------------------------------------------------- */
/* Insertion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Insert text at the caret, replacing the selection first if there is one.
 * `marks` overrides mark inheritance — that is how pending marks (bold toggled
 * with a collapsed caret, then typing) reach the document.
 */
export function insertText(
  doc: Doc,
  selection: Selection,
  text: string,
  marks?: readonly Mark[],
): OpResult {
  if (text.length === 0) return { doc, selection };

  const collapsedResult = isCollapsed(selection)
    ? { doc, selection }
    : deleteRange(doc, selection);

  const point = collapsedResult.selection.focus;
  const block = getBlock(collapsedResult.doc, point.blockId);
  if (!block) return collapsedResult;

  const applied = marks ? [...marks] : inheritedMarksAt(block, point.offset);
  const length = blockLength(block);
  const children = normalizeChildren([
    ...sliceSpans(block.children, 0, point.offset),
    createSpan(text, applied),
    ...sliceSpans(block.children, point.offset, length),
  ]);

  const index = blockIndex(collapsedResult.doc, block.id);
  const blocks = [...collapsedResult.doc.blocks];
  blocks[index] = { ...block, children };

  return {
    doc: createDoc(blocks),
    selection: collapsedSelection(createPoint(block.id, point.offset + text.length)),
  };
}

/**
 * Enter. Splits the block at the caret. A split heading yields a paragraph —
 * continuing to type after a title should not produce a second title.
 */
export function splitBlock(doc: Doc, selection: Selection): OpResult {
  const collapsedResult = isCollapsed(selection)
    ? { doc, selection }
    : deleteRange(doc, selection);

  const point = collapsedResult.selection.focus;
  const block = getBlock(collapsedResult.doc, point.blockId);
  if (!block) return collapsedResult;

  const length = blockLength(block);
  const head: Block = {
    ...block,
    children: normalizeChildren(sliceSpans(block.children, 0, point.offset)),
  };
  const tail: Block = {
    id: createId(),
    type: block.type === 'heading' ? 'paragraph' : block.type,
    children: normalizeChildren(sliceSpans(block.children, point.offset, length)),
  };

  const index = blockIndex(collapsedResult.doc, block.id);
  const blocks = [
    ...collapsedResult.doc.blocks.slice(0, index),
    head,
    tail,
    ...collapsedResult.doc.blocks.slice(index + 1),
  ];

  return {
    doc: createDoc(blocks),
    selection: collapsedSelection(createPoint(tail.id, 0)),
  };
}

export function setBlockType(doc: Doc, selection: Selection, type: Block['type']): OpResult {
  let blocks = doc.blocks;
  for (const range of blockRanges(doc, selection)) {
    const index = blockIndex({ blocks }, range.blockId);
    const block = blocks[index];
    if (index < 0 || !block) continue;
    blocks = [...blocks.slice(0, index), { ...block, type }, ...blocks.slice(index + 1)];
  }
  return { doc: createDoc(blocks), selection };
}

/* -------------------------------------------------------------------------- */
/* Marks (R4)                                                                 */
/* -------------------------------------------------------------------------- */

/** Add or remove one mark across every block the selection touches. */
export function setMarkOnRange(
  doc: Doc,
  selection: Selection,
  mark: Mark,
  active: boolean,
): OpResult {
  let blocks = doc.blocks;

  for (const range of blockRanges(doc, selection)) {
    if (range.end <= range.start) continue;
    const index = blockIndex({ blocks }, range.blockId);
    const block = blocks[index];
    if (index < 0 || !block) continue;

    const children = normalizeChildren(
      mapSpanRange(block.children, range.start, range.end, (span) =>
        createSpan(
          span.text,
          active ? withMark(span.marks, mark) : withoutMark(span.marks, mark.type),
        ),
      ),
    );
    blocks = [...blocks.slice(0, index), { ...block, children }, ...blocks.slice(index + 1)];
  }

  return { doc: createDoc(blocks), selection };
}

/**
 * Toggle bold/italic over a range.
 *
 * Rule: the range is considered "on" only when *every* character carries the
 * mark. A partially bold range therefore becomes fully bold on the first press
 * and fully plain on the second. This is the behaviour every mainstream editor
 * ships, and it makes the toolbar's lit state a truthful predicate.
 */
export function toggleMark(
  doc: Doc,
  selection: Selection,
  type: Exclude<MarkType, 'link'>,
): OpResult {
  const active = rangeHasMarkEverywhere(doc, selection, type);
  return setMarkOnRange(doc, selection, { type }, !active);
}

/** Apply (or re-target) a link across the selection. */
export function setLink(doc: Doc, selection: Selection, href: string): OpResult {
  if (href.length === 0) return removeLink(doc, selection);
  const target = expandToLink(doc, selection);
  return setMarkOnRange(doc, target, { type: 'link', href }, true);
}

/** Remove a link. A collapsed caret inside a link removes the whole link. */
export function removeLink(doc: Doc, selection: Selection): OpResult {
  const target = expandToLink(doc, selection);
  return setMarkOnRange(doc, target, { type: 'link', href: '' }, false);
}

/** Grow a collapsed caret sitting inside a link to cover that whole link. */
export function expandToLink(doc: Doc, selection: Selection): Selection {
  if (!isCollapsed(selection)) return selection;
  const link = linkRangeAt(doc, selection.focus);
  if (!link) return selection;
  return createSelection(
    createPoint(link.blockId, link.start),
    createPoint(link.blockId, link.end),
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

/** Multi-line plain text paste: newlines become block splits. */
export function insertPlainText(
  doc: Doc,
  selection: Selection,
  text: string,
  marks?: readonly Mark[],
): OpResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let result: OpResult = isCollapsed(selection)
    ? { doc, selection }
    : deleteRange(doc, selection);

  lines.forEach((line, index) => {
    if (index > 0) result = splitBlock(result.doc, result.selection);
    if (line.length > 0) {
      result = insertText(result.doc, result.selection, line, index === 0 ? marks : undefined);
    }
  });

  return result;
}

export function selectAll(doc: Doc): Selection | null {
  const first = doc.blocks[0];
  const last = doc.blocks[doc.blocks.length - 1];
  if (!first || !last) return null;
  return createSelection(createPoint(first.id, 0), createPoint(last.id, blockLength(last)));
}

export function emptyDoc(): Doc {
  return createDoc([createBlock()]);
}

export function safeSelection(doc: Doc, selection: Selection | null): Selection | null {
  return clampSelection(doc, selection);
}

export type { Point };
