import { prisma } from "@/lib/prisma";
import { flwFetch } from "@/lib/flutterwave";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment — The Hustle Receipt" };

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Verify via Flutterwave v4 GET /charges/{id}
// Always calls Flutterwave regardless of current status — catches post-settlement reversals.
async function verifyAndSaveTip(txRef: string): Promise<boolean> {
  const tip = await prisma.tip.findUnique({ where: { txRef } });
  if (!tip) return false;

  // No charge ID means payment never reached Flutterwave — can't verify
  if (!tip.flwTxId) return tip.status === "success";

  let res: Response;
  let json: Record<string, unknown>;
  try {
    res = await flwFetch(`/charges/${tip.flwTxId}`);
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // Network failure — preserve current status so a retry can succeed
    return tip.status === "success";
  }

  // Transient Flutterwave error (5xx) — do not poison the record
  if (!res.ok) return tip.status === "success";

  const data = json.data as Record<string, unknown> | undefined;

  // v4 success status is "succeeded" (not "successful" like v3)
  if (data?.status === "succeeded" && data?.reference === txRef) {
    // Atomic write: only promotes pending → success; skips if already success
    // (prevents double side-effects when two requests race on the same txRef)
    await prisma.tip.updateMany({
      where: { txRef, status: "pending" },
      data: { status: "success" },
    });
    return true;
  }

  // Flutterwave explicitly says the charge did not succeed or has reversed —
  // downgrade if not already failed (handles post-settlement reversal)
  await prisma.tip.updateMany({
    where: { txRef, status: { not: "failed" } },
    data: { status: "failed" },
  });
  return false;
}

export default async function SuccessPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;

  const creator = await prisma.user.findUnique({
    where: { slug },
    select: { name: true },
  });

  // Our redirect_url is: /tip/[slug]/success?ref={txRef}
  // Flutterwave may append extra params — we only need `ref`
  const txRef = sp.ref as string | undefined;

  if (!txRef) {
    return (
      <ResultPage
        success={false}
        creatorSlug={slug}
        creatorName={creator?.name}
        message="Payment reference missing. If you were charged, please contact support."
      />
    );
  }

  const verified = await verifyAndSaveTip(txRef);

  if (!verified) {
    return (
      <ResultPage
        success={false}
        creatorSlug={slug}
        creatorName={creator?.name}
        message="We could not verify your payment. If your card was charged, contact support with your transaction reference."
      />
    );
  }

  return (
    <ResultPage
      success
      creatorSlug={slug}
      creatorName={creator?.name}
      message={`Your tip to ${creator?.name ?? "the creator"} went through successfully!`}
    />
  );
}

function ResultPage({
  success,
  creatorSlug,
  creatorName,
  message,
}: {
  success: boolean;
  creatorSlug: string;
  creatorName?: string;
  message: string;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="max-w-md w-full">
        <div
          className={`mx-auto mb-6 h-16 w-16 rounded-full flex items-center justify-center text-3xl font-bold ${
            success
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {success ? "✓" : "✕"}
        </div>

        <h1
          className={`text-2xl font-bold ${
            success ? "text-white" : "text-zinc-300"
          }`}
        >
          {success ? "Thank you!" : "Payment not completed"}
        </h1>

        <p className="mt-3 text-sm text-zinc-400 max-w-sm mx-auto">
          {message}
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={`/tip/${creatorSlug}`}
            className={`rounded-xl px-6 py-3 text-sm font-semibold transition ${
              success
                ? "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            }`}
          >
            {success
              ? `Tip ${creatorName ?? "again"} again`
              : "Try again"}
          </Link>
          <Link
            href="/"
            className={`rounded-xl px-6 py-3 text-sm font-semibold transition ${
              success
                ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                : "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
            }`}
          >
            {success ? "Create your tip page" : "Back to home"}
          </Link>
        </div>
      </div>
    </main>
  );
}
