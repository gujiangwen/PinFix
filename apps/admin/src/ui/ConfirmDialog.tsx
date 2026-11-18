import { useEffect, useId, useRef, type ReactNode } from "react";
import { lightDismiss } from "./dialog";

/**
 * Modal confirmation for a destructive action. Focus starts on Cancel, so
 * Enter or Space pressed by habit does not confirm; Esc and a backdrop click
 * both cancel.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      // React's autoFocus focuses on mount, which is before the dialog opens;
      // showModal() looks for the real attribute.
      cancelRef.current?.setAttribute("autofocus", "");
      dialog.returnValue = "";
      dialog.showModal();
    }
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      {...lightDismiss}
      onClose={(event) => {
        if (event.currentTarget.returnValue === "confirm") props.onConfirm();
        else props.onCancel();
      }}
    >
      <form method="dialog">
        <h2 id={titleId}>{props.title}</h2>
        <div className="confirm-body">{props.children}</div>
        <div className="row confirm-actions">
          <button ref={cancelRef} className="btn secondary" value="cancel">
            {props.cancelLabel}
          </button>
          <button className="btn danger" value="confirm">
            {props.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
