import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export interface SessionData {
  userId: string;
  name: string;
  email: string;
  slug: string;
  sessionVersion?: number;
}

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error(
    "[session] SESSION_SECRET must be set and at least 32 characters. " +
      "Generate one: openssl rand -base64 32"
  );
}

export const sessionOptions: SessionOptions = {
  cookieName: "hustle_receipt_session",
  password: secret,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession() {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions
  );

  if (session.userId) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { sessionVersion: true },
    });

    if (!user || session.sessionVersion !== user.sessionVersion) {
      session.destroy();
      return session;
    }
  }

  return session;
}
