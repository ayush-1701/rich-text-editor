import type {
  Block,
  BlockType,
  Doc,
  InlineSpan,
  Mark,
  MarkType,
} from './types';

/* -------------------------------------------------------------------------- */
/* Ids                                                                        */
/* -------------------------------------------------------------------------- */

let idCounter = 0;

export function createId(prefix = 'b'): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

/** Test hook: makes generated ids deterministic. */
export function resetIdCounter(value = 0): void {
  idCounter = value;
}

/* -------------------------------------------------------------------------- */
/* Marks                                                                      */
/* -------------------------------------------------------------------------- */

const MARK_ORDER: Record<MarkType, number> = { bold: 0, italic: 1, link: 2 };

export function cloneMarks(marks: readonly Mark[]): Mark[] {
  return marks.map((mark) => ({ ...mark }));
}

/** Canonical ordering so that two equal mark sets are also structurally equal. */
export function sortMarks(marks: readonly Mark[]): Mark[] {
  return [...marks].sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type]);
}

export function marksEqual(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'link' && b.type === 'link') return a.href === b.href;
  return true;
}

export function markSetsEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark) => b.some((other) => marksEqual(mark, other)));
}

/* -------------------------------------------------------------------------- */
/* Constructors                                                               */
/* -------------------------------------------------------------------------- */

export function createSpan(text: string, marks: readonly Mark[] = []): InlineSpan {
  return { text, marks: sortMarks(cloneMarks(marks)) };
}

export function createBlock(
  text = '',
  type: BlockType = 'paragraph',
  id: string = createId(),
): Block {
  return { id, type, children: normalizeChildren([createSpan(text)]) };
}

