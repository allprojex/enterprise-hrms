import * as React from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Question naming the action, e.g. "Archive department?". */
  title: string;
  /** What the backend actually does — never "delete" for an archive, revoke or end-date. */
  description: React.ReactNode;
  /** Verb + object, e.g. "Archive Department". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `destructive` for removals and archives; `default` for restorative actions such as reactivate. */
  tone?: 'destructive' | 'default';
  /**
   * Runs the action. Return the mutation promise (`mutateAsync`) so the dialog
   * stays open and busy while it runs, closes only once it resolves, and stays
   * open — with the caller's own error toast — when it rejects. A synchronous
   * handler (e.g. opening a follow-up form) closes the dialog immediately.
   */
  onConfirm: () => unknown;
  /** Optional extra content under the description (warnings, counts). */
  children?: React.ReactNode;
  /** Base test id: the dialog gets it, buttons get `-confirm` / `-cancel`. */
  testId?: string;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === 'function';
}

/**
 * The platform's single confirmation step for destructive and lifecycle
 * actions (archive, deactivate, remove, revoke, retire, cancel, delete).
 * Nothing runs until the explicit confirm button is pressed; Cancel runs
 * nothing. A synchronous in-flight guard means a double click can never fire
 * the action twice, even before the mutation's pending state re-renders.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
  onConfirm,
  children,
  testId = 'confirm-action',
}: ConfirmActionDialogProps) {
  const inFlight = React.useRef(false);
  const [submitting, setSubmitting] = React.useState(false);
  // Dialogs here are opened from state rather than an AlertDialogTrigger, so
  // Radix has no trigger to hand focus back to; remember the opener ourselves.
  const returnFocusTo = React.useRef<HTMLElement | null>(null);

  // Callers usually derive the wording from a target they clear on close, so
  // during the exit animation the props already describe "nothing" (e.g. a
  // Reactivate dialog would flash "Archive …?" in red). Keep showing what the
  // dialog said while it was open; capture it whenever it opens or its
  // wording changes while open.
  const live = { title, description, confirmLabel, tone, testId, children };
  const [shown, setShown] = React.useState(live);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open) {
    const wordingChanged =
      shown.title !== title || shown.confirmLabel !== confirmLabel || shown.tone !== tone || shown.testId !== testId;
    if (!wasOpen || wordingChanged) {
      setWasOpen(true);
      setShown(live);
    }
  } else if (wasOpen) {
    setWasOpen(false);
  }
  const view = open ? live : shown;

  const handleOpenChange = (next: boolean) => {
    if (!next && inFlight.current) return;
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = onConfirm();
      if (isPromiseLike(result)) await result;
      inFlight.current = false;
      onOpenChange(false);
    } catch {
      // The caller's mutation onError reports the failure; keep the dialog
      // open so nothing looks removed that the server did not remove.
      inFlight.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        data-testid={view.testId}
        onOpenAutoFocus={() => {
          returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          const opener = returnFocusTo.current;
          returnFocusTo.current = null;
          if (opener?.isConnected) {
            event.preventDefault();
            opener.focus({ preventScroll: true });
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{view.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {typeof view.description === 'string' ? <p>{view.description}</p> : view.description}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {view.children}
        <AlertDialogFooter>
          {/* Radix AlertDialog moves initial focus to its Cancel part (and
              traps focus inside the dialog from there); a plain button would
              leave focus on the page behind the modal. */}
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={submitting} data-testid={`${view.testId}-cancel`}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant={view.tone === 'destructive' ? 'destructive' : 'default'}
            loading={submitting}
            onClick={handleConfirm}
            data-testid={`${view.testId}-confirm`}
          >
            {view.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
