import { useEffect, type ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  errorMessage?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  confirmingLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  errorMessage = null,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isConfirming = false,
  confirmingLabel = "Removing...",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isConfirming) {
        onCancel();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isConfirming, onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={isConfirming ? undefined : onCancel}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-copy">
          <h2 id="confirm-dialog-title">{title}</h2>
          <div className="confirm-dialog-description">{description}</div>
          {errorMessage ? <p className="confirm-dialog-error">{errorMessage}</p> : null}
        </div>
        <div className="confirm-dialog-actions">
          <button className="card-action card-action-secondary" type="button" onClick={onCancel} disabled={isConfirming}>
            {cancelLabel}
          </button>
          <button className="card-action card-action-danger" type="button" onClick={() => void onConfirm()} disabled={isConfirming}>
            {isConfirming ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

