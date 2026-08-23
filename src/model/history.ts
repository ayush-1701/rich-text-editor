import { isCollapsed, pointsEqual } from './selection';
import type { Doc, Point, Selection } from './types';

/**
 * Undo history (R5).
 *
 * Entries are full snapshots of `{ doc, selection }`. Snapshots rather than
 * inverse operations: the model is small, structurally shared, and immutable,
 * so a snapshot is a handful of pointer copies. Inverse ops would be the right
 * call once collaborative editing (OT/CRDT) is on the table — see DECISIONS.md.
 *
 * Each entry stores the state *before* an edit. Undo therefore restores both
 * the document and the caret the user had when they started that edit.
 */

export const COALESCE_WINDOW_MS = 800;
export const MAX_HISTORY = 200;

export type EditKind =
  | 'insert-text'
  | 'delete-backward'
  | 'delete-forward'
  | 'delete-range'
  | 'split-block'
  | 'format'
  | 'replace';

const COALESCABLE: ReadonlySet<EditKind> = new Set<EditKind>([
  'insert-text',
  'delete-backward',
  'delete-forward',
]);

export interface HistoryEntry {
  readonly doc: Doc;
  readonly selection: Selection | null;
}

export interface HistoryState {
  readonly past: HistoryEntry[];
  readonly future: HistoryEntry[];
  readonly lastKind: EditKind | null;
  /** Caret left behind by the previous edit; used for the contiguity test. */
  readonly lastCaret: Point | null;
  readonly lastAt: number;
}

export interface RecordOptions {
  kind: EditKind;
  /** Caret after the edit lands. */
  caretAfter: Point | null;
  at: number;
  /** Force a new undo unit even if the edit would otherwise coalesce. */
  forceBreak?: boolean | undefined;
}

export function createHistory(): HistoryState {
  return { past: [], future: [], lastKind: null, lastCaret: null, lastAt: 0 };
}

/**
 * Three conditions must all hold to merge an edit into the previous undo unit:
 *   1. same kind, and that kind is a character-at-a-time kind
 *   2. inside the time window
 *   3. contiguous — the caret before this edit is exactly where the last edit
 *      left it, so an arrow key or a click always starts a new unit
 */
export function canCoalesce(
  history: HistoryState,
  before: HistoryEntry,
  options: RecordOptions,
): boolean {
  if (options.forceBreak) return false;
  if (history.past.length === 0) return false;
  if (history.lastKind !== options.kind) return false;
  if (!COALESCABLE.has(options.kind)) return false;
  if (options.at - history.lastAt > COALESCE_WINDOW_MS) return false;

  const previousCaret = before.selection;
  if (!previousCaret || !isCollapsed(previousCaret)) return false;
  return pointsEqual(history.lastCaret, previousCaret.focus);
}

/** Record the pre-edit state, either as a new undo unit or merged into the last. */
export function recordEdit(
  history: HistoryState,
  before: HistoryEntry,
  options: RecordOptions,
): HistoryState {
  if (canCoalesce(history, before, options)) {
    return {
      ...history,
      future: [],
      lastCaret: options.caretAfter,
      lastAt: options.at,
    };
  }

  const past = [...history.past, before];
  return {
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    future: [],
    lastKind: options.kind,
    lastCaret: options.caretAfter,
    lastAt: options.at,
  };
}

export interface TravelResult {
  entry: HistoryEntry;
  history: HistoryState;
}

export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}

export function undo(history: HistoryState, current: HistoryEntry): TravelResult | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
      lastKind: null,
      lastCaret: null,
      lastAt: 0,
    },
  };
}

export function redo(history: HistoryState, current: HistoryEntry): TravelResult | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
      lastKind: null,
      lastCaret: null,
      lastAt: 0,
    },
  };
}
