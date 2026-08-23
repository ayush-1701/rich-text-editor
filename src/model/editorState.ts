import { createBlock, createDoc, createId, createSpan } from './doc';
import {
  canRedo,
  canUndo,
  createHistory,
  recordEdit,
  redo,
  undo,
  type EditKind,
  type HistoryEntry,
  type HistoryState,
} from './history';
import { activeMarks, hasMark, withMark, withoutMark } from './marks';
import {
  clampSelection,
  isCollapsed,
  orderedRange,
  selectionsEqual,
} from './selection';
import {
  deleteBackward,
  deleteForward,
  deleteRange,
  insertPlainText,
  insertText,
  removeLink,
  setBlockType,
  setLink,
  splitBlock,
  toggleMark,
} from './operations';
import type { Block, Doc, Mark, OpResult, Selection } from './types';

export interface EditorState {
  readonly doc: Doc;
  readonly selection: Selection | null;
  /**
   * Marks staged at a collapsed caret. Toggling bold with nothing selected
   * cannot change the document — there is no text to change — so the intent is
   * held here until the next character is typed.
   */
  readonly pendingMarks: Mark[] | null;
  readonly history: HistoryState;
}

export type EditorAction =
  | { type: 'select'; selection: Selection | null }
  | { type: 'insert-text'; text: string; at?: number }
  | { type: 'insert-plain-text'; text: string; at?: number }
  | { type: 'delete-backward'; at?: number }
  | { type: 'delete-forward'; at?: number }
  | { type: 'delete-range'; at?: number }
  | { type: 'split-block'; at?: number }
  | { type: 'toggle-mark'; mark: 'bold' | 'italic'; at?: number }
  | { type: 'set-link'; href: string; at?: number }
  | { type: 'remove-link'; at?: number }
  | { type: 'set-block-type'; blockType: Block['type']; at?: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; doc: Doc };

export function createInitialState(doc: Doc = createDoc()): EditorState {
  return { doc, selection: null, pendingMarks: null, history: createHistory() };
}

export function sampleDoc(): Doc {
  return createDoc([
    createBlock('Rich-text editor core', 'heading'),
    {
      // Generated, never hardcoded: a literal id here collided with one the
      // generator later handed out, and two blocks sharing an id silently
      // breaks lookup, React keys, and selection.
      id: createId(),
      type: 'paragraph',
      children: [
        createSpan('The document model is the source of truth. This paragraph has '),
        createSpan('bold', [{ type: 'bold' }]),
        createSpan(', '),
        createSpan('italic', [{ type: 'italic' }]),
        createSpan(', '),
        createSpan('both', [{ type: 'bold' }, { type: 'italic' }]),
        createSpan(', and a '),
        createSpan('link', [{ type: 'link', href: 'https://example.com' }]),
        createSpan(' — all stored as marks on text spans.'),
      ],
    },
    createBlock('Type here. Every keystroke is intercepted, applied to the model, and re-rendered.'),
  ]);
}

function snapshot(state: EditorState): HistoryEntry {
  return { doc: state.doc, selection: state.selection };
}

interface CommitOptions {
  kind: EditKind;
  at: number;
  forceBreak?: boolean | undefined;
  pendingMarks?: Mark[] | null | undefined;
}

function commit(
  state: EditorState,
  result: OpResult,
  options: CommitOptions,
): EditorState {
  if (result.doc === state.doc && selectionsEqual(result.selection, state.selection)) {
    return state;
  }
  return {
    doc: result.doc,
    selection: clampSelection(result.doc, result.selection),
    pendingMarks: options.pendingMarks ?? null,
    history: recordEdit(state.history, snapshot(state), {
      kind: options.kind,
      caretAfter: result.selection.focus,
      at: options.at,
      forceBreak: options.forceBreak,
    }),
  };
}

