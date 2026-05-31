import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getSession();
  if (session.userId) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="max-w-2xl w-full">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Accept tips. Build your hustle.
        </div>

        <h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl">
          The{" "}
          <span className="text-emerald-400">Hustle</span>
          {" "}Receipt
        </h1>

        <p className="mt-6 text-lg text-zinc-400 max-w-xl mx-auto">
          Create your free tip page in seconds. Share it with your audience.
          Get paid for your content, skills, and creativity.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup"
            className="rounded-xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            Get Your Tip Page — It&apos;s Free
          </Link>
          <Link
            href="/login"
            className="rounded-xl border border-zinc-700 px-8 py-3.5 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          >
            Sign In
          </Link>
        </div>

        <p className="mt-8 text-xs text-zinc-600">
          Powered by Flutterwave · Payments in Naira · No hidden fees
        </p>
      </div>
    </main>
  );
}
