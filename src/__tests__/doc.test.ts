import { beforeEach, describe, expect, it } from 'vitest';
import {
  DeserializeError,
  blockLength,
  blockText,
  createBlock,
  createDoc,
  createSpan,
  deserialize,
  mapSpanRange,
  markSetsEqual,
  normalizeChildren,
  resetIdCounter,
  serialize,
  sliceSpans,
  splitSpansAt,
} from '../model/doc';
import { sampleDoc } from '../model/editorState';

beforeEach(() => resetIdCounter(0));

describe('normalizeChildren', () => {
  it('merges adjacent spans with the same mark set', () => {
    const children = normalizeChildren([
      createSpan('Hel', [{ type: 'bold' }]),
      createSpan('lo', [{ type: 'bold' }]),
      createSpan(' there'),
    ]);
    expect(children).toHaveLength(2);
    expect(children[0]!.text).toBe('Hello');
    expect(children[1]!.text).toBe(' there');
  });

  it('treats mark order as insignificant when merging', () => {
    const children = normalizeChildren([
      createSpan('a', [{ type: 'bold' }, { type: 'italic' }]),
      createSpan('b', [{ type: 'italic' }, { type: 'bold' }]),
    ]);
    expect(children).toHaveLength(1);
    expect(children[0]!.text).toBe('ab');
  });

  it('does not merge links with different hrefs', () => {
    const children = normalizeChildren([
      createSpan('a', [{ type: 'link', href: 'https://one.test' }]),
      createSpan('b', [{ type: 'link', href: 'https://two.test' }]),
    ]);
    expect(children).toHaveLength(2);
  });

  it('drops empty spans but always leaves a placeholder', () => {
    const children = normalizeChildren([createSpan(''), createSpan('')]);
    expect(children).toHaveLength(1);
    expect(children[0]!.text).toBe('');
  });
});

const children = [
  createSpan('Hello '),
  createSpan('brave', [{ type: 'bold' }]),
  createSpan(' world'),
];

describe('span range helpers', () => {
  it('slices across span boundaries', () => {
    const sliced = sliceSpans(children, 3, 9);
    expect(sliced.map((span) => span.text).join('')).toBe('lo bra');
    expect(markSetsEqual(sliced[1]!.marks, [{ type: 'bold' }])).toBe(true);
  });

  it('splits without changing text', () => {
    const split = splitSpansAt(children, 3);
    expect(split.map((span) => span.text).join('')).toBe('Hello brave world');
    expect(split).toHaveLength(4);
  });

  it('maps only spans fully inside the range', () => {
    const mapped = normalizeChildren(
      mapSpanRange(children, 0, 5, (span) => createSpan(span.text, [{ type: 'italic' }])),
    );
    expect(mapped[0]!.text).toBe('Hello');
    expect(markSetsEqual(mapped[0]!.marks, [{ type: 'italic' }])).toBe(true);
    expect(mapped[1]!.text).toBe(' ');
    expect(mapped[1]!.marks).toHaveLength(0);
  });
});

describe('reads', () => {
  it('concatenates block text and length', () => {
    const block = { id: 'b1', type: 'paragraph' as const, children };
    expect(blockText(block)).toBe('Hello brave world');
    expect(blockLength(block)).toBe(17);
  });
});

describe('sample document', () => {
  it('has unique block ids', () => {
    // Regression: a hardcoded id in the sample collided with one the generator
    // later produced, so two blocks shared an id. Nothing downstream survives
    // that — block lookup, React keys and selection all key on it.
    const ids = sampleDoc().blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('survives a serialize round trip, which rejects duplicate ids', () => {
    const doc = sampleDoc();
    expect(deserialize(serialize(doc))).toEqual(doc);
  });
});

describe('serialization (R1)', () => {
  it('round-trips a document exactly', () => {
    const doc = createDoc([
      createBlock('Title', 'heading'),
      { id: 'b9', type: 'paragraph', children },
    ]);
    const restored = deserialize(serialize(doc));
    expect(restored).toEqual(doc);
  });

  it('round-trips through JSON text, not just object identity', () => {
    const doc = createDoc([{ id: 'b9', type: 'paragraph', children }]);
    expect(serialize(deserialize(serialize(doc)))).toBe(serialize(doc));
  });

  it('rejects unknown mark types', () => {
    const json = JSON.stringify({
      blocks: [{ id: 'b1', type: 'paragraph', children: [{ text: 'x', marks: [{ type: 'blink' }] }] }],
    });
    expect(() => deserialize(json)).toThrow(DeserializeError);
  });

  it('rejects links without an href', () => {
    const json = JSON.stringify({
      blocks: [{ id: 'b1', type: 'paragraph', children: [{ text: 'x', marks: [{ type: 'link' }] }] }],
    });
    expect(() => deserialize(json)).toThrow(DeserializeError);
  });

  it('rejects duplicate block ids', () => {
    const json = JSON.stringify({
      blocks: [
        { id: 'b1', type: 'paragraph', children: [{ text: 'a', marks: [] }] },
        { id: 'b1', type: 'paragraph', children: [{ text: 'b', marks: [] }] },
      ],
    });
    expect(() => deserialize(json)).toThrow(/Duplicate block id/);
  });

  it('normalizes on load so loaded docs are canonical', () => {
    const json = JSON.stringify({
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          children: [
            { text: 'a', marks: [{ type: 'bold' }] },
            { text: 'b', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    });
    expect(deserialize(json).blocks[0]!.children).toHaveLength(1);
  });
});
