import { NextResponse } from "next/server";
import { mailStatus } from "@/lib/email";
import { openAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

// What the dashboard needs to explain itself: is email live, is it redirected, is the review digest available.
export async function GET() {
  const m = mailStatus();
  return NextResponse.json({
    emailConfigured: m.configured,
    testRedirect: m.testRedirect,
    reviewAvailable: Boolean(m.reviewTo && m.configured),
    openAccess: openAccess(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    databaseConfigured: Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
  });
}
