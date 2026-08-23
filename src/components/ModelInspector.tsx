import { useEffect, useMemo, useState } from 'react';
import { deserialize, serialize } from '../model/doc';
import type { EditorState } from '../model/editorState';
import {
  rangeForBlock,
  serializeWithBlockRanges,
  tokenizeJsonLine,
} from '../model/serializeView';
import type { Doc } from '../model/types';

interface ModelInspectorProps {
  state: EditorState;
  activeBlockId: string | null;
  onLoad: (doc: Doc) => void;
  onRequestFocus: () => void;
}

/**
 * A readout, not an editor.
 *
 * By default this is read-only: the document serialized, syntax-tinted, with
 * the block holding the caret highlighted so the two halves of the screen
 * visibly point at the same thing. Editing is a mode you opt into, which keeps
 * the writing surface the primary object on the page.
 */
export function ModelInspector({
  state,
  activeBlockId,
  onLoad,
  onRequestFocus,
}: ModelInspectorProps) {
  const view = useMemo(() => serializeWithBlockRanges(state.doc), [state.doc]);
  const active = rangeForBlock(view.ranges, activeBlockId);

  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pulse, setPulse] = useState(0);

  const editing = draft !== null;

  // Flash the active block's lines whenever the document changes, so an edit is
  // visibly an edit to the model rather than to the screen.
  useEffect(() => {
    setPulse((count) => count + 1);
  }, [state.doc]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const load = () => {
    if (draft === null) return;
    try {
      // Parse first, dispatch second. Everything that can fail happens here,
      // synchronously, inside the catch that renders the message.
      const parsed = deserialize(draft);
      onLoad(parsed);
      setDraft(null);
      setError(null);
      onRequestFocus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that JSON');
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(view.json).then(() => setCopied(true));
  };

  const download = () => {
    const blob = new Blob([serialize(state.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'document.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="inspector" aria-label="Document model">
      <div className="inspector-bar">
        <h2 className="inspector-title">Document model</h2>
        <span className="inspector-note">
          {editing ? 'editing' : `${view.lines.length} lines`}
        </span>
      </div>

      <div className="inspector-frame">
        {editing ? (
          <textarea
            className="json-input"
            spellCheck={false}
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
        ) : (
          <pre className="json-view" aria-live="off">
            {view.lines.map((line, index) => {
              const inActive = active !== null && index >= active.start && index <= active.end;
              return (
                <span
                  key={`${index}:${line}`}
                  className={inActive ? 'json-line json-line-active' : 'json-line'}
                  data-pulse={inActive ? pulse : undefined}
                >
                  {tokenizeJsonLine(line).map((token, position) => (
                    <span key={position} className={`tok tok-${token.kind}`}>
                      {token.text}
                    </span>
                  ))}
                </span>
              );
            })}
          </pre>
        )}
      </div>

      {error && (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      )}

      <div className="inspector-actions">
        {editing ? (
          <>
            <button type="button" className="tool tool-primary" onClick={load}>
              Load JSON
            </button>
            <button
              type="button"
              className="tool"
              onClick={() => {
                setDraft(null);
                setError(null);
                onRequestFocus();
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="tool"
              onClick={() => {
                setDraft(view.json);
                setError(null);
              }}
            >
              Edit
            </button>
            <button type="button" className="tool" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="tool" onClick={download}>
              Download
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
