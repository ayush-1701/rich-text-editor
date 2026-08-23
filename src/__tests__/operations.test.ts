import { beforeEach, describe, expect, it } from 'vitest';
import {
  blockText,
  createBlock,
  createDoc,
  createSpan,
  docText,
  getBlock,
  markSetsEqual,
  resetIdCounter,
} from '../model/doc';
import { hasMark, rangeHasMarkEverywhere } from '../model/marks';
import {
  deleteBackward,
  deleteForward,
  deleteRange,
  expandToLink,
  insertPlainText,
  insertText,
  removeLink,
  setLink,
  splitBlock,
  toggleMark,
} from '../model/operations';
import { collapsedSelection, createPoint, createSelection } from '../model/selection';
import type { Doc } from '../model/types';

const HREF = 'https://example.test';

beforeEach(() => resetIdCounter(100));

function threeBlocks(): Doc {
  return createDoc([
    { id: 'b1', type: 'paragraph', children: [createSpan('first block')] },
    { id: 'b2', type: 'paragraph', children: [createSpan('second')] },
    { id: 'b3', type: 'paragraph', children: [createSpan('third block')] },
  ]);
}

function marked(): Doc {
  return createDoc([
    {
      id: 'm1',
      type: 'paragraph',
      children: [
        createSpan('Hello '),
        createSpan('brave', [{ type: 'bold' }]),
        createSpan(' world'),
      ],
    },
  ]);
}

describe('insertText', () => {
  it('inserts at the caret and moves the caret past the text', () => {
    const doc = threeBlocks();
    const result = insertText(doc, collapsedSelection(createPoint('b2', 6)), ' wind');
    expect(blockText(getBlock(result.doc, 'b2')!)).toBe('second wind');
    expect(result.selection.focus).toEqual(createPoint('b2', 11));
  });

  it('replaces the selection when the selection is a range', () => {
    const doc = threeBlocks();
    const selection = createSelection(createPoint('b1', 0), createPoint('b1', 5));
    const result = insertText(doc, selection, 'last');
    expect(blockText(getBlock(result.doc, 'b1')!)).toBe('last block');
  });

  it('replaces a cross-block selection', () => {
    const doc = threeBlocks();
    const selection = createSelection(createPoint('b1', 6), createPoint('b3', 6));
    const result = insertText(doc, selection, '-X-');
    expect(docText(result.doc)).toBe('first -X-block');
  });

  it('inherits marks from the character before the caret', () => {
    const result = insertText(marked(), collapsedSelection(createPoint('m1', 11)), 'r');
    const block = getBlock(result.doc, 'm1')!;
    expect(blockText(block)).toBe('Hello braver world');
    expect(
      rangeHasMarkEverywhere(
        result.doc,
        createSelection(createPoint('m1', 6), createPoint('m1', 12)),
        'bold',
      ),
    ).toBe(true);
  });

  it('honours explicitly supplied marks over inheritance', () => {
    const result = insertText(marked(), collapsedSelection(createPoint('m1', 0)), 'X', [
      { type: 'italic' },
    ]);
    const block = getBlock(result.doc, 'm1')!;
    expect(markSetsEqual(block.children[0]!.marks, [{ type: 'italic' }])).toBe(true);
  });

  it('normalizes so identical neighbours merge into one span', () => {
    const result = insertText(threeBlocks(), collapsedSelection(createPoint('b2', 3)), 'XYZ');
    expect(getBlock(result.doc, 'b2')!.children).toHaveLength(1);
  });

  it('is a no-op for empty text', () => {
    const doc = threeBlocks();
    expect(insertText(doc, collapsedSelection(createPoint('b1', 0)), '').doc).toBe(doc);
  });
});

