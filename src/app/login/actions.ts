"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and password" };
  }

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    return { error: "Invalid email or password" };
  }

  await createSession(user);
  redirect("/dashboard");
}
