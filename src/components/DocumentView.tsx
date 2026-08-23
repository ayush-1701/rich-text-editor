import { memo } from 'react';
import { BLOCK_ATTR, LEAF_ATTR } from '../dom/domSelection';
import { blockText } from '../model/doc';
import { getMark, hasMark } from '../model/marks';
import type { Block, Doc, InlineSpan } from '../model/types';

/**
 * The projection half of R2: model in, DOM out, no state, no event handlers.
 * Nothing here ever reads from the DOM, so the rendered output is a pure
 * function of the document.
 */

interface LeafProps {
  span: InlineSpan;
}

function Leaf({ span }: LeafProps) {
  const bold = hasMark(span.marks, 'bold');
  const italic = hasMark(span.marks, 'italic');
  const link = getMark(span.marks, 'link');

  const className = [bold && 'leaf-bold', italic && 'leaf-italic', link && 'leaf-link']
    .filter(Boolean)
    .join(' ');

  if (link && link.type === 'link') {
    return (
      <a
        {...{ [LEAF_ATTR]: '' }}
        className={className}
        href={link.href}
        title={link.href}
        // The surface is contenteditable; navigation happens via ctrl/cmd-click
        // in a real product, never on a plain click during editing.
        onClick={(event) => event.preventDefault()}
      >
        {span.text}
      </a>
    );
  }

  return (
    <span {...{ [LEAF_ATTR]: '' }} className={className || undefined}>
      {span.text}
    </span>
  );
}

interface BlockViewProps {
  block: Block;
  active: boolean;
}

function BlockView({ block, active }: BlockViewProps) {
  const isEmpty = blockText(block).length === 0;
  const Tag = block.type === 'heading' ? 'h2' : 'p';

  return (
    <Tag
      {...{ [BLOCK_ATTR]: block.id }}
      className={`block block-${block.type}`}
      data-active={active || undefined}
    >
      {isEmpty ? (
        // An empty block needs a rendered <br> to be focusable and to hold a
        // caret. It contributes zero characters to the offset walk.
        <span {...{ [LEAF_ATTR]: '' }}>
          <br />
        </span>
      ) : (
        block.children.map((span, index) => (
          <Leaf key={`${block.id}:${index}`} span={span} />
        ))
      )}
    </Tag>
  );
}

interface DocumentViewProps {
  doc: Doc;
  /**
   * Marks the block holding the caret. Only ever changes a class, never the
   * element structure, so it cannot disturb a live selection.
   */
  activeBlockId: string | null;
}

function DocumentViewImpl({ doc, activeBlockId }: DocumentViewProps) {
  return (
    <>
      {doc.blocks.map((block) => (
        <BlockView key={block.id} block={block} active={block.id === activeBlockId} />
      ))}
    </>
  );
}

export const DocumentView = memo(DocumentViewImpl);
