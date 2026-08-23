import { beforeEach, describe, expect, it } from 'vitest';
import { createBlock, createDoc, createSpan, resetIdCounter, serialize } from '../model/doc';
import { sampleDoc } from '../model/editorState';
import {
  rangeForBlock,
  serializeWithBlockRanges,
  tokenizeJsonLine,
} from '../model/serializeView';

beforeEach(() => resetIdCounter(300));

describe('serializeWithBlockRanges', () => {
  it('produces byte-identical output to the canonical serializer', () => {
    const doc = sampleDoc();
    expect(serializeWithBlockRanges(doc).json).toBe(serialize(doc));
  });

  it('stays identical for a single empty block', () => {
    const doc = createDoc([createBlock('', 'paragraph', 'only')]);
    expect(serializeWithBlockRanges(doc).json).toBe(serialize(doc));
  });

  it('stays identical for marked content', () => {
    const doc = createDoc([
      {
        id: 'x1',
        type: 'paragraph',
        children: [
          createSpan('plain '),
          createSpan('bold', [{ type: 'bold' }]),
          createSpan(' and a '),
          createSpan('link', [{ type: 'link', href: 'https://example.test' }]),
        ],
      },
      createBlock('second', 'paragraph', 'x2'),
    ]);
    expect(serializeWithBlockRanges(doc).json).toBe(serialize(doc));
  });

  it('reports a line range per block that contains that block id', () => {
    const doc = createDoc([
      createBlock('one', 'paragraph', 'a1'),
      createBlock('two', 'paragraph', 'a2'),
    ]);
    const { lines, ranges } = serializeWithBlockRanges(doc);
    expect(ranges).toHaveLength(2);

    for (const range of ranges) {
      const slice = lines.slice(range.start, range.end + 1).join('\n');
      expect(slice).toContain(`"id": "${range.blockId}"`);
      expect(slice).not.toContain(
        `"id": "${range.blockId === 'a1' ? 'a2' : 'a1'}"`,
      );
    }
  });

  it('gives non-overlapping ranges in document order', () => {
    const { ranges } = serializeWithBlockRanges(sampleDoc());
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i]!.start).toBeGreaterThan(ranges[i - 1]!.end);
    }
  });

  it('looks a range up by block id', () => {
    const { ranges } = serializeWithBlockRanges(
      createDoc([createBlock('one', 'paragraph', 'a1')]),
    );
    expect(rangeForBlock(ranges, 'a1')?.blockId).toBe('a1');
    expect(rangeForBlock(ranges, 'missing')).toBeNull();
    expect(rangeForBlock(ranges, null)).toBeNull();
  });
});

describe('tokenizeJsonLine', () => {
  it('round-trips the line exactly', () => {
    const line = '      "text": "Hello \\"there\\", friend",';
    expect(tokenizeJsonLine(line).map((token) => token.text).join('')).toBe(line);
  });

  it('separates keys from string values', () => {
    const tokens = tokenizeJsonLine('  "type": "paragraph"');
    expect(tokens.find((token) => token.text === '"type"')?.kind).toBe('key');
    expect(tokens.find((token) => token.text === '"paragraph"')?.kind).toBe('string');
  });

  it('marks numbers and booleans as literals', () => {
    expect(tokenizeJsonLine('  "n": 42').at(-1)?.kind).toBe('literal');
    expect(tokenizeJsonLine('  "b": true').at(-1)?.kind).toBe('literal');
  });

  it('does not mistake a colon inside a string for a key separator', () => {
    const tokens = tokenizeJsonLine('  "href": "https://example.test"');
    expect(tokens.find((token) => token.text === '"https://example.test"')?.kind).toBe(
      'string',
    );
  });

  it('handles an empty line', () => {
    expect(tokenizeJsonLine('')).toEqual([]);
  });
});
