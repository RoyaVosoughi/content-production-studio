"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import type { ActionState } from "@/app/actions";

const PendingContext = createContext(false);

export function ActionForm({
  action,
  children,
  className,
  onInput,
  resetOnSuccess = false,
  id,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  onInput?: () => void;
  resetOnSuccess?: boolean;
  /** Lets fields elsewhere on the page belong to this form, with form={id}. */
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error && resetOnSuccess) formRef.current?.reset();
    wasPending.current = pending;
  }, [pending, state, resetOnSuccess]);

  // React clears a form passed to <form action>, even when the action fails. Submitting by hand
  // keeps what was typed, so a failed save or AI call never loses the user's work.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // The button that was pressed comes along, so a form with two buttons knows which one it was.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter instanceof HTMLButtonElement && submitter.name ? submitter : undefined);
    startTransition(() => formAction(data));
  }

  return (
    <PendingContext.Provider value={pending}>
      <form ref={formRef} id={id} onSubmit={handleSubmit} className={className} onInput={onInput}>
        {children}
        {state?.error && !pending && (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {state.error}
          </p>
        )}
      </form>
    </PendingContext.Provider>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  className = "btn-quiet",
  disabled,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
  /** Sent with the form when this button is the one pressed. */
  name?: string;
  value?: string;
}) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={`btn ${className}`}>
      <span className={pending ? "pending-pulse" : undefined} aria-live="polite">
        {pending ? pendingLabel : children}
      </span>
    </button>
  );
}
