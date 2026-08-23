import { useReducer, useRef } from 'react';
import { Editor } from './components/Editor';
import { ModelInspector } from './components/ModelInspector';
import { createInitialState, editorReducer, sampleDoc } from './model/editorState';

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, () =>
    createInitialState(sampleDoc()),
  );

  const surfaceRef = useRef<HTMLDivElement>(null);

  const activeBlockId = state.selection?.focus.blockId ?? null;

  return (
    <div className="app">
      <header className="masthead">
        <p className="eyebrow">Take-home · React 18 · TypeScript strict</p>
        <h1 className="title">Rich-text editor core</h1>
        <p className="lede">
          The writing surface is an input device. Every keystroke is cancelled, applied to
          the document model, and rendered back — so the JSON beside it is not an export of
          the editor, it <em>is</em> the editor.
        </p>
      </header>

      <main className="workspace">
        <Editor
          state={state}
          dispatch={dispatch}
          surfaceRef={surfaceRef}
          activeBlockId={activeBlockId}
        />
        <ModelInspector
          state={state}
          activeBlockId={activeBlockId}
          onLoad={(doc) => dispatch({ type: 'load', doc })}
          onRequestFocus={() => surfaceRef.current?.focus()}
        />
      </main>
    </div>
  );
}
