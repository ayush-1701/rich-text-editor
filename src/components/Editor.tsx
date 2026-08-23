import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject } from 'react';
import { domPointToModel, readSelection, writeSelection } from '../dom/domSelection';
import { blockLength } from '../model/doc';
import {
  canRedo,
  canUndo,
  selectionSummary,
  type EditorAction,
  type EditorState,
} from '../model/editorState';
import { activeMarks, getMark, linkRangeAt } from '../model/marks';
import { createSelection, isCollapsed, selectionsEqual } from '../model/selection';
import type { Selection } from '../model/types';
import { DocumentView } from './DocumentView';
import { LinkPopover } from './LinkPopover';
import { Toolbar } from './Toolbar';

interface EditorProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Owned by the app shell so other panels can hand focus back to the writer. */
  surfaceRef: RefObject<HTMLDivElement | null>;
  activeBlockId: string | null;
}

/** Map an InputEvent's intended target range onto the model. */
function targetSelection(root: HTMLElement, event: InputEvent): Selection | null {
  const ranges = typeof event.getTargetRanges === 'function' ? event.getTargetRanges() : [];
  const range = ranges[0];
  if (!range) return null;
  const anchor = domPointToModel(root, range.startContainer, range.startOffset);
  const focus = domPointToModel(root, range.endContainer, range.endOffset);
  if (!anchor || !focus) return null;
  return createSelection(anchor, focus);
}

