import Link from "next/link";
import { recoveryEnabled } from "@/server/recovery";
import { RecoverForm } from "./form";

export const dynamic = "force-dynamic";

export default function RecoverPage() {
  const enabled = recoveryEnabled();
  return (
    <main className="mx-auto max-w-sm px-6 py-12">
      <h1 className="text-[1.7rem] font-semibold">Recover a parent account</h1>
      {enabled ? (
        <>
          <p className="mt-2 text-muted">
            For when both parents are locked out. You'll need the recovery code saved in your hosting settings (Vercel, Environment Variables, RECOVERY_TOKEN).
          </p>
          <RecoverForm />
        </>
      ) : (
        <p className="mt-2 text-muted">
          Recovery isn't switched on. To use it, add a setting called RECOVERY_TOKEN in Vercel (Environment Variables) and redeploy.
        </p>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-euc">Back to sign in</Link>
      </p>
    </main>
  );
}
