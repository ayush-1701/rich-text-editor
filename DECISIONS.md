# Decisions

Every rule below is enforced by a named test. Where I chose between defensible
options, the rejected one is stated.

---

## R4 — Marks and boundaries

### 1. A range is "bold" only if every character in it is bold

`rangeHasMarkEverywhere` is the predicate behind both the toolbar's lit state
and the toggle direction.

- Toggling a **partially** bold range makes the whole range bold.
- Toggling a **fully** bold range clears it.
- The second press therefore always undoes the first.

Rejected: "toggle each character independently", which inverts the range and
leaves the user with the photographic negative of what they selected. Nobody
means that.

Rejected: "toggle based on the first character", which makes the outcome depend
on drag direction — selecting the same words left-to-right and right-to-left
would do different things.

Consequence: the toolbar button is a truthful predicate. Lit means *all of this
is bold*, and pressing it always produces a uniform result.

> `operations.test.ts` — "makes a partially bold range fully bold", "clears a
> fully bold range on the second press", "is an exact inverse round trip"

### 2. Toggling with a collapsed caret stages the mark; it does not edit

There is no text at a caret, so there is nothing to mark. The intent is stored
in `pendingMarks` and consumed by the next inserted character.

- Staged marks are **not** recorded in history. Nothing has happened yet, and an
  undo that unpresses a button is noise.
- Moving the caret discards them. Pressing bold and then clicking elsewhere must
  not silently bold what you type next.
- Re-selecting the *same* position does not discard them, so the round trip
  through `selectionchange` after a toolbar click is harmless.

> `history.test.ts` — "stages marks at a collapsed caret without touching the
> document or history", "discards staged marks when the caret moves"

### 3. Bold and italic are sticky at a boundary; links are not

Typing at a collapsed caret inherits the marks of the character **before** it,
falling back to the character after at the start of a block.

Links are the exception. Typing at the trailing edge of a link does **not**
extend the link — the link mark is inherited only when the caret is strictly
inside a run carrying the same `href`.

The reason is that a link's extent is a semantic claim about which words are the
link, whereas bold is a visual property of individual characters. Growing a link
by accident is a content bug the user cannot see until they click it; failing to
grow it is a visible one they fix in a second.

> `marks.test.ts` — "keeps bold sticky at the trailing edge of a bold run",
> "does not extend a link when typing at its trailing edge", "keeps the link when
> typing strictly inside it"

### 4. A mark set holds at most one mark per type

`withMark` removes any existing mark of the same type before adding. Applying a
link over a link retargets it rather than nesting two, which is what a nested
DOM model would produce and what no user has ever wanted.

Marks are stored in a canonical order (bold, italic, link), so two equal mark
sets are also structurally equal and `normalizeChildren` can merge them.

> `marks.test.ts` — "replaces a mark of the same type rather than duplicating it"
> `operations.test.ts` — "retargets an existing link rather than nesting one"

### 5. A collapsed caret inside a link operates on the whole link

"Remove link" or "Edit link" with the caret parked inside a link affects the
entire link. Requiring the user to select it precisely first is a chore, and a
zero-width unlink is a no-op that looks like a bug.

The expansion crosses span boundaries, so a link that has been split by an
overlapping bold run is still treated as one link.

> `operations.test.ts` — "expands a collapsed caret to the whole link", "removes
> the whole link from a caret inside it"
> `marks.test.ts` — "spans a link that is split by an overlapping bold run"

### 6. Marks are orthogonal

Removing a link preserves bold and italic on the same text, and vice versa. Each
mark type is added and removed independently.

> `operations.test.ts` — "keeps bold when a link is removed"

### 7. Normalization is part of every operation

After any edit: empty spans are dropped, adjacent spans with equal mark sets are
merged, and an empty block keeps exactly one empty placeholder span.

Without this the model accumulates invisible fragments — bold then unbold leaves
three spans where one belongs — and structural equality stops being usable for
comparing documents or writing tests.

> `doc.test.ts` — "merges adjacent spans with the same mark set", "treats mark
> order as insignificant when merging", "drops empty spans but always leaves a
> placeholder"

