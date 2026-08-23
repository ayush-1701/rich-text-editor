import { describe, expect, it } from 'vitest';
import { createDoc, createSpan, markSetsEqual } from '../model/doc';
import {
  activeMarks,
  hasMark,
  inheritedMarksAt,
  linkRangeAt,
  marksAtOffset,
  rangeHasMarkEverywhere,
  withMark,
  withoutMark,
} from '../model/marks';
import { collapsedSelection, createPoint, createSelection } from '../model/selection';
import type { Block, Doc } from '../model/types';

const HREF = 'https://example.test';

// "Hello brave world" with "brave" bold, and a trailing " link" that is linked.
const block: Block = {
  id: 'b1',
  type: 'paragraph',
  children: [
    createSpan('Hello '), //            0..6
    createSpan('brave', [{ type: 'bold' }]), // 6..11
    createSpan(' world '), //           11..18
    createSpan('link', [{ type: 'link', href: HREF }]), // 18..22
    createSpan('!'), //                 22..23
  ],
};

const doc: Doc = createDoc([block]);

describe('mark set helpers', () => {
  it('replaces a mark of the same type rather than duplicating it', () => {
    const marks = withMark([{ type: 'link', href: 'https://old.test' }], {
      type: 'link',
      href: HREF,
    });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toEqual({ type: 'link', href: HREF });
  });

  it('removes by type', () => {
    const marks = withoutMark([{ type: 'bold' }, { type: 'italic' }], 'bold');
    expect(markSetsEqual(marks, [{ type: 'italic' }])).toBe(true);
  });
});

describe('marksAtOffset', () => {
  it('takes the marks of the character before the caret', () => {
    expect(hasMark(marksAtOffset(block, 11), 'bold')).toBe(true); // right edge of "brave"
    expect(hasMark(marksAtOffset(block, 6), 'bold')).toBe(false); // left edge of "brave"
  });

  it('falls back to the following character at the start of a block', () => {
    expect(marksAtOffset(block, 0)).toHaveLength(0);
  });
});

describe('inheritedMarksAt (typing behaviour)', () => {
  it('keeps bold sticky at the trailing edge of a bold run', () => {
    expect(hasMark(inheritedMarksAt(block, 11), 'bold')).toBe(true);
  });

  it('does not extend a link when typing at its trailing edge', () => {
    expect(hasMark(marksAtOffset(block, 22), 'link')).toBe(true);
    expect(hasMark(inheritedMarksAt(block, 22), 'link')).toBe(false);
  });

  it('keeps the link when typing strictly inside it', () => {
    expect(hasMark(inheritedMarksAt(block, 20), 'link')).toBe(true);
  });
});

describe('rangeHasMarkEverywhere (R4 predicate)', () => {
  it('is true when the whole range carries the mark', () => {
    const selection = createSelection(createPoint('b1', 6), createPoint('b1', 11));
    expect(rangeHasMarkEverywhere(doc, selection, 'bold')).toBe(true);
  });

  it('is false when the range is only partially marked', () => {
    const selection = createSelection(createPoint('b1', 0), createPoint('b1', 11));
    expect(rangeHasMarkEverywhere(doc, selection, 'bold')).toBe(false);
  });

  it('is false for an empty range', () => {
    expect(rangeHasMarkEverywhere(doc, collapsedSelection(createPoint('b1', 8)), 'bold')).toBe(
      false,
    );
  });

  it('ignores selection direction', () => {
    const backwards = createSelection(createPoint('b1', 11), createPoint('b1', 6));
    expect(rangeHasMarkEverywhere(doc, backwards, 'bold')).toBe(true);
  });
});

describe('activeMarks (toolbar state, R6)', () => {
  it('returns only marks shared by the entire range', () => {
    const partial = createSelection(createPoint('b1', 0), createPoint('b1', 11));
    expect(hasMark(activeMarks(doc, partial), 'bold')).toBe(false);

    const full = createSelection(createPoint('b1', 7), createPoint('b1', 10));
    expect(hasMark(activeMarks(doc, full), 'bold')).toBe(true);
  });

  it('uses inherited marks at a collapsed caret', () => {
    expect(hasMark(activeMarks(doc, collapsedSelection(createPoint('b1', 9))), 'bold')).toBe(true);
  });

  it('prefers staged marks over inherited marks', () => {
    const marks = activeMarks(doc, collapsedSelection(createPoint('b1', 9)), [
      { type: 'italic' },
    ]);
    expect(markSetsEqual(marks, [{ type: 'italic' }])).toBe(true);
  });

  it('returns nothing without a selection', () => {
    expect(activeMarks(doc, null)).toHaveLength(0);
  });
});

describe('linkRangeAt', () => {
  it('finds the full extent of the link under a caret', () => {
    expect(linkRangeAt(doc, createPoint('b1', 20))).toEqual({
      blockId: 'b1',
      start: 18,
      end: 22,
      href: HREF,
    });
  });

  it('returns null outside a link', () => {
    expect(linkRangeAt(doc, createPoint('b1', 3))).toBeNull();
  });

  it('spans a link that is split by an overlapping bold run', () => {
    const split = createDoc([
      {
        id: 'x1',
        type: 'paragraph',
        children: [
          createSpan('go ', []),
          createSpan('he', [{ type: 'link', href: HREF }]),
          createSpan('re', [{ type: 'link', href: HREF }, { type: 'bold' }]),
          createSpan(' now'),
        ],
      },
    ]);
    expect(linkRangeAt(split, createPoint('x1', 4))).toEqual({
      blockId: 'x1',
      start: 3,
      end: 7,
      href: HREF,
    });
  });
});
