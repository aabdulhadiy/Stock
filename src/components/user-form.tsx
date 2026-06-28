"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Input, Label, Select, Alert } from "@/components/ui";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function UserForm({
  action,
  shops,
}: {
  action: Action;
  shops: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [role, setRole] = useState("SALES_MANAGER");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // On success, clear the native form fields. `role` is left as-is (the
    // controlled select keeps its value), which is fine for adding several
    // users in a row.
    if (state.ok) ref.current?.reset();
  }, [state.ok]);
  const fe = state.fieldErrors ?? {};

  return (
    <form ref={ref} action={formAction} className="space-y-4">
      {state.ok && <Alert variant="success">User created.</Alert>}
      {state.error && <Alert variant="error">{state.error}</Alert>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required />
          {fe.name && <p className="text-xs text-red-600 mt-1">{fe.name}</p>}
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
          {fe.email && <p className="text-xs text-red-600 mt-1">{fe.email}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="ADMIN">Admin</option>
            <option value="WAREHOUSE">Warehouse</option>
            <option value="SALES_MANAGER">Sales Manager</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="shopId">Shop {role === "SALES_MANAGER" ? "" : "(N/A)"}</Label>
          <Select id="shopId" name="shopId" disabled={role !== "SALES_MANAGER"} defaultValue="">
            <option value="">{role === "SALES_MANAGER" ? "Select a shop…" : "—"}</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {fe.shopId && <p className="text-xs text-red-600 mt-1">{fe.shopId}</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="password">Temporary password</Label>
        <Input id="password" name="password" type="text" minLength={8} required />
        {fe.password && <p className="text-xs text-red-600 mt-1">{fe.password}</p>}
        <p className="text-xs text-muted mt-1">At least 8 characters. Share it with the user securely.</p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create user"}
      </Button>
    </form>
  );
}