export function createDoc(blocks?: Block[]): Doc {
  return { blocks: blocks && blocks.length > 0 ? blocks : [createBlock()] };
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Canonical form for a block's children:
 *   - no empty spans, except a single placeholder in an empty block
 *   - no two adjacent spans with the same mark set
 *
 * Every operation ends with a normalize pass, which is what keeps structural
 * equality meaningful and keeps the rendered DOM stable across edits.
 */
export function normalizeChildren(children: readonly InlineSpan[]): InlineSpan[] {
  const out: InlineSpan[] = [];

  for (const raw of children) {
    if (raw.text.length === 0) continue;
    const span = createSpan(raw.text, raw.marks);
    const prev = out[out.length - 1];
    if (prev && markSetsEqual(prev.marks, span.marks)) {
      out[out.length - 1] = createSpan(prev.text + span.text, prev.marks);
    } else {
      out.push(span);
    }
  }

  if (out.length === 0) out.push(createSpan(''));
  return out;
}

export function normalizeBlock(block: Block): Block {
  return { ...block, children: normalizeChildren(block.children) };
}

export function normalizeDoc(doc: Doc): Doc {
  const blocks = doc.blocks.map(normalizeBlock);
  return { blocks: blocks.length > 0 ? blocks : [createBlock()] };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export function blockText(block: Block): string {
  return block.children.map((span) => span.text).join('');
}

export function blockLength(block: Block): number {
  return block.children.reduce((total, span) => total + span.text.length, 0);
}

export function blockIndex(doc: Doc, blockId: string): number {
  return doc.blocks.findIndex((block) => block.id === blockId);
}

export function getBlock(doc: Doc, blockId: string): Block | null {
  return doc.blocks.find((block) => block.id === blockId) ?? null;
}

export function docText(doc: Doc): string {
  return doc.blocks.map(blockText).join('\n');
}

export function replaceBlock(doc: Doc, blockId: string, next: Block): Doc {
  const index = blockIndex(doc, blockId);
  if (index < 0) return doc;
  const blocks = [...doc.blocks];
  blocks[index] = next;
  return { blocks };
}

/* -------------------------------------------------------------------------- */
/* Span range helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Extract [start, end) of a child list as a new, normalized child list. */
export function sliceSpans(
  children: readonly InlineSpan[],
  start: number,
  end: number,
): InlineSpan[] {
  const out: InlineSpan[] = [];
  let pos = 0;

  for (const span of children) {
    const spanStart = pos;
    const spanEnd = pos + span.text.length;
    pos = spanEnd;

    const from = Math.max(start, spanStart);
    const to = Math.min(end, spanEnd);
    if (to > from) {
      out.push(createSpan(span.text.slice(from - spanStart, to - spanStart), span.marks));
    }
  }

  return out;
}

/** Introduce a span boundary at `offset` without changing the text. */
export function splitSpansAt(
  children: readonly InlineSpan[],
  offset: number,
): InlineSpan[] {
  const out: InlineSpan[] = [];
  let pos = 0;

  for (const span of children) {
    const spanStart = pos;
    const spanEnd = pos + span.text.length;
    pos = spanEnd;

    if (offset > spanStart && offset < spanEnd) {
      const cut = offset - spanStart;
      out.push(createSpan(span.text.slice(0, cut), span.marks));
      out.push(createSpan(span.text.slice(cut), span.marks));
    } else {
      out.push(createSpan(span.text, span.marks));
    }
  }

  return out;
}

/** Apply `fn` to every span fully inside [start, end), splitting at the edges. */
export function mapSpanRange(
  children: readonly InlineSpan[],
  start: number,
  end: number,
  fn: (span: InlineSpan) => InlineSpan,
): InlineSpan[] {
  const split = splitSpansAt(splitSpansAt(children, start), end);
  let pos = 0;

  return split.map((span) => {
    const spanStart = pos;
    const spanEnd = pos + span.text.length;
    pos = spanEnd;
    const inside = spanStart >= start && spanEnd <= end && span.text.length > 0;
    return inside ? fn(span) : span;
  });
}

/* -------------------------------------------------------------------------- */
/* Serialization (R1)                                                         */
/* -------------------------------------------------------------------------- */

export function serialize(doc: Doc): string {
  return JSON.stringify(doc, null, 2);
}

export class DeserializeError extends Error {}

function parseMark(value: unknown): Mark {
  if (typeof value !== 'object' || value === null) {
    throw new DeserializeError('Mark must be an object');
  }
  const type = (value as { type?: unknown }).type;
  if (type === 'bold' || type === 'italic') return { type };
  if (type === 'link') {
    const href = (value as { href?: unknown }).href;
    if (typeof href !== 'string') throw new DeserializeError('Link mark needs an href');
    return { type: 'link', href };
  }
  throw new DeserializeError(`Unknown mark type: ${String(type)}`);
}

function parseSpan(value: unknown): InlineSpan {
  if (typeof value !== 'object' || value === null) {
    throw new DeserializeError('Span must be an object');
  }
  const { text, marks } = value as { text?: unknown; marks?: unknown };
  if (typeof text !== 'string') throw new DeserializeError('Span needs text');
  if (marks !== undefined && !Array.isArray(marks)) {
    throw new DeserializeError('Span marks must be an array');
  }
  return createSpan(text, (marks ?? []).map(parseMark));
}

function parseBlock(value: unknown): Block {
  if (typeof value !== 'object' || value === null) {
    throw new DeserializeError('Block must be an object');
  }
  const { id, type, children } = value as {
    id?: unknown;
    type?: unknown;
    children?: unknown;
  };
  if (typeof id !== 'string' || id.length === 0) {
    throw new DeserializeError('Block needs an id');
  }
  if (type !== 'paragraph' && type !== 'heading') {
    throw new DeserializeError(`Unknown block type: ${String(type)}`);
  }
  if (!Array.isArray(children)) throw new DeserializeError('Block needs children');
  return { id, type, children: normalizeChildren(children.map(parseSpan)) };
}

/** Round-trips with `serialize`. Throws `DeserializeError` on malformed input. */
export function deserialize(json: string): Doc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DeserializeError('Not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new DeserializeError('Document must be an object');
  }
  const blocks = (parsed as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) throw new DeserializeError('Document needs a blocks array');

  const parsedBlocks = blocks.map(parseBlock);
  const seen = new Set<string>();
  for (const block of parsedBlocks) {
    if (seen.has(block.id)) throw new DeserializeError(`Duplicate block id: ${block.id}`);
    seen.add(block.id);
    // Keep the id counter ahead of anything we load, so new ids never collide.
    const numeric = Number(block.id.replace(/^\D+/, ''));
    if (Number.isFinite(numeric) && numeric > idCounter) idCounter = numeric;
  }

  return createDoc(parsedBlocks);
}