describe('deleteRange', () => {
  it('deletes inside a single block', () => {
    const selection = createSelection(createPoint('b1', 5), createPoint('b1', 11));
    const result = deleteRange(threeBlocks(), selection);
    expect(blockText(getBlock(result.doc, 'b1')!)).toBe('first');
    expect(result.selection.focus).toEqual(createPoint('b1', 5));
  });

  it('merges the tail of the last block into the first across blocks', () => {
    const selection = createSelection(createPoint('b1', 6), createPoint('b3', 6));
    const result = deleteRange(threeBlocks(), selection);
    expect(result.doc.blocks).toHaveLength(1);
    expect(docText(result.doc)).toBe('first block');
    expect(result.selection.focus).toEqual(createPoint('b1', 6));
  });

  it('works identically on a backwards selection', () => {
    const forwards = deleteRange(
      threeBlocks(),
      createSelection(createPoint('b1', 6), createPoint('b3', 6)),
    );
    const backwards = deleteRange(
      threeBlocks(),
      createSelection(createPoint('b3', 6), createPoint('b1', 6)),
    );
    expect(docText(backwards.doc)).toBe(docText(forwards.doc));
  });

  it('leaves one empty block when everything is deleted', () => {
    const selection = createSelection(createPoint('b1', 0), createPoint('b3', 11));
    const result = deleteRange(threeBlocks(), selection);
    expect(result.doc.blocks).toHaveLength(1);
    expect(docText(result.doc)).toBe('');
  });
});

describe('deleteBackward', () => {
  it('removes the character before the caret', () => {
    const result = deleteBackward(threeBlocks(), collapsedSelection(createPoint('b2', 6)));
    expect(blockText(getBlock(result.doc, 'b2')!)).toBe('secon');
    expect(result.selection.focus).toEqual(createPoint('b2', 5));
  });

  it('joins with the previous block at offset zero', () => {
    const result = deleteBackward(threeBlocks(), collapsedSelection(createPoint('b2', 0)));
    expect(result.doc.blocks).toHaveLength(2);
    expect(blockText(result.doc.blocks[0]!)).toBe('first blocksecond');
    expect(result.selection.focus).toEqual(createPoint('b1', 11));
  });

  it('is a no-op at the very start of the document', () => {
    const doc = threeBlocks();
    const result = deleteBackward(doc, collapsedSelection(createPoint('b1', 0)));
    expect(result.doc).toBe(doc);
  });

  it('deletes the selection when there is one', () => {
    const selection = createSelection(createPoint('b1', 0), createPoint('b1', 6));
    const result = deleteBackward(threeBlocks(), selection);
    expect(blockText(getBlock(result.doc, 'b1')!)).toBe('block');
  });
});

describe('deleteForward', () => {
  it('removes the character after the caret', () => {
    const result = deleteForward(threeBlocks(), collapsedSelection(createPoint('b2', 0)));
    expect(blockText(getBlock(result.doc, 'b2')!)).toBe('econd');
  });

  it('pulls up the next block at the end of a block', () => {
    const result = deleteForward(threeBlocks(), collapsedSelection(createPoint('b2', 6)));
    expect(result.doc.blocks).toHaveLength(2);
    expect(blockText(result.doc.blocks[1]!)).toBe('secondthird block');
  });
});

describe('splitBlock', () => {
  it('splits at the caret and puts the caret in the new block', () => {
    const result = splitBlock(threeBlocks(), collapsedSelection(createPoint('b1', 5)));
    expect(result.doc.blocks).toHaveLength(4);
    expect(blockText(result.doc.blocks[0]!)).toBe('first');
    expect(blockText(result.doc.blocks[1]!)).toBe(' block');
    expect(result.selection.focus.blockId).toBe(result.doc.blocks[1]!.id);
    expect(result.selection.focus.offset).toBe(0);
  });

  it('preserves marks on both sides of the split', () => {
    const result = splitBlock(marked(), collapsedSelection(createPoint('m1', 9)));
    expect(hasMark(result.doc.blocks[0]!.children.at(-1)!.marks, 'bold')).toBe(true);
    expect(hasMark(result.doc.blocks[1]!.children[0]!.marks, 'bold')).toBe(true);
  });

  it('demotes a split heading to a paragraph', () => {
    const doc = createDoc([createBlock('Title here', 'heading', 'h1')]);
    const result = splitBlock(doc, collapsedSelection(createPoint('h1', 5)));
    expect(result.doc.blocks[0]!.type).toBe('heading');
    expect(result.doc.blocks[1]!.type).toBe('paragraph');
  });

  it('deletes the selection before splitting', () => {
    const selection = createSelection(createPoint('b1', 5), createPoint('b2', 6));
    const result = splitBlock(threeBlocks(), selection);
    expect(blockText(result.doc.blocks[0]!)).toBe('first');
    expect(blockText(result.doc.blocks[1]!)).toBe('');
  });
});

