"use client";
import { changePasswordAction } from "../actions";
import { ActionForm, Field, Submit } from "@/components/forms";

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="mt-6 space-y-4">
      <Field label="Current or temporary password">
        <input name="current" type="password" className="input" autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <input name="next" type="password" className="input" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm new password">
        <input name="confirm" type="password" className="input" autoComplete="new-password" required minLength={8} />
      </Field>
      <Submit className="w-full">Save password</Submit>
    </ActionForm>
  );
}
