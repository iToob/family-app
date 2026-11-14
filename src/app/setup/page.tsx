import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { householdExists } from "@/server/household";
import { SetupForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await householdExists(getDb())) redirect("/login");
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-[1.9rem] font-semibold">Set up your Family Economy</h1>
      <p className="mt-2 text-muted">
        This creates your household and the first parent account. You'll add your partner and children next.
      </p>
      <SetupForm />
    </main>
  );
}
