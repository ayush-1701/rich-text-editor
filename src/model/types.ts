/**
 * The document model. Everything in this folder is pure: no DOM, no React.
 *
 * Design note: inline formatting is stored as a *set of marks on a text span*,
 * not as nested nodes. A DOM-shaped tree (<b><i>x</i></b>) forces you to answer
 * "which nesting order is canonical?" on every edit. A flat list of spans with
 * mark sets has exactly one canonical form after normalization.
 */

export type MarkType = 'bold' | 'italic' | 'link';

export interface BoldMark {
  readonly type: 'bold';
}

export interface ItalicMark {
  readonly type: 'italic';
}

export interface LinkMark {
  readonly type: 'link';
  readonly href: string;
}

export type Mark = BoldMark | ItalicMark | LinkMark;

/** A run of text sharing an identical mark set. */
export interface InlineSpan {
  readonly text: string;
  readonly marks: Mark[];
}

export type BlockType = 'paragraph' | 'heading';

export interface Block {
  readonly id: string;
  readonly type: BlockType;
  readonly children: InlineSpan[];
}

export interface Doc {
  readonly blocks: Block[];
}

/**
 * A position in the document.
 *
 * `offset` is a character offset into the block's *concatenated* text, not an
 * index into `children`. Span indices are unstable (spans split and merge on
 * every mark change); character offsets survive normalization.
 */
export interface Point {
  readonly blockId: string;
  readonly offset: number;
}

/** Anchor/focus, in the user's drag order. Anchor may come after focus. */
export interface Selection {
  readonly anchor: Point;
  readonly focus: Point;
}

/** A selection projected onto a single block as a half-open [start, end) range. */
export interface BlockRange {
  readonly blockId: string;
  readonly start: number;
  readonly end: number;
}

/** The result shape every operation returns. */
export interface OpResult {
  readonly doc: Doc;
  readonly selection: Selection;
}
