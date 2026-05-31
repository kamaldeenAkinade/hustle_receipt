import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TipForm from "./TipForm";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const creator = await prisma.user.findUnique({
    where: { slug },
    select: { name: true },
  });
  if (!creator) return { title: "Not Found" };
  return {
    title: `Tip ${creator.name} — The Hustle Receipt`,
    description: `Support ${creator.name} by sending a tip.`,
  };
}

export default async function TipPage({ params }: Props) {
  const { slug } = await params;

  const creator = await prisma.user.findUnique({
    where: { slug },
    select: {
      name: true,
      bio: true,
      slug: true,
      _count: { select: { tips: { where: { status: "success" } } } },
    },
  });

  if (!creator) notFound();

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-12">
      <div className="max-w-lg mx-auto">
        {/* Creator card */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-2xl font-bold text-zinc-950">
            {creator.name[0].toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold text-white">{creator.name}</h1>
          {creator.bio && (
            <p className="mt-2 text-sm text-zinc-400 max-w-xs mx-auto">
              {creator.bio}
            </p>
          )}
          <p className="mt-2 text-xs text-zinc-600">
            {creator._count.tips} tip{creator._count.tips !== 1 ? "s" : ""} received
          </p>
        </div>

        {/* Tip form */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-xl">
          <h2 className="text-base font-semibold text-zinc-200 mb-6">
            Send {creator.name} a tip
          </h2>
          <TipForm slug={slug} creatorName={creator.name} />
        </div>

        <p className="mt-6 text-center text-xs text-zinc-700">
          <a href="/" className="hover:text-zinc-500 transition">
            Create your own tip page →
          </a>
        </p>
      </div>
    </main>
  );
}
