import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Flutterwave sends the raw webhook secret in the "verif-hash" header.
// Set FLW_WEBHOOK_SECRET in .env.local to the value from your FLW dashboard
// under Settings → Webhooks → Secret Hash.
export async function POST(req: NextRequest) {
  const secret = process.env.FLW_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] FLW_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const hash = req.headers.get("verif-hash");
  if (!hash || hash !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = body.event as string | undefined;
  const data = body.data as Record<string, unknown> | undefined;

  // Always acknowledge — return 200 even for unknown events so FLW stops retrying
  if (!event || !data) {
    return NextResponse.json({ ok: true });
  }

  const txRef = data.tx_ref as string | undefined;
  if (!txRef) {
    return NextResponse.json({ ok: true });
  }

  const tip = await prisma.tip.findUnique({ where: { txRef } });
  if (!tip) {
    // Not our transaction — acknowledge and ignore
    return NextResponse.json({ ok: true });
  }

  // charge.completed with status "successful" → mark success
  if (event === "charge.completed" && data.status === "successful") {
    await prisma.tip.updateMany({
      where: { txRef, status: "pending" },
      data: { status: "success" },
    });
    return NextResponse.json({ ok: true });
  }

  // Any explicit failure or reversal event → downgrade the tip
  const isFailure =
    event === "charge.failed" ||
    event === "charge.reversed" ||
    (event === "charge.completed" && data.status !== "successful");

  if (isFailure) {
    await prisma.tip.updateMany({
      where: { txRef, status: { not: "failed" } },
      data: { status: "failed" },
    });
  }

  return NextResponse.json({ ok: true });
}