---

## R5 — History and coalescing

### 8. Snapshots, not inverse operations

Each history entry is a full `{ doc, selection }`. The model is immutable and
structurally shared, so an unchanged block is one pointer copy; a snapshot of a
long document after a one-character edit costs a new array and one new block.

Inverse operations would be the right call the moment collaborative editing
arrives, because undo then has to mean "invert my edit as rebased over everyone
else's", which a snapshot cannot express. Until then, snapshots eliminate a
whole class of bug where an operation's inverse is subtly wrong.

Capped at 200 entries, oldest dropped.

> `history.test.ts` — "caps the stack"

### 9. Entries store state *before* the edit, so undo restores the caret too

Undo restores the document **and** the selection the user had when they began
that edit. Undoing a bolding re-selects the words that were bolded, so the user
can see what changed and press the button again if that is what they meant.

> `history.test.ts` — "restores the caret along with the document", "restores the
> selection that a formatting change was applied to"

### 10. Three conditions must hold for an edit to merge into the previous unit

1. **Same kind, and that kind is character-at-a-time.** Only `insert-text`,
   `delete-backward`, and `delete-forward` coalesce. Typing then backspacing
   produces two units.
2. **Within 800 ms of the previous edit.** A pause is a thought boundary. 800 ms
   is above a fast typist's inter-key interval (~150 ms) and below the shortest
   deliberate pause.
3. **Contiguous.** The caret before this edit is exactly where the previous edit
   left it. This one condition subsumes "did the user click away", "did they
   press an arrow key", and "did they edit a different block" — all of them move
   the caret somewhere the last edit did not leave it.

> `history.test.ts` — "coalesces contiguous typing inside the window", "starts a
> new unit once the time window lapses", "starts a new unit when the caret is not
> where the last edit left it", "never coalesces across different edit kinds"

### 11. Whitespace opens a new undo unit

Inserting a space, tab, or newline forces a break, giving word-granularity undo:
typing `hello world` and pressing undo leaves `hello`, not `hello worl`.

This is the behaviour of every editor and word processor people already use, and
matching it costs one predicate.

> `history.test.ts` — "undoes a word at a time rather than a character at a time"

### 12. Anything that is not incremental typing is one unit

Formatting changes, block splits, range deletions, and pastes each force a
break, before and after. A paste that creates forty blocks is one undo. Replacing
a selection by typing over it is one undo, not a delete plus a coalescing insert.

> `history.test.ts` — "never coalesces formatting", "treats a paste as a single
> undo unit"

### 13. Any new edit clears the redo stack

Standard linear history. Branching history is a real feature with a real UI cost
and no way to express it in a toolbar with one Redo button.

> `history.test.ts` — "clears the redo stack on a new edit"

### 14. Undo and redo themselves reset the coalescing state

After time-travelling, the next edit always begins a new unit — otherwise an
edit made after an undo could merge into a unit recorded before it, and the
stack would no longer describe a sequence that ever existed.

---

## Smaller calls

| Decision | Reason |
|---|---|
| Splitting a heading produces a paragraph | Pressing Enter after a title starts body text, not a second title. |
| `Shift+Enter` splits the block | The model has no line-break node; a soft break would be a third position kind for little gain. |
| Copy and cut write `text/plain` only | The model owns the rich representation; emitting HTML would mean maintaining a second serializer that has to round-trip. |
| A bare `example.com` in the link input becomes `https://example.com` | It is what people type, and a schemeless href resolves as a relative path. |
| Deleting everything leaves one empty block | `Doc` is never empty, so no operation needs a "document has no blocks" branch. |
| `deleteRange` early-returns only *within* a block | Across blocks a zero-width range still deletes the boundary — this is exactly backspace at offset 0, and getting it wrong was a real bug the tests caught. |
| Block ids are generated, not indices | A selection must survive a block moving index; React keys must survive a split. |
| `deserialize` validates and throws | A document loaded from storage is untrusted input. Failing loudly at the boundary beats an unknown mark type surfacing three operations later. |
