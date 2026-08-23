import { describe, expect, it } from 'vitest';
import { createBlock, createDoc, createSpan } from '../model/doc';
import {
  blockRanges,
  clampPoint,
  clampSelection,
  collapsedSelection,
  comparePoints,
  createPoint,
  createSelection,
  isCollapsed,
  isRangeEmpty,
  orderedRange,
  pointsEqual,
  selectionsEqual,
} from '../model/selection';

const doc = createDoc([
  { id: 'b1', type: 'paragraph', children: [createSpan('first block')] }, // 11 chars
  { id: 'b2', type: 'paragraph', children: [createSpan('second')] }, //      6 chars
  { id: 'b3', type: 'paragraph', children: [createSpan('third block')] }, // 11 chars
]);

describe('point comparison', () => {
  it('orders by block index then offset', () => {
    expect(comparePoints(doc, createPoint('b1', 5), createPoint('b2', 0))).toBe(-1);
    expect(comparePoints(doc, createPoint('b3', 0), createPoint('b1', 99))).toBe(1);
    expect(comparePoints(doc, createPoint('b2', 2), createPoint('b2', 4))).toBe(-1);
    expect(comparePoints(doc, createPoint('b2', 2), createPoint('b2', 2))).toBe(0);
  });

  it('compares points and selections structurally', () => {
    expect(pointsEqual(createPoint('b1', 2), createPoint('b1', 2))).toBe(true);
    expect(pointsEqual(createPoint('b1', 2), createPoint('b2', 2))).toBe(false);
    expect(
      selectionsEqual(
        createSelection(createPoint('b1', 0), createPoint('b1', 3)),
        createSelection(createPoint('b1', 0), createPoint('b1', 3)),
      ),
    ).toBe(true);
  });
});

describe('orderedRange', () => {
  it('normalizes a backwards selection into document order', () => {
    const backwards = createSelection(createPoint('b3', 4), createPoint('b1', 2));
    const { start, end } = orderedRange(doc, backwards);
    expect(start).toEqual(createPoint('b1', 2));
    expect(end).toEqual(createPoint('b3', 4));
  });

  it('leaves a forward selection alone', () => {
    const forwards = createSelection(createPoint('b1', 2), createPoint('b3', 4));
    expect(orderedRange(doc, forwards).start).toEqual(createPoint('b1', 2));
  });
});

describe('collapsed detection', () => {
  it('recognizes a collapsed selection', () => {
    expect(isCollapsed(collapsedSelection(createPoint('b1', 3)))).toBe(true);
    expect(
      isCollapsed(createSelection(createPoint('b1', 3), createPoint('b1', 4))),
    ).toBe(false);
  });
});

describe('blockRanges', () => {
  it('projects a single-block selection', () => {
    const ranges = blockRanges(doc, createSelection(createPoint('b2', 1), createPoint('b2', 4)));
    expect(ranges).toEqual([{ blockId: 'b2', start: 1, end: 4 }]);
  });

  it('projects a cross-block selection onto each block it touches', () => {
    const ranges = blockRanges(doc, createSelection(createPoint('b1', 6), createPoint('b3', 5)));
    expect(ranges).toEqual([
      { blockId: 'b1', start: 6, end: 11 },
      { blockId: 'b2', start: 0, end: 6 },
      { blockId: 'b3', start: 0, end: 5 },
    ]);
  });

  it('projects a backwards cross-block selection identically', () => {
    const forwards = blockRanges(doc, createSelection(createPoint('b1', 6), createPoint('b3', 5)));
    const backwards = blockRanges(doc, createSelection(createPoint('b3', 5), createPoint('b1', 6)));
    expect(backwards).toEqual(forwards);
  });

  it('reports an empty range for a collapsed selection', () => {
    expect(isRangeEmpty(blockRanges(doc, collapsedSelection(createPoint('b2', 3))))).toBe(true);
  });
});

describe('clamping', () => {
  it('pulls an out-of-range offset back to the block length', () => {
    expect(clampPoint(doc, createPoint('b2', 99))).toEqual(createPoint('b2', 6));
    expect(clampPoint(doc, createPoint('b2', -4))).toEqual(createPoint('b2', 0));
  });

  it('returns null for a block that no longer exists', () => {
    expect(clampPoint(doc, createPoint('gone', 0))).toBeNull();
    expect(
      clampSelection(doc, createSelection(createPoint('gone', 0), createPoint('b1', 0))),
    ).toBeNull();
  });

  it('preserves selection direction while clamping', () => {
    const clamped = clampSelection(
      doc,
      createSelection(createPoint('b3', 50), createPoint('b1', 0)),
    );
    expect(clamped?.anchor).toEqual(createPoint('b3', 11));
    expect(clamped?.focus).toEqual(createPoint('b1', 0));
  });
});

describe('empty block edge case', () => {
  it('treats an empty block as a zero-length range', () => {
    const withEmpty = createDoc([createBlock('', 'paragraph', 'e1')]);
    expect(blockRanges(withEmpty, collapsedSelection(createPoint('e1', 0)))).toEqual([
      { blockId: 'e1', start: 0, end: 0 },
    ]);
  });
});
