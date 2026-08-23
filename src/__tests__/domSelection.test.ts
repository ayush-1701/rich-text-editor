/**
 * @vitest-environment jsdom
 *
 * These are still logic tests, not DOM snapshots: they assert that the position
 * arithmetic in the bridge is correct, using a hand-written DOM that matches the
 * renderer's contract (`data-block-id` on blocks, `data-leaf` on inline nodes).
 * Nothing here asserts on markup the renderer produces.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { domPointToModel, modelPointToDom, readSelection, writeSelection } from '../dom/domSelection';
import { createPoint, createSelection } from '../model/selection';

function build(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById('root') as HTMLElement;
}

const ONE_BLOCK = `<p data-block-id="b1"><span data-leaf="">Hello </span><span data-leaf="">brave</span><span data-leaf=""> world</span></p>`;

const TWO_BLOCKS = `<p data-block-id="b1"><span data-leaf="">one</span></p><p data-block-id="b2"><span data-leaf="">two</span></p>`;

const EMPTY_BLOCK = `<p data-block-id="e1"><span data-leaf=""><br></span></p>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('domPointToModel', () => {
  it('accumulates the length of preceding leaves', () => {
    const root = build(ONE_BLOCK);
    const secondLeaf = root.querySelectorAll('[data-leaf]')[1]!.firstChild!;
    expect(domPointToModel(root, secondLeaf, 3)).toEqual(createPoint('b1', 9));
  });

  it('resolves an element container by summing preceding children', () => {
    const root = build(ONE_BLOCK);
    const block = root.firstElementChild!;
    expect(domPointToModel(root, block, 2)).toEqual(createPoint('b1', 11));
  });

  it('reports offset zero inside an empty block', () => {
    const root = build(EMPTY_BLOCK);
    const leaf = root.querySelector('[data-leaf]')!;
    expect(domPointToModel(root, leaf, 0)).toEqual(createPoint('e1', 0));
  });

  it('returns null for a node outside any block', () => {
    const root = build(ONE_BLOCK);
    const stray = document.createTextNode('elsewhere');
    document.body.appendChild(stray);
    expect(domPointToModel(root, stray, 0)).toBeNull();
  });
});

describe('modelPointToDom', () => {
  it('lands inside the leaf containing the offset', () => {
    const root = build(ONE_BLOCK);
    const dom = modelPointToDom(root, createPoint('b1', 9))!;
    expect((dom.node as Text).data).toBe('brave');
    expect(dom.offset).toBe(3);
  });

  it('falls back to the block element for an empty block', () => {
    const root = build(EMPTY_BLOCK);
    const dom = modelPointToDom(root, createPoint('e1', 0))!;
    expect((dom.node as HTMLElement).getAttribute('data-block-id')).toBe('e1');
  });

  it('clamps an offset past the end of the block', () => {
    const root = build(ONE_BLOCK);
    const dom = modelPointToDom(root, createPoint('b1', 999))!;
    expect(dom.offset).toBe((dom.node as Text).data.length);
  });

  it('returns null for an unknown block id', () => {
    const root = build(ONE_BLOCK);
    expect(modelPointToDom(root, createPoint('nope', 0))).toBeNull();
  });
});

describe('round trip (R3)', () => {
  it('preserves every offset in a multi-leaf block', () => {
    const root = build(ONE_BLOCK);
    for (let offset = 0; offset <= 17; offset += 1) {
      const dom = modelPointToDom(root, createPoint('b1', offset))!;
      expect(domPointToModel(root, dom.node, dom.offset)).toEqual(createPoint('b1', offset));
    }
  });

  it('preserves offsets in the second of two blocks', () => {
    const root = build(TWO_BLOCKS);
    for (let offset = 0; offset <= 3; offset += 1) {
      const dom = modelPointToDom(root, createPoint('b2', offset))!;
      expect(domPointToModel(root, dom.node, dom.offset)).toEqual(createPoint('b2', offset));
    }
  });

  it('preserves the caret in an empty block', () => {
    const root = build(EMPTY_BLOCK);
    const dom = modelPointToDom(root, createPoint('e1', 0))!;
    expect(domPointToModel(root, dom.node, dom.offset)).toEqual(createPoint('e1', 0));
  });
});

describe('browser selection', () => {
  it('writes a model selection onto the document', () => {
    const root = build(ONE_BLOCK);
    const written = writeSelection(
      root,
      createSelection(createPoint('b1', 2), createPoint('b1', 8)),
    );
    expect(written).toBe(true);
    expect(window.getSelection()!.toString()).toBe('llo br');
  });

  it('reads it back as the same model selection', () => {
    const root = build(ONE_BLOCK);
    const selection = createSelection(createPoint('b1', 2), createPoint('b1', 8));
    writeSelection(root, selection);
    expect(readSelection(root)).toEqual(selection);
  });

  it('round-trips a cross-block selection', () => {
    const root = build(TWO_BLOCKS);
    const selection = createSelection(createPoint('b1', 1), createPoint('b2', 2));
    writeSelection(root, selection);
    expect(readSelection(root)).toEqual(selection);
  });

  it('preserves selection direction', () => {
    const root = build(ONE_BLOCK);
    const backwards = createSelection(createPoint('b1', 8), createPoint('b1', 2));
    writeSelection(root, backwards);
    expect(readSelection(root)).toEqual(backwards);
  });

  it('ignores a selection outside the editor', () => {
    const root = build(ONE_BLOCK);
    const outside = document.createElement('p');
    outside.textContent = 'not the editor';
    document.body.appendChild(outside);

    const range = document.createRange();
    range.selectNodeContents(outside);
    const domSelection = window.getSelection()!;
    domSelection.removeAllRanges();
    domSelection.addRange(range);

    expect(readSelection(root)).toBeNull();
  });
});
