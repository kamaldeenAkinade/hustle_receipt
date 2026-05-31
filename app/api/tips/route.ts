import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();

  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tips = await prisma.tip.findMany({
    where: {
      creatorId: session.userId,
      status: "success",
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const total = tips.reduce((sum, t) => sum + t.amount, 0);

  return NextResponse.json({
    tips: tips.map((t) => ({
      id: t.id,
      tipperName: t.tipperName,
      tipperEmail: t.tipperEmail,
      amount: t.amount,
      message: t.message,
      createdAt: t.createdAt.toISOString(),
    })),
    total,
    count: tips.length,
  });
}
