"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button, Input, Label, Alert } from "@/components/ui";

const initial: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Toy Inventory & Sales</h1>
          <p className="text-muted text-sm mt-1">Sign in to your account</p>
        </div>
        <form action={formAction} className="bg-surface border border-border rounded-lg shadow-sm p-6 space-y-4">
          {state.error && <Alert variant="error">{state.error}</Alert>}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
