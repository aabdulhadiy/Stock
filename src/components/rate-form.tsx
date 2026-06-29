"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Input, Label, Alert } from "@/components/ui";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function RateForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={formAction} className="space-y-3 max-w-xs">
      {state.ok && <Alert variant="success">New rate saved.</Alert>}
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <div>
        <Label htmlFor="rate">New rate (UZS per 1 USD)</Label>
        <Input id="rate" name="rate" type="number" min={1} step="0.0001" required />
        {state.fieldErrors?.rate && (
          <p className="text-xs text-red-600 mt-1">{state.fieldErrors.rate}</p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set rate"}
      </Button>
    </form>
  );
}
