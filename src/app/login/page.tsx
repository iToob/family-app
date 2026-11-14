import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const s = await getSession();
  if (s) redirect(s.actor.role === "PARENT" ? "/admin" : "/home");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="banknote mb-8 px-6 py-7">
        <div className="relative">
          <img src="/icon.svg" alt="" className="mb-4 h-11 w-11 rounded-xl" />
          <h1 className="text-[1.9rem] font-semibold text-white">Family Economy</h1>
          <p className="mt-1 text-[#cfe0da]">Earn it, save it, spend it.</p>
        </div>
      </div>
      <LoginForm />
    </main>
  );
}
