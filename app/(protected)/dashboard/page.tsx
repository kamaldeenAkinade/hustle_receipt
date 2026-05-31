import { getSession } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";
import { TipsDashboard } from "./TipsDashboard";
import Link from "next/link";

export const metadata = { title: "Dashboard — The Hustle Receipt" };

export default async function DashboardPage() {
  const session = await getSession();
  const tipPageUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/tip/${session.slug}`;

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Hey, {session.name} 👋
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Here&apos;s your hustle receipt.
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            >
              Sign out
            </button>
          </form>
        </div>

        {/* Tip Page Link */}
        <div className="mb-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <p className="text-sm font-medium text-emerald-400 mb-2">
            Your tip page
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <code className="text-sm text-zinc-300 break-all">
              {tipPageUrl}
            </code>
            <Link
              href={`/tip/${session.slug}`}
              target="_blank"
              className="shrink-0 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 transition"
            >
              Preview ↗
            </Link>
          </div>
        </div>

        {/* React Query dashboard */}
        <TipsDashboard />
      </div>
    </main>
  );
}
