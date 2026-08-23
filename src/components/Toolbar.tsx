import type { MouseEvent, ReactNode } from 'react';
import { hasMark } from '../model/marks';
import type { Mark } from '../model/types';

/**
 * R6. Every lit state is derived from the model's active marks, never from
 * `document.queryCommandState`.
 */

interface ToolbarButtonProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  wide?: boolean;
  onPress: () => void;
  children: ReactNode;
}

function ToolbarButton({
  label,
  shortcut,
  active = false,
  disabled = false,
  wide = false,
  onPress,
  children,
}: ToolbarButtonProps) {
  // mousedown default would move focus out of the contenteditable and destroy
  // the selection before the click handler ever runs.
  const hold = (event: MouseEvent) => event.preventDefault();

  return (
    <button
      type="button"
      className={wide ? 'tool tool-wide' : 'tool'}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} · ${shortcut}` : label}
      data-active={active || undefined}
      disabled={disabled}
      onMouseDown={hold}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

interface ToolbarProps {
  marks: Mark[];
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onOpenLink: () => void;
  onRemoveLink: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function Toolbar({
  marks,
  hasSelection,
  canUndo,
  canRedo,
  onToggleBold,
  onToggleItalic,
  onOpenLink,
  onRemoveLink,
  onUndo,
  onRedo,
}: ToolbarProps) {
  const linked = hasMark(marks, 'link');

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tool-group">
        <ToolbarButton
          label="Bold"
          shortcut="Ctrl+B"
          active={hasMark(marks, 'bold')}
          disabled={!hasSelection}
          onPress={onToggleBold}
        >
          <span className="glyph glyph-bold">B</span>
        </ToolbarButton>

        <ToolbarButton
          label="Italic"
          shortcut="Ctrl+I"
          active={hasMark(marks, 'italic')}
          disabled={!hasSelection}
          onPress={onToggleItalic}
        >
          <span className="glyph glyph-italic">I</span>
        </ToolbarButton>
      </div>

      <span className="tool-divider" aria-hidden="true" />

      <div className="tool-group">
        <ToolbarButton
          label={linked ? 'Edit link' : 'Add link'}
          shortcut="Ctrl+K"
          active={linked}
          disabled={!hasSelection}
          wide
          onPress={onOpenLink}
        >
          Link
        </ToolbarButton>

        <ToolbarButton
          label="Remove link"
          disabled={!hasSelection || !linked}
          wide
          onPress={onRemoveLink}
        >
          Unlink
        </ToolbarButton>
      </div>

      <span className="tool-spacer" />

      <div className="tool-group">
        <ToolbarButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onPress={onUndo}>
          <UndoIcon />
        </ToolbarButton>

        <ToolbarButton
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          disabled={!canRedo}
          onPress={onRedo}
        >
          <UndoIcon flipped />
        </ToolbarButton>
      </div>
    </div>
  );
}

function UndoIcon({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      style={flipped ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path
        d="M3.2 6.4h6.1a3.6 3.6 0 0 1 0 7.2H6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M5.9 3.3 2.8 6.4l3.1 3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
