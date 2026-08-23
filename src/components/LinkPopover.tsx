import { useEffect, useRef, useState } from 'react';

interface LinkPopoverProps {
  initialHref: string;
  onApply: (href: string) => void;
  onCancel: () => void;
}

export function LinkPopover({ initialHref, onApply, onCancel }: LinkPopoverProps) {
  const [href, setHref] = useState(initialHref);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = () => {
    const trimmed = href.trim();
    if (trimmed.length === 0) {
      onCancel();
      return;
    }
    // A bare domain is what people actually type; make it a usable URL.
    const normalized = /^[a-z][a-z0-9+.-]*:|^\/\/|^\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    onApply(normalized);
  };

  return (
    <div className="link-popover" role="dialog" aria-label="Link address">
      <label className="link-label" htmlFor="link-href">
        Address
      </label>
      <input
        id="link-href"
        ref={inputRef}
        className="link-input"
        type="text"
        value={href}
        placeholder="example.com/page"
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <button type="button" className="tool" onMouseDown={(e) => e.preventDefault()} onClick={apply}>
        Apply
      </button>
      <button
        type="button"
        className="tool"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