/** Whitespace opens a new undo unit, giving word-granularity undo. */
function breaksCoalescing(text: string): boolean {
  return /\s/.test(text);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select': {
      const next = clampSelection(state.doc, action.selection);
      if (selectionsEqual(next, state.selection)) return state;
      // Moving the caret discards staged marks — bold-then-click-elsewhere
      // should not silently bold whatever you type next.
      return { ...state, selection: next, pendingMarks: null };
    }

    case 'insert-text': {
      if (!state.selection) return state;
      const at = action.at ?? Date.now();
      const result = insertText(
        state.doc,
        state.selection,
        action.text,
        state.pendingMarks ?? undefined,
      );
      return commit(state, result, {
        kind: 'insert-text',
        at,
        forceBreak: breaksCoalescing(action.text) || !isCollapsed(state.selection),
      });
    }

    case 'insert-plain-text': {
      if (!state.selection) return state;
      const result = insertPlainText(
        state.doc,
        state.selection,
        action.text,
        state.pendingMarks ?? undefined,
      );
      return commit(state, result, {
        kind: 'replace',
        at: action.at ?? Date.now(),
        forceBreak: true,
      });
    }

    case 'delete-backward': {
      if (!state.selection) return state;
      const collapsed = isCollapsed(state.selection);
      const result = deleteBackward(state.doc, state.selection);
      return commit(state, result, {
        kind: collapsed ? 'delete-backward' : 'delete-range',
        at: action.at ?? Date.now(),
        forceBreak: !collapsed,
      });
    }

    case 'delete-forward': {
      if (!state.selection) return state;
      const collapsed = isCollapsed(state.selection);
      const result = deleteForward(state.doc, state.selection);
      return commit(state, result, {
        kind: collapsed ? 'delete-forward' : 'delete-range',
        at: action.at ?? Date.now(),
        forceBreak: !collapsed,
      });
    }

    case 'delete-range': {
      if (!state.selection || isCollapsed(state.selection)) return state;
      const result = deleteRange(state.doc, state.selection);
      return commit(state, result, {
        kind: 'delete-range',
        at: action.at ?? Date.now(),
        forceBreak: true,
      });
    }

    case 'split-block': {
      if (!state.selection) return state;
      const result = splitBlock(state.doc, state.selection);
      return commit(state, result, {
        kind: 'split-block',
        at: action.at ?? Date.now(),
        forceBreak: true,
      });
    }

    case 'toggle-mark': {
      if (!state.selection) return state;

      if (isCollapsed(state.selection)) {
        // No text to change: stage the mark instead of touching the document,
        // and keep it out of the undo stack (nothing has happened yet).
        const current = activeMarks(state.doc, state.selection, state.pendingMarks);
        const next = hasMark(current, action.mark)
          ? withoutMark(current, action.mark)
          : withMark(current, { type: action.mark });
        return { ...state, pendingMarks: next };
      }

      const result = toggleMark(state.doc, state.selection, action.mark);
      return commit(state, result, {
        kind: 'format',
        at: action.at ?? Date.now(),
        forceBreak: true,
      });
    }

    case 'set-link': {
      if (!state.selection) return state;
      const result = setLink(state.doc, state.selection, action.href);
      return commit(state, result, {
        kind: 'format',
        at: action.at ?? Date.now(),
        forceBreak: true,
      });
    }

    case 'remove-link': {
      if (!state.selection) return state;
      const result = removeLink(state.doc, state.selection);
      return commit(state, result, {
        kind: 'format',
        at: action.at ?? Date.now(),
        forceBreak: true,
      });
    }

    case 'set-block-type': {
      if (!state.selection) return state;
      const result = setBlockType(state.doc, state.selection, action.blockType);
      return commit(state, result, {
        kind: 'format',
        at: action.at ?? Date.now(),
        forceBreak: true,
      });
    }

    case 'undo': {
      const travel = undo(state.history, snapshot(state));
      if (!travel) return state;
      return {
        doc: travel.entry.doc,
        selection: clampSelection(travel.entry.doc, travel.entry.selection),
        pendingMarks: null,
        history: travel.history,
      };
    }

    case 'redo': {
      const travel = redo(state.history, snapshot(state));
      if (!travel) return state;
      return {
        doc: travel.entry.doc,
        selection: clampSelection(travel.entry.doc, travel.entry.selection),
        pendingMarks: null,
        history: travel.history,
      };
    }

    case 'load': {
      // The document arrives already parsed and validated. A reducer must be
      // pure and must not throw: React may invoke it more than once per
      // dispatch (StrictMode double-invoke, concurrent replay), and a throw
      // here lands in the render phase where no caller's try/catch can reach
      // it — it unmounts the tree instead of showing an error.
      return {
        doc: action.doc,
        selection: null,
        pendingMarks: null,
        history: recordEdit(state.history, snapshot(state), {
          kind: 'replace',
          caretAfter: null,
          at: Date.now(),
          forceBreak: true,
        }),
      };
    }

    default:
      return state;
  }
}

export function selectionSummary(state: EditorState): string {
  if (!state.selection) return 'no selection';
  const { start, end } = orderedRange(state.doc, state.selection);
  if (isCollapsed(state.selection)) return `caret ${start.blockId}:${start.offset}`;
  return `${start.blockId}:${start.offset} → ${end.blockId}:${end.offset}`;
}

export { canUndo, canRedo };
