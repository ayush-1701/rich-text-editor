# Architecture

## The shape of the problem

`contenteditable` is a mutable DOM that the browser edits on its own schedule. If
you let it type and then read the result back, your model becomes a description
of whatever the browser happened to produce — different in every engine, and
different again after the user pastes something.

This editor inverts that. The browser is never allowed to modify the document.
Every input event is cancelled, translated into an operation on a plain JSON
model, and the resulting model is rendered. The DOM the user looks at is a
projection, and nothing reads back out of it except the caret position.

```
keystroke ──▶ beforeinput ──▶ preventDefault()
                                   │
                                   ▼
                       DOM selection ─▶ model Point
                                   │
                                   ▼
                            EditorAction
                                   │
                                   ▼
                editorReducer: pure ops + history
                                   │
                                   ▼
                    { doc, selection, pendingMarks }
                            │             │
              React render ─┘             └─ useLayoutEffect
                     │                             │
                     ▼                             ▼
                 new DOM  ────────────▶  selection restored
```

## Data structure

```ts
Doc   = { blocks: Block[] }
Block = { id: string; type: 'paragraph' | 'heading'; children: InlineSpan[] }
InlineSpan = { text: string; marks: Mark[] }
Mark  = { type: 'bold' } | { type: 'italic' } | { type: 'link'; href: string }
```

Two decisions carry most of the weight.

**Marks are a set on a flat run of text, not nested nodes.** A DOM-shaped tree
(`<b><i>x</i></b>` vs `<i><b>x</b></i>`) has no canonical form, so every edit
would have to answer "which nesting order is correct?" and every comparison
would have to normalize first. A flat list of spans with mark sets has exactly
one canonical form, produced by `normalizeChildren`: no empty spans, and no two
adjacent spans with equal mark sets. Every operation ends with that pass, so
structural equality is meaningful and the rendered element list is stable across
edits.

**A position is `{ blockId, characterOffset }`, not `{ spanIndex, offsetInSpan }`.**
Span indices are unstable by construction — bolding half a word splits one span
into two, unbolding merges them back. Character offsets survive normalization
untouched. This single choice is what makes selection mapping, history, and
cross-block mark toggling each about twenty lines instead of a special case per
operation.

Blocks carry stable ids so a selection can name a block that has moved index,
and so React keys survive a split without remounting untouched siblings.

## Layers

| Layer | Files | Knows about |
|---|---|---|
| Model | `src/model/*` | Nothing but plain data. No DOM, no React. |
| DOM bridge | `src/dom/domSelection.ts` | `Range`, `TreeWalker`. Positions only — never content. |
| View | `src/components/*` | React. Renders the model; forwards events as actions. |

The model layer is where all the logic lives and where all the tests point. It
runs in Node with no jsdom, because none of it touches a browser API.

## Reconciling DOM events with model updates

### DOM → model

`beforeinput` fires on the editable root and is cancelled unconditionally. Its
`inputType` is mapped to an action:

| `inputType` | Action |
|---|---|
| `insertText`, `insertReplacementText` | `insert-text` |
| `insertParagraph`, `insertLineBreak` | `split-block` |
| `deleteContentBackward`, `deleteWordBackward`, `deleteSoftLineBackward`, … | `delete-range` if the target range is non-empty, else `delete-backward` |
| `deleteContentForward`, `deleteWordForward`, … | mirror of the above |
| `historyUndo` / `historyRedo` | `undo` / `redo` |
| `formatBold` / `formatItalic` | `toggle-mark` |
| anything else | dropped |

Word- and line-granularity deletion is handled without implementing word
boundaries: `InputEvent.getTargetRanges()` reports the exact range the browser
intended to remove, which is mapped through `domPointToModel` and deleted. The
browser already knows where words end in every locale; there is no reason to
reimplement that badly.

