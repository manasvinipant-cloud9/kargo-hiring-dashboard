// Emails Arjun a short digest of the ranked shortlist, with a link back to the dashboard.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { sendEmail, mailStatus } from "@/lib/email";
import { sendBlockedInOpenMode } from "@/lib/auth";

const NAMES = { PM: "Product Manager", SPM: "Senior Product Manager" } as const;

export async function POST(req: Request) {
  if (sendBlockedInOpenMode()) return NextResponse.json({ error: "Email is off in the open demo." }, { status: 403 });
  const m = mailStatus();
  if (!m.reviewTo) return NextResponse.json({ error: "Set ARJUN_EMAIL to use this." }, { status: 400 });
  const { data, error } = await db().from("candidates")
    .select("full_name,file_name,applied_role,pm_score,spm_score,recommendation,decision,email_status,summary").eq("status", "scored");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  const lines = [`${rows.length} applications screened and ranked.`, ""];
  for (const role of ["SPM", "PM"] as const) {
    const g = rows.filter((r) => r.applied_role === role).sort((a, b) => ((role === "PM" ? b.pm_score : b.spm_score) ?? 0) - ((role === "PM" ? a.pm_score : a.spm_score) ?? 0));
    lines.push(`${NAMES[role]}: ${g.length} applicants, ${g.filter((r) => r.recommendation === "interview").length} suggested for interview`);
    g.slice(0, 5).forEach((r, i) => lines.push(`  ${i + 1}. ${r.full_name || r.file_name} (${role === "PM" ? r.pm_score : r.spm_score}/100, suggests ${r.recommendation})`));
    lines.push("");
  }
  const waiting = rows.filter((r) => r.decision === "pending").length;
  lines.push(`${waiting} are waiting for your decision. Nothing goes to candidates until you choose Invite or Reject and press Send.`, "", `Open the dashboard: ${new URL(req.url).origin}`);
  try {
    await sendEmail({ to: m.reviewTo, subject: `Kargo hiring: ${rows.length} ranked, ${waiting} waiting for you`, body: lines.join("\n") });
    return NextResponse.json({ ok: true, to: m.reviewTo });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
