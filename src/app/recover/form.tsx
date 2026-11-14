"use client";
import { recoverAction } from "../actions";
import { ActionForm, Field, Submit } from "@/components/forms";

export function RecoverForm() {
  return (
    <ActionForm action={recoverAction} className="mt-6 space-y-4" resetOnSuccess>
      <Field label="Recovery code">
        <input name="code" className="input" required autoComplete="off" autoCapitalize="none" />
      </Field>
      <Field label="Parent username">
        <input name="username" className="input" required autoCapitalize="none" autoComplete="username" />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <input name="password" type="password" className="input" required minLength={8} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <input name="confirm" type="password" className="input" required minLength={8} autoComplete="new-password" />
      </Field>
      <Submit className="w-full">Reset password</Submit>
    </ActionForm>
  );
}
