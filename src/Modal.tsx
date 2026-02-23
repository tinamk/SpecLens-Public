import { useEffect, useId, useRef } from "react";
import "./styles/modal.css";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement>;
  children: React.ReactNode;
};

function getFocusable(container: HTMLElement) {
  const selectors = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  return Array.from(container.querySelectorAll<HTMLElement>(selectors))
    .filter(el => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"));
}

export function Modal({ open, title, onClose, returnFocusRef, children }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusables = getFocusable(dialog);
    (focusables[0] ?? dialog).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const items = getFocusable(dialog);
        if (items.length === 0) return;

        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active) return;

        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    returnFocusRef?.current?.focus?.();
  }, [open, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      aria-hidden="false"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <button data-modal onClick={onClose} aria-label="Close modal">
            X
          </button>
        </div>

        <div className="modal-content">
          <div data-modal>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
