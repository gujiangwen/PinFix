import type { MouseEvent } from "react";

const supportsClosedBy =
  typeof HTMLDialogElement !== "undefined" &&
  "closedBy" in HTMLDialogElement.prototype;

/**
 * Props that let a modal `<dialog>` close on a backdrop click (Esc already
 * closes it). Browsers with `closedby` do it natively; for the rest, a click
 * whose target is the dialog element itself and whose position is outside
 * its box can only have landed on the backdrop.
 */
export const lightDismiss = {
  closedby: "any" as const,
  onClick(event: MouseEvent<HTMLDialogElement>) {
    if (supportsClosedBy || event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) event.currentTarget.close();
  },
};
