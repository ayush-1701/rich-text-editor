# Rich-text editor core

A rich-text editor where the document model is the single source of truth and
the DOM is only a projection of it. React 18 + TypeScript in full strict mode.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 127 tests
npm run typecheck  # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
npm run build
```

## What to look at

| | |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Data structure, the DOM ↔ model reconciliation loop, and how I would handle IME and rich paste in production. |
| [`DECISIONS.md`](./DECISIONS.md) | Mark boundary rules (R4) and history coalescing rules (R5), each tied to the test that enforces it. |
| `src/model/` | The whole editor. Pure functions over plain data — no DOM, no React. |
| `src/dom/domSelection.ts` | The only file that knows the DOM exists. Positions only, never content. |

The panel on the right is the live document model, serialized. It is a readout
by default — the block holding the caret is highlighted there and marked in the
writing surface at the same time, so you can watch an edit land in the model.
**Edit** turns it into an input; **Load JSON** reconstructs the document from
whatever you paste, which is R1 demonstrated rather than asserted.

## Try these

- Select a range that is only partly bold and press **B** twice.
- Press **B** with nothing selected, then type. Then press **B**, click
  elsewhere, and type.
- Type at the very end of the link in the sample text.
- Type `hello world` and press undo twice.
- Put the caret in the middle of a link and press **Unlink**.
- Select across two paragraphs and press **B**, then undo.
- Paste a document into **Edit → Load JSON**, and try a malformed one.

## Shortcuts

`Ctrl/Cmd+B` bold · `Ctrl/Cmd+I` italic · `Ctrl/Cmd+K` link ·
`Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` redo

## Scope

Per the brief, IME composition and rich HTML paste are not implemented. Both are
analysed in `ARCHITECTURE.md` under "Known limits, and how I would close them".
