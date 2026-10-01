// The only path that sends candidate email: an explicit click by the founder after choosing Invite or Reject.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";
import { fillVars } from "@/lib/fill";
import { EMAIL_RE, LIST_COLUMNS, withDerived } from "@/lib/candidates";

export const maxDuration = 30;
const bad = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = db();
  const { data: c, error } = await supabase.from("candidates").select("*").eq("id", id).single();
  if (error || !c) return bad("Candidate not found", 404);
  if (c.status !== "scored") return bad("This candidate hasn't been scored yet, so there is no email to send.", 400);
  if (c.decision === "pending") return bad("Choose Invite or Reject first", 400);
  if (c.email_status === "sent") return bad("Email already sent", 409);
  if (!c.email || !EMAIL_RE.test(c.email)) return bad("No valid email address on this CV. Add one first.", 400);

  const type = c.decision === "invite" ? "invite" : "rejection";
  const subject = fillVars(c[`${type}_subject`], c).trim();
  const body = fillVars(c[`${type}_body`], c).trim();
  if (!subject || !body) return bad("The email draft is empty.", 400);

  // Claim the send atomically. Of two simultaneous requests (double-click, "send all" plus a manual send)
  // only one flips the row to "sent" and goes on to email the candidate; the other gets a 409.
  const { data: claimed, error: claimErr } = await supabase
    .from("candidates")
    .update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null, sent_email_type: type })
    .eq("id", id).neq("email_status", "sent").select("id");
  if (claimErr) return bad(claimErr.message, 500);
  if (!claimed?.length) return bad("Email already sent", 409);

  try {
    const sent = await sendEmail({ to: c.email, subject, body, idempotencyKey: `kargo-${id}-${type}` });
    const { data } = await supabase.from("candidates").select(LIST_COLUMNS).eq("id", id).single();
    return NextResponse.json({ ...withDerived(data as unknown as { status: string; updated_at: string }), deliveredTo: sent.deliveredTo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("candidates").update({ email_status: "failed", email_sent_at: null, email_error: msg, sent_email_type: null }).eq("id", id);
    return bad(msg, 502);
  }
}
