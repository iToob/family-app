import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getSession } from "@/server/auth";
import { householdExists } from "@/server/household";

export const dynamic = "force-dynamic";

export default async function Root() {
  const s = await getSession();
  if (s) redirect(s.actor.role === "PARENT" ? "/admin" : "/home");
  if (!(await householdExists(getDb()))) redirect("/setup");
  redirect("/login");
}
