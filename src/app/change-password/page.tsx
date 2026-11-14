import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { ChangePasswordForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return (
    <main className="mx-auto max-w-sm px-6 py-12">
      <h1 className="text-[1.7rem] font-semibold">{s.mustChangePassword ? `Welcome, ${s.actor.displayName}` : "Change password"}</h1>
      <p className="mt-2 text-muted">
        {s.mustChangePassword ? "Choose your own password to finish signing in." : "You'll stay signed in on this device. Other devices will be signed out."}
      </p>
      <ChangePasswordForm />
    </main>
  );
}