Because `selectionchange` is dispatched asynchronously, the model's selection can
lag a fast keystroke. Every input handler therefore re-reads the live selection
(or the event's target range) and dispatches `select` before the edit. React's
reducer queue processes both in order, so the edit always applies to the
selection the user actually had.

### Model → DOM

React renders the block list. A `useLayoutEffect` then compares the browser
selection to the model selection and writes the model's version back via
`setBaseAndExtent`, which preserves selection direction so shift-arrow extension
survives a re-render. The write is guarded by a ref so the `selectionchange` it
provokes is not fed back in as user intent.

The effect only runs while the editor owns focus, so the link input can take the
caret without a fight.

### Position mapping

The renderer's contract with the bridge is two attributes: `data-block-id` on
every block element, `data-leaf` on every inline element.

- **DOM → model**: walk up to the nearest `[data-block-id]`, then walk that
  block's text nodes in document order accumulating lengths until the container
  node is reached. Element containers (empty blocks, triple-click) resolve by
  summing the text length of preceding children.
- **model → DOM**: walk the same text nodes accumulating lengths until the
  offset falls inside one.

An empty block renders `<span data-leaf><br></span>`. The `<br>` contributes zero
characters to the walk, so it is invisible to the model while remaining
focusable in the DOM.

## Rendering

`DocumentView` is a pure function of the document — no state, no handlers, no
DOM reads. React keys are `block.id` for blocks and `blockId:index` for leaves.
Leaf indices are stable in practice because normalization is deterministic: the
same document always produces the same span list.

## Known limits, and how I would close them

### IME composition — not implemented

The architecture's core move, `preventDefault()` on `beforeinput`, is precisely
what breaks composition. An IME needs to own a region of the DOM across many
events while it shows candidates, so cancelling those events either kills the
composition or leaves the DOM and model diverged.

The production approach is to suspend the invariant for the duration of a
composition rather than fight it:

1. On `compositionstart`, mark the editor composing. Stop cancelling input, stop
   re-rendering that block, and stop restoring selection — React must not touch
   the composing subtree or the IME loses its anchor.
2. Record the composing block's id and its text at composition start.
3. On `compositionend`, read the composed text out of the DOM once, diff it
   against the recorded text to derive a single `insertText` (or replace)
   operation, apply it to the model, and resume normal rendering. Re-render from
   the model at that point so any DOM the IME left behind is discarded.
4. Record the whole composition as one undo unit.

The other half is marks: an IME cannot compose inside a formatted span reliably,
so the composing region must be a single leaf, which means deferring
normalization for that block until the composition ends.

Testing this needs real browsers — Korean, Japanese, and Pinyin IMEs behave
differently — so it belongs in a Playwright suite, not unit tests.

### HTML paste — plain text only

`paste` is cancelled and `text/plain` is inserted, with newlines becoming block
splits. Rich paste is deliberately out of scope.

The production version is a parse-and-map pipeline, not a sanitizer:

1. Parse `text/html` into a detached document via `DOMParser` — never assign it
   into a live tree, which is where the XSS is.
2. Walk that tree with an allowlist of element → model rules
   (`b`/`strong` → bold, `i`/`em` → italic, `a[href]` → link, `p`/`div`/`h1..h6`
   → block). Everything else contributes only its text. An allowlist fails
   closed; a denylist of dangerous tags fails open on the next tag the spec adds.
3. Resolve `href` against a scheme allowlist (`http`, `https`, `mailto`) so
   `javascript:` and `data:` cannot survive.
4. Normalize whitespace per CSS rules — the largest source of "pasted from Word
   and got forty non-breaking spaces".
5. Strip the Google Docs / Word wrapper markup that carries its own internal
   model in comments and custom attributes.
6. Fall back to `text/plain` whenever the HTML branch throws, so paste never
   breaks the document.

Paste is one undo unit regardless of how many blocks it produces.

### Other deliberate omissions

- **Soft line breaks.** `Shift+Enter` splits a block rather than inserting a
  `<br>`; the model has no line-break node. Adding one means a third position
  kind and a rule for how it interacts with `blockText`, which is more model
  surface than the exercise warrants.
- **Collaborative editing.** History stores snapshots. Concurrent editing needs
  operations that can be transformed or merged — see `DECISIONS.md`.
- **Undo of a `load`.** Loading JSON from the inspector is recorded, so it can be
  undone, but the selection is dropped because the incoming block ids may not
  exist in the outgoing document.
