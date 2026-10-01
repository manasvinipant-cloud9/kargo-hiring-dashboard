import { NextResponse } from "next/server";
import { COOKIE, authConfigured, makeSession, passwordMatches } from "@/lib/auth";

export async function POST(req: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "APP_PASSWORD is not set on the server, so the dashboard is locked. Add it in the environment variables and redeploy." }, { status: 503 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !(await passwordMatches(password))) {
    await new Promise((r) => setTimeout(r, 600)); // slows down password guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const s = await makeSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, s.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: s.maxAge });
  return res;
}
