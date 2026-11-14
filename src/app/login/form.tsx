"use client";
import { loginAction } from "../actions";
import { ActionForm, Field, Submit } from "@/components/forms";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <Field label="Username">
        <input name="username" className="input" autoComplete="username" autoCapitalize="none" required />
      </Field>
      <Field label="Password">
        <input name="password" type="password" className="input" autoComplete="current-password" required />
      </Field>
      <Submit className="w-full">Sign in</Submit>
      <p className="text-center text-sm text-muted">Forgotten your password? Ask a parent to reset it.</p>
    </ActionForm>
  );
}
