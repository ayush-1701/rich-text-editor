import { serialize } from './doc';
import type { Doc } from './types';

/**
 * The inspector needs to know which lines of the serialized document belong to
 * which block, so it can highlight the block the caret is currently in.
 *
 * Rather than parsing the output of `serialize` back into line ranges — which
 * would silently drift the moment the model gains a field — the JSON is
 * assembled here from per-block fragments, recording line numbers as it goes.
 * `serializeWithBlockRanges(doc).json === serialize(doc)` is asserted by a test,
 * so the pretty view can never disagree with the canonical serialization.
 */

export interface BlockLineRange {
  readonly blockId: string;
  /** Zero-based, inclusive. */
  readonly start: number;
  readonly end: number;
}

export interface AnnotatedJson {
  readonly json: string;
  readonly lines: string[];
  readonly ranges: BlockLineRange[];
}

const INDENT = '    '; // array elements sit two levels deep in a 2-space document

export function serializeWithBlockRanges(doc: Doc): AnnotatedJson {
  if (doc.blocks.length === 0) {
    const json = serialize(doc);
    return { json, lines: json.split('\n'), ranges: [] };
  }

  const lines: string[] = ['{', '  "blocks": ['];
  const ranges: BlockLineRange[] = [];

  doc.blocks.forEach((block, index) => {
    const start = lines.length;
    const body = JSON.stringify(block, null, 2)
      .split('\n')
      .map((line) => INDENT + line);

    const last = body.length - 1;
    if (index < doc.blocks.length - 1) body[last] = `${body[last]},`;

    lines.push(...body);
    ranges.push({ blockId: block.id, start, end: lines.length - 1 });
  });

  lines.push('  ]', '}');
  return { json: lines.join('\n'), lines, ranges };
}

export function rangeForBlock(
  ranges: readonly BlockLineRange[],
  blockId: string | null,
): BlockLineRange | null {
  if (!blockId) return null;
  return ranges.find((range) => range.blockId === blockId) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Minimal JSON tokenizer for display                                         */
/* -------------------------------------------------------------------------- */

export type TokenKind = 'key' | 'string' | 'literal' | 'punctuation';

export interface Token {
  readonly text: string;
  readonly kind: TokenKind;
}

const PATTERN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;

/** Split a line into coloured tokens. Returns plain text as `punctuation`. */
export function tokenizeJsonLine(line: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  for (const match of line.matchAll(PATTERN)) {
    const at = match.index ?? 0;
    if (at > cursor) tokens.push({ text: line.slice(cursor, at), kind: 'punctuation' });

    const [whole, quoted, colon] = match;
    if (quoted !== undefined) {
      tokens.push({ text: quoted, kind: colon ? 'key' : 'string' });
      if (colon) tokens.push({ text: colon, kind: 'punctuation' });
    } else {
      tokens.push({ text: whole, kind: 'literal' });
    }
    cursor = at + whole.length;
  }

  if (cursor < line.length) tokens.push({ text: line.slice(cursor), kind: 'punctuation' });
  return tokens;
}