describe('toggleMark (R4)', () => {
  it('makes a partially bold range fully bold', () => {
    const selection = createSelection(createPoint('m1', 0), createPoint('m1', 11));
    const result = toggleMark(marked(), selection, 'bold');
    expect(rangeHasMarkEverywhere(result.doc, selection, 'bold')).toBe(true);
  });

  it('clears a fully bold range on the second press', () => {
    const selection = createSelection(createPoint('m1', 0), createPoint('m1', 11));
    const once = toggleMark(marked(), selection, 'bold');
    const twice = toggleMark(once.doc, selection, 'bold');
    expect(hasMark(twice.doc.blocks[0]!.children[0]!.marks, 'bold')).toBe(false);
    expect(twice.doc.blocks[0]!.children).toHaveLength(1);
  });

  it('leaves the selection untouched', () => {
    const selection = createSelection(createPoint('m1', 0), createPoint('m1', 11));
    expect(toggleMark(marked(), selection, 'bold').selection).toEqual(selection);
  });

  it('applies across blocks', () => {
    const selection = createSelection(createPoint('b1', 6), createPoint('b3', 5));
    const result = toggleMark(threeBlocks(), selection, 'italic');
    expect(rangeHasMarkEverywhere(result.doc, selection, 'italic')).toBe(true);
    expect(
      hasMark(
        result.doc.blocks[0]!.children[0]!.marks, // "first " stayed outside the range
        'italic',
      ),
    ).toBe(false);
  });

  it('is an exact inverse round trip on a uniform range', () => {
    const doc = threeBlocks();
    const selection = createSelection(createPoint('b2', 0), createPoint('b2', 6));
    const round = toggleMark(toggleMark(doc, selection, 'bold').doc, selection, 'bold');
    expect(round.doc).toEqual(doc);
  });
});

describe('links', () => {
  it('applies a link across the selection', () => {
    const selection = createSelection(createPoint('b2', 0), createPoint('b2', 6));
    const result = setLink(threeBlocks(), selection, HREF);
    expect(result.doc.blocks[1]!.children[0]!.marks).toEqual([{ type: 'link', href: HREF }]);
  });

  it('retargets an existing link rather than nesting one', () => {
    const selection = createSelection(createPoint('b2', 0), createPoint('b2', 6));
    const once = setLink(threeBlocks(), selection, HREF);
    const twice = setLink(once.doc, selection, 'https://other.test');
    expect(twice.doc.blocks[1]!.children[0]!.marks).toHaveLength(1);
    expect(twice.doc.blocks[1]!.children[0]!.marks[0]).toEqual({
      type: 'link',
      href: 'https://other.test',
    });
  });

  it('expands a collapsed caret to the whole link', () => {
    const selection = createSelection(createPoint('b2', 0), createPoint('b2', 6));
    const linked = setLink(threeBlocks(), selection, HREF);
    const expanded = expandToLink(linked.doc, collapsedSelection(createPoint('b2', 3)));
    expect(expanded).toEqual(selection);
  });

  it('removes the whole link from a caret inside it', () => {
    const selection = createSelection(createPoint('b2', 0), createPoint('b2', 6));
    const linked = setLink(threeBlocks(), selection, HREF);
    const unlinked = removeLink(linked.doc, collapsedSelection(createPoint('b2', 3)));
    expect(hasMark(unlinked.doc.blocks[1]!.children[0]!.marks, 'link')).toBe(false);
  });

  it('keeps bold when a link is removed', () => {
    const selection = createSelection(createPoint('m1', 6), createPoint('m1', 11));
    const linked = setLink(marked(), selection, HREF);
    const unlinked = removeLink(linked.doc, selection);
    expect(rangeHasMarkEverywhere(unlinked.doc, selection, 'bold')).toBe(true);
  });
});

describe('insertPlainText', () => {
  it('turns newlines into block splits', () => {
    const result = insertPlainText(
      threeBlocks(),
      collapsedSelection(createPoint('b2', 6)),
      '\nalpha\nbeta',
    );
    expect(result.doc.blocks).toHaveLength(5);
    expect(docText(result.doc)).toBe('first block\nsecond\nalpha\nbeta\nthird block');
  });

  it('normalizes CRLF', () => {
    const result = insertPlainText(
      threeBlocks(),
      collapsedSelection(createPoint('b2', 6)),
      '\r\nx',
    );
    expect(result.doc.blocks).toHaveLength(4);
  });
});
