import { createPoint, createSelection } from '../model/selection';
import type { Point, Selection } from '../model/types';

/**
 * The DOM <-> model position bridge (R3).
 *
 * This is the only file in the codebase that knows the DOM exists. The contract
 * with the renderer is two attributes:
 *   - every block element carries `data-block-id`
 *   - every inline element carries `data-leaf`
 *
 * A model point is `{ blockId, characterOffset }`, so mapping in either
 * direction is a walk over the block's text nodes accumulating lengths. Because
 * offsets are character-based rather than span-index based, they stay valid
 * even after normalization merges or splits the spans around them.
 */

export const BLOCK_ATTR = 'data-block-id';
export const LEAF_ATTR = 'data-leaf';

function closestBlock(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (element.hasAttribute(BLOCK_ATTR)) return element;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Scan for the block rather than building a selector from the id. Block ids are
 * data, and interpolating data into a selector needs escaping that is not
 * uniformly available; comparing the attribute directly needs none.
 */
function findBlockElement(root: HTMLElement, blockId: string): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}]`);
  for (const candidate of Array.from(candidates)) {
    if (candidate.getAttribute(BLOCK_ATTR) === blockId) return candidate;
  }
  return null;
}

function textNodesIn(block: HTMLElement): Text[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

/** Total text length of a subtree — used when a container is an element. */
function textLengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  let total = 0;
  node.childNodes.forEach((child) => {
    total += textLengthOf(child);
  });
  return total;
}

/** (DOM container, offset) -> model point. */
export function domPointToModel(root: HTMLElement, node: Node, offset: number): Point | null {
  const block = closestBlock(node);
  if (!block || !root.contains(block)) return null;

  const blockId = block.getAttribute(BLOCK_ATTR);
  if (!blockId) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    let accumulated = 0;
    for (const text of textNodesIn(block)) {
      if (text === node) return createPoint(blockId, accumulated + offset);
      accumulated += text.data.length;
    }
    return createPoint(blockId, accumulated);
  }

  // Element container: the browser gives a child index, so sum the text length
  // of the children before it. Happens on empty blocks and triple-click.
  let accumulated = 0;
  const children = Array.from(node.childNodes);
  for (let i = 0; i < Math.min(offset, children.length); i += 1) {
    accumulated += textLengthOf(children[i]!);
  }

  if (node !== block) {
    // Container is a leaf; add the text preceding that leaf within the block.
    let before = 0;
    for (const text of textNodesIn(block)) {
      if (node.contains(text)) break;
      before += text.data.length;
    }
    accumulated += before;
  }

  return createPoint(blockId, accumulated);
}

/** Model point -> (DOM container, offset). */
export function modelPointToDom(
  root: HTMLElement,
  point: Point,
): { node: Node; offset: number } | null {
  const block = findBlockElement(root, point.blockId);
  if (!block) return null;

  const texts = textNodesIn(block);
  if (texts.length === 0) {
    // Empty block: only a <br> placeholder exists.
    return { node: block, offset: 0 };
  }

  let accumulated = 0;
  for (const text of texts) {
    const end = accumulated + text.data.length;
    if (point.offset <= end) {
      return { node: text, offset: Math.max(0, point.offset - accumulated) };
    }
    accumulated = end;
  }

  const last = texts[texts.length - 1]!;
  return { node: last, offset: last.data.length };
}

/** Read the live browser selection as a model selection, if it is inside `root`. */
export function readSelection(root: HTMLElement): Selection | null {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return null;

  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
  if (!anchorNode || !focusNode) return null;
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return null;

  const anchor = domPointToModel(root, anchorNode, anchorOffset);
  const focus = domPointToModel(root, focusNode, focusOffset);
  if (!anchor || !focus) return null;

  return createSelection(anchor, focus);
}

/** Project a model selection back onto the browser. */
export function writeSelection(root: HTMLElement, selection: Selection): boolean {
  const anchor = modelPointToDom(root, selection.anchor);
  const focus = modelPointToDom(root, selection.focus);
  if (!anchor || !focus) return false;

  const domSelection = window.getSelection();
  if (!domSelection) return false;

  try {
    // setBaseAndExtent preserves selection direction, which matters for
    // shift+arrow extension after a re-render.
    domSelection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return true;
  } catch {
    return false;
  }
}