export function Editor({ state, dispatch, surfaceRef, activeBlockId }: EditorProps) {
  const rootRef = surfaceRef;
  const applyingSelection = useRef(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const marks = useMemo(
    () => activeMarks(state.doc, state.selection, state.pendingMarks),
    [state.doc, state.selection, state.pendingMarks],
  );

  /** Pull the live DOM selection into the model before acting on it. */
  const syncSelection = useCallback((): void => {
    const root = rootRef.current;
    if (!root) return;
    const selection = readSelection(root);
    if (selection) dispatch({ type: 'select', selection });
  }, [dispatch]);

  const focusEditor = useCallback(() => {
    rootRef.current?.focus();
  }, []);

  /* ---------------------------------------------------------------------- */
  /* DOM -> model: every input is intercepted, never applied by the browser  */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onBeforeInput = (event: InputEvent) => {
      // Nothing the browser wants to do to the DOM is allowed through. Every
      // mutation must round-trip via the model (R2).
      event.preventDefault();

      const target = targetSelection(root, event);
      if (target) {
        dispatch({ type: 'select', selection: target });
      } else {
        syncSelection();
      }

      switch (event.inputType) {
        case 'insertText':
        case 'insertReplacementText': {
          if (event.data) dispatch({ type: 'insert-text', text: event.data });
          return;
        }
        case 'insertParagraph':
        case 'insertLineBreak': {
          dispatch({ type: 'split-block' });
          return;
        }
        case 'deleteContentBackward':
        case 'deleteWordBackward':
        case 'deleteSoftLineBackward':
        case 'deleteHardLineBackward': {
          if (target && !isCollapsed(target)) dispatch({ type: 'delete-range' });
          else dispatch({ type: 'delete-backward' });
          return;
        }
        case 'deleteContentForward':
        case 'deleteWordForward':
        case 'deleteSoftLineForward':
        case 'deleteHardLineForward': {
          if (target && !isCollapsed(target)) dispatch({ type: 'delete-range' });
          else dispatch({ type: 'delete-forward' });
          return;
        }
        case 'deleteContent': {
          dispatch({ type: 'delete-range' });
          return;
        }
        case 'historyUndo': {
          dispatch({ type: 'undo' });
          return;
        }
        case 'historyRedo': {
          dispatch({ type: 'redo' });
          return;
        }
        case 'formatBold': {
          dispatch({ type: 'toggle-mark', mark: 'bold' });
          return;
        }
        case 'formatItalic': {
          dispatch({ type: 'toggle-mark', mark: 'italic' });
          return;
        }
        default:
          // Unhandled input types (rich paste, composition, drag-drop) are
          // dropped rather than half-applied. See ARCHITECTURE.md.
          return;
      }
    };

    root.addEventListener('beforeinput', onBeforeInput as EventListener);
    return () => root.removeEventListener('beforeinput', onBeforeInput as EventListener);
  }, [dispatch, syncSelection]);

  /* ---------------------------------------------------------------------- */
  /* Selection: DOM -> model                                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const onSelectionChange = () => {
      // Ignore the echo of our own programmatic selection write.
      if (applyingSelection.current) return;
      const root = rootRef.current;
      if (!root) return;
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;
      if (!domSelection.anchorNode || !root.contains(domSelection.anchorNode)) return;

      const selection = readSelection(root);
      if (selection) dispatch({ type: 'select', selection });
    };

    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [dispatch]);

  /* ---------------------------------------------------------------------- */
  /* Selection: model -> DOM                                                */
  /* ---------------------------------------------------------------------- */

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !state.selection) return;

    // Only drive the browser selection while the editor owns focus, so the
    // link input can hold the caret without a fight.
    const active = document.activeElement;
    if (active !== root && !root.contains(active)) return;

    const current = readSelection(root);
    if (current && selectionsEqual(current, state.selection)) return;

    applyingSelection.current = true;
    writeSelection(root, state.selection);
    // selectionchange is queued as a task, so release the guard after it lands.
    window.setTimeout(() => {
      applyingSelection.current = false;
    }, 0);
  });

  /* ---------------------------------------------------------------------- */
  /* Keyboard and clipboard                                                 */
  /* ---------------------------------------------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();

    if (key === 'b') {
      event.preventDefault();
      dispatch({ type: 'toggle-mark', mark: 'bold' });
    } else if (key === 'i') {
      event.preventDefault();
      dispatch({ type: 'toggle-mark', mark: 'italic' });
    } else if (key === 'k') {
      event.preventDefault();
      openLink();
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      dispatch({ type: 'undo' });
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      dispatch({ type: 'redo' });
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    syncSelection();
    dispatch({ type: 'insert-plain-text', text });
  };

  const onCopyOrCut = (event: React.ClipboardEvent<HTMLDivElement>) => {
    // Plain text only; the model owns the rich representation.
    const selection = window.getSelection();
    if (!selection) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', selection.toString());
    if (event.type === 'cut') {
      syncSelection();
      dispatch({ type: 'delete-range' });
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Link flow                                                              */
  /* ---------------------------------------------------------------------- */

  const existingHref = useMemo(() => {
    if (!state.selection) return '';
    if (isCollapsed(state.selection)) {
      return linkRangeAt(state.doc, state.selection.focus)?.href ?? '';
    }
    const link = getMark(marks, 'link');
    return link && link.type === 'link' ? link.href : '';
  }, [state.doc, state.selection, marks]);

  const linkTargetExists = useMemo(() => {
    if (!state.selection) return false;
    if (!isCollapsed(state.selection)) return true;
    return linkRangeAt(state.doc, state.selection.focus) !== null;
  }, [state.doc, state.selection]);

  function openLink() {
    if (!linkTargetExists) return;
    setLinkOpen(true);
  }

  const applyLink = (href: string) => {
    setLinkOpen(false);
    focusEditor();
    dispatch({ type: 'set-link', href });
  };

  const cancelLink = () => {
    setLinkOpen(false);
    focusEditor();
  };

  const run = (action: EditorAction) => {
    focusEditor();
    dispatch(action);
  };

  const characters = state.doc.blocks.reduce(
    (total, block) => total + blockLength(block),
    0,
  );

  return (
    <div className="editor">
      <Toolbar
        marks={marks}
        hasSelection={state.selection !== null}
        canUndo={canUndo(state.history)}
        canRedo={canRedo(state.history)}
        onToggleBold={() => run({ type: 'toggle-mark', mark: 'bold' })}
        onToggleItalic={() => run({ type: 'toggle-mark', mark: 'italic' })}
        onOpenLink={openLink}
        onRemoveLink={() => run({ type: 'remove-link' })}
        onUndo={() => run({ type: 'undo' })}
        onRedo={() => run({ type: 'redo' })}
      />

      {linkOpen && (
        <LinkPopover initialHref={existingHref} onApply={applyLink} onCancel={cancelLink} />
      )}

      <div
        ref={rootRef}
        className="surface"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Document"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCopy={onCopyOrCut}
        onCut={onCopyOrCut}
      >
        <DocumentView doc={state.doc} activeBlockId={activeBlockId} />
      </div>

      <div className="statusbar">
        <span className="status-item status-caret">{selectionSummary(state)}</span>
        <span className="status-item">
          {state.doc.blocks.length} {state.doc.blocks.length === 1 ? 'block' : 'blocks'}
        </span>
        <span className="status-item">{characters} chars</span>
        <span className="status-item">
          {state.history.past.length} undo · {state.history.future.length} redo
        </span>
        {state.pendingMarks && state.pendingMarks.length > 0 && (
          <span className="status-item status-staged">
            staged {state.pendingMarks.map((mark) => mark.type).join(' + ')}
          </span>
        )}
      </div>
    </div>
  );
}
