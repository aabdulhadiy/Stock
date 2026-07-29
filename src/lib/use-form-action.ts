"use client";

import * as React from "react";
import type { FormState } from "@/lib/forms";

/**
 * Submit a Server Action and react to its result in the same place.
 *
 * `useActionState` is the right tool when a form only needs to render its
 * result. It is the wrong tool when success has a side effect on local UI —
 * closing an inline editor, clearing repeatable rows — because the only way to
 * observe "it succeeded" is an effect that sets state, which cascades renders
 * (and React's lint rules rightly flag it).
 *
 * Awaiting the action inside a transition instead gives us the result directly,
 * so the state update happens in an event handler where it belongs.
 */
export function useFormAction<S extends FormState>(
  action: (prev: S, formData: FormData) => Promise<S>,
  initial: S,
  options: { onSuccess?: (state: S) => void; resetOnSuccess?: boolean } = {},
) {
  const { onSuccess, resetOnSuccess = true } = options;
  const [state, setState] = React.useState<S>(initial);
  const [pending, startTransition] = React.useTransition();

  const submit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // Capture the element now: `currentTarget` is nulled once we await.
      const form = event.currentTarget;
      const data = new FormData(form);

      startTransition(async () => {
        const next = await action(state, data);
        setState(next);
        if (next.ok) {
          if (resetOnSuccess) form.reset();
          onSuccess?.(next);
        }
      });
    },
    [action, state, onSuccess, resetOnSuccess],
  );

  return { state, pending, submit, setState };
}
