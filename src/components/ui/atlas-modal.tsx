"use client";

import {
  createContext,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";

type AtlasModalSize = "small" | "medium" | "large";

const ModalContext = createContext<(() => void) | null>(null);
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function AtlasModal({
  open,
  onClose,
  title,
  description,
  size = "medium",
  closeOnBackdrop = true,
  focusKey,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: AtlasModalSize;
  closeOnBackdrop?: boolean;
  focusKey?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(
      "[data-autofocus], " + focusableSelector,
    );
    window.requestAnimationFrame(() => (first ?? dialog)?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter(element => !element.hidden);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        firstElement.focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = bodyOverflow;
      window.requestAnimationFrame(() => opener?.focus());
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || focusKey === undefined) return;
    window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      dialog?.querySelector<HTMLElement>(
        "[data-autofocus], " + focusableSelector,
      )?.focus();
    });
  }, [focusKey, open]);

  if (!open || typeof document === "undefined") return null;

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && event.currentTarget === event.target) onClose();
  };

  return createPortal(
    <ModalContext.Provider value={onClose}>
      <div className="atlas-modal-backdrop" onMouseDown={handleBackdrop}>
        <div
          ref={dialogRef}
          className={`atlas-modal atlas-modal-${size}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
        >
          <span id={titleId} className="sr-only">{title}</span>
          {description ? (
            <span id={descriptionId} className="sr-only">{description}</span>
          ) : null}
          {children}
        </div>
      </div>
    </ModalContext.Provider>,
    document.body,
  );
}

export function AtlasModalHeader({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <header className={`atlas-modal-header ${className}`} {...props}>{children}</header>;
}

export function AtlasModalBody({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`atlas-modal-body ${className}`} {...props}>{children}</div>;
}

export function AtlasModalFooter({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <footer className={`atlas-modal-footer ${className}`} {...props}>{children}</footer>;
}

export function AtlasModalClose({
  children = "×",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const close = useContext(ModalContext);
  return (
    <button
      {...props}
      type="button"
      className={`atlas-modal-close ${className}`}
      aria-label="Fechar"
      onClick={event => {
        props.onClick?.(event);
        if (!event.defaultPrevented) close?.();
      }}
    >
      {children}
    </button>
  );
}
