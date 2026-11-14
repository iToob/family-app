"use client";
import { setupAction } from "../actions";
import { ActionForm, Field, Submit } from "@/components/forms";

export function SetupForm() {
  return (
    <ActionForm action={setupAction} className="mt-8 space-y-4">
      <Field label="Setup code" hint="The SETUP_TOKEN value from your server settings. It stops anyone else claiming your app.">
        <input name="token" className="input" required autoComplete="off" />
      </Field>
      <Field label="Household name">
        <input name="householdName" className="input" placeholder="The Smith Family" required />
      </Field>
      <Field label="Exchange rate" hint="How many Points make one Australian dollar. Once the economy is live this can be raised but never lowered.">
        <div className="flex items-center gap-2">
          <input name="pointsPerDollar" className="input w-24" inputMode="numeric" defaultValue="10" required />
          <span>Points = $1.00</span>
        </div>
      </Field>
      <hr className="border-line" />
      <h2 className="text-lg font-semibold">Your account</h2>
      <Field label="Your name">
        <input name="displayName" className="input" placeholder="Dad" required />
      </Field>
      <Field label="Username">
        <input name="username" className="input" autoCapitalize="none" autoComplete="username" required />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <input name="password" type="password" className="input" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm password">
        <input name="confirm" type="password" className="input" autoComplete="new-password" required minLength={8} />
      </Field>
      <Submit className="w-full">Create household</Submit>
    </ActionForm>
  );
}
