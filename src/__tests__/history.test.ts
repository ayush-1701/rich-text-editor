import { beforeEach, describe, expect, it } from 'vitest';
import { createDoc, createSpan, docText, resetIdCounter } from '../model/doc';
import {
  COALESCE_WINDOW_MS,
  MAX_HISTORY,
  canRedo,
  canUndo,
  createHistory,
  recordEdit,
  redo,
  undo,
} from '../model/history';
import {
  createInitialState,
  editorReducer,
  type EditorAction,
  type EditorState,
} from '../model/editorState';
import { collapsedSelection, createPoint, createSelection } from '../model/selection';
import { hasMark } from '../model/marks';
import type { Doc } from '../model/types';

beforeEach(() => resetIdCounter(200));

function docWith(text: string): Doc {
  return createDoc([{ id: 'h1', type: 'paragraph', children: [createSpan(text)] }]);
}

/* -------------------------------------------------------------------------- */
/* Stack mechanics                                                            */
/* -------------------------------------------------------------------------- */

describe('history stack', () => {
  it('coalesces contiguous typing inside the window', () => {
    let history = createHistory();
    history = recordEdit(history, { doc: docWith(''), selection: collapsedSelection(createPoint('h1', 0)) }, {
      kind: 'insert-text',
      caretAfter: createPoint('h1', 1),
      at: 1000,
    });
    history = recordEdit(history, { doc: docWith('a'), selection: collapsedSelection(createPoint('h1', 1)) }, {
      kind: 'insert-text',
      caretAfter: createPoint('h1', 2),
      at: 1100,
    });
    expect(history.past).toHaveLength(1);
  });

  it('starts a new unit once the time window lapses', () => {
    let history = createHistory();
    history = recordEdit(history, { doc: docWith(''), selection: collapsedSelection(createPoint('h1', 0)) }, {
      kind: 'insert-text',
      caretAfter: createPoint('h1', 1),
      at: 1000,
    });
    history = recordEdit(history, { doc: docWith('a'), selection: collapsedSelection(createPoint('h1', 1)) }, {
      kind: 'insert-text',
      caretAfter: createPoint('h1', 2),
      at: 1000 + COALESCE_WINDOW_MS + 1,
    });
    expect(history.past).toHaveLength(2);
  });

  it('starts a new unit when the caret is not where the last edit left it', () => {
    let history = createHistory();
    history = recordEdit(history, { doc: docWith(''), selection: collapsedSelection(createPoint('h1', 0)) }, {
      kind: 'insert-text',
      caretAfter: createPoint('h1', 1),
      at: 1000,
    });
    // The user clicked elsewhere: the pre-edit caret no longer matches.
    history = recordEdit(history, { doc: docWith('a'), selection: collapsedSelection(createPoint('h1', 5)) }, {
      kind: 'insert-text',
      caretAfter: createPoint('h1', 6),
      at: 1050,
    });
    expect(history.past).toHaveLength(2);
  });

  it('never coalesces across different edit kinds', () => {
    let history = createHistory();
    history = recordEdit(history, { doc: docWith('ab'), selection: collapsedSelection(createPoint('h1', 2)) }, {
      kind: 'insert-text',
      caretAfter: createPoint('h1', 2),
      at: 1000,
    });
    history = recordEdit(history, { doc: docWith('ab'), selection: collapsedSelection(createPoint('h1', 2)) }, {
      kind: 'delete-backward',
      caretAfter: createPoint('h1', 1),
      at: 1050,
    });
    expect(history.past).toHaveLength(2);
  });

  it('never coalesces formatting', () => {
    let history = createHistory();
    const entry = { doc: docWith('ab'), selection: collapsedSelection(createPoint('h1', 2)) };
    history = recordEdit(history, entry, { kind: 'format', caretAfter: createPoint('h1', 2), at: 1000 });
    history = recordEdit(history, entry, { kind: 'format', caretAfter: createPoint('h1', 2), at: 1010 });
    expect(history.past).toHaveLength(2);
  });

  it('honours an explicit break', () => {
    let history = createHistory();
    const before = { doc: docWith(''), selection: collapsedSelection(createPoint('h1', 0)) };
    history = recordEdit(history, before, { kind: 'insert-text', caretAfter: createPoint('h1', 1), at: 1000 });
    history = recordEdit(
      history,
      { doc: docWith('a'), selection: collapsedSelection(createPoint('h1', 1)) },
      { kind: 'insert-text', caretAfter: createPoint('h1', 2), at: 1050, forceBreak: true },
    );
    expect(history.past).toHaveLength(2);
  });

  it('caps the stack', () => {
    let history = createHistory();
    for (let i = 0; i < MAX_HISTORY + 25; i += 1) {
      history = recordEdit(history, { doc: docWith(String(i)), selection: null }, {
        kind: 'format',
        caretAfter: null,
        at: i,
      });
    }
    expect(history.past).toHaveLength(MAX_HISTORY);
  });

  it('clears the redo stack on a new edit', () => {
    let history = createHistory();
    history = recordEdit(history, { doc: docWith('a'), selection: null }, {
      kind: 'format',
      caretAfter: null,
      at: 1,
    });
    const travelled = undo(history, { doc: docWith('b'), selection: null })!;
    expect(canRedo(travelled.history)).toBe(true);
    const after = recordEdit(travelled.history, { doc: docWith('a'), selection: null }, {
      kind: 'format',
      caretAfter: null,
      at: 2,
    });
    expect(canRedo(after)).toBe(false);
  });

  it('round-trips through undo and redo', () => {
    let history = createHistory();
    const before = { doc: docWith('before'), selection: collapsedSelection(createPoint('h1', 0)) };
    const after = { doc: docWith('after'), selection: collapsedSelection(createPoint('h1', 5)) };
    history = recordEdit(history, before, { kind: 'format', caretAfter: createPoint('h1', 5), at: 1 });

    const undone = undo(history, after)!;
    expect(undone.entry).toEqual(before);
    const redone = redo(undone.history, before)!;
    expect(redone.entry).toEqual(after);
  });

  it('reports emptiness', () => {
    expect(canUndo(createHistory())).toBe(false);
    expect(undo(createHistory(), { doc: docWith(''), selection: null })).toBeNull();
    expect(redo(createHistory(), { doc: docWith(''), selection: null })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Reducer integration                                                        */
/* -------------------------------------------------------------------------- */

function run(state: EditorState, actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function typing(text: string, startAt: number): EditorAction[] {
  return [...text].map((character, index) => ({
    type: 'insert-text' as const,
    text: character,
    at: startAt + index * 50,
  }));
}

describe('reducer + history', () => {
  const start = () => {
    const initial = createInitialState(docWith(''));
    return editorReducer(initial, {
      type: 'select',
      selection: collapsedSelection(createPoint('h1', 0)),
    });
  };

  it('undoes a word at a time rather than a character at a time', () => {
    const typed = run(start(), typing('hello world', 1000));
    expect(docText(typed.doc)).toBe('hello world');

    const once = editorReducer(typed, { type: 'undo' });
    expect(docText(once.doc)).toBe('hello');

    const twice = editorReducer(once, { type: 'undo' });
    expect(docText(twice.doc)).toBe('');
  });

  it('restores the caret along with the document (R5)', () => {
    const typed = run(start(), typing('abc', 1000));
    expect(typed.selection?.focus).toEqual(createPoint('h1', 3));

    const undone = editorReducer(typed, { type: 'undo' });
    expect(undone.selection?.focus).toEqual(createPoint('h1', 0));
  });

  it('restores the selection that a formatting change was applied to', () => {
    const typed = run(start(), typing('bold', 1000));
    const selected = editorReducer(typed, {
      type: 'select',
      selection: createSelection(createPoint('h1', 0), createPoint('h1', 4)),
    });
    const bolded = editorReducer(selected, { type: 'toggle-mark', mark: 'bold', at: 5000 });
    expect(hasMark(bolded.doc.blocks[0]!.children[0]!.marks, 'bold')).toBe(true);

    const undone = editorReducer(bolded, { type: 'undo' });
    expect(hasMark(undone.doc.blocks[0]!.children[0]!.marks, 'bold')).toBe(false);
    expect(undone.selection).toEqual(
      createSelection(createPoint('h1', 0), createPoint('h1', 4)),
    );
  });

  it('stages marks at a collapsed caret without touching the document or history', () => {
    const state = start();
    const staged = editorReducer(state, { type: 'toggle-mark', mark: 'bold' });
    expect(staged.doc).toBe(state.doc);
    expect(staged.history.past).toHaveLength(0);
    expect(staged.pendingMarks).toEqual([{ type: 'bold' }]);

    const typed = editorReducer(staged, { type: 'insert-text', text: 'x', at: 1000 });
    expect(hasMark(typed.doc.blocks[0]!.children[0]!.marks, 'bold')).toBe(true);
    expect(typed.pendingMarks).toBeNull();
  });

  it('discards staged marks when the caret moves', () => {
    const staged = editorReducer(start(), { type: 'toggle-mark', mark: 'bold' });
    const moved = editorReducer(staged, {
      type: 'select',
      selection: collapsedSelection(createPoint('h1', 0)),
    });
    // Same position: nothing moved, so the staged mark survives.
    expect(moved.pendingMarks).toEqual([{ type: 'bold' }]);

    const typed = run(moved, typing('abc', 1000));
    const elsewhere = editorReducer(typed, {
      type: 'select',
      selection: collapsedSelection(createPoint('h1', 1)),
    });
    expect(elsewhere.pendingMarks).toBeNull();
  });

  it('treats a paste as a single undo unit', () => {
    const typed = run(start(), typing('abc', 1000));
    const pasted = editorReducer(typed, {
      type: 'insert-plain-text',
      text: 'one\ntwo\nthree',
      at: 2000,
    });
    expect(pasted.doc.blocks).toHaveLength(3);
    const undone = editorReducer(pasted, { type: 'undo' });
    expect(docText(undone.doc)).toBe('abc');
  });

  it('redoes what it undid', () => {
    const typed = run(start(), typing('hello world', 1000));
    const undone = editorReducer(typed, { type: 'undo' });
    const redone = editorReducer(undone, { type: 'redo' });
    expect(docText(redone.doc)).toBe('hello world');
    expect(redone.selection).toEqual(typed.selection);
  });

  it('coalesces a backspace run into one undo unit', () => {
    const typed = run(start(), typing('abcdef', 1000));
    const deleted = run(typed, [
      { type: 'delete-backward', at: 5000 },
      { type: 'delete-backward', at: 5050 },
      { type: 'delete-backward', at: 5100 },
    ]);
    expect(docText(deleted.doc)).toBe('abc');
    expect(docText(editorReducer(deleted, { type: 'undo' }).doc)).toBe('abcdef');
  });

  it('accepts a pre-validated document on load and keeps it undoable', () => {
    // Parsing is the caller's job. The reducer must be pure and must never
    // throw: React can invoke it more than once per dispatch, and a throw in
    // the render phase escapes any try/catch around dispatch.
    const initial = createInitialState(docWith('keep me'));
    const loaded = editorReducer(initial, { type: 'load', doc: docWith('replaced') });
    expect(docText(loaded.doc)).toBe('replaced');
    expect(loaded.selection).toBeNull();
    expect(docText(editorReducer(loaded, { type: 'undo' }).doc)).toBe('keep me');
  });

  it('ignores edits while nothing is selected', () => {
    const initial = createInitialState(docWith('x'));
    expect(editorReducer(initial, { type: 'insert-text', text: 'a' })).toBe(initial);
    expect(editorReducer(initial, { type: 'delete-backward' })).toBe(initial);
  });
});
