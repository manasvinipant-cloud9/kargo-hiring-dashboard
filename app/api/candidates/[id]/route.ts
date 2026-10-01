import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { EMAIL_RE, LIST_COLUMNS, withDerived } from "@/lib/candidates";

const TEXT_LIMITS: Record<string, number> = { invite_subject: 300, rejection_subject: 300, invite_body: 6000, rejection_body: 6000, full_name: 120 };
const DECISIONS = ["pending", "invite", "reject"];
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return bad("Invalid request");

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "decision") {
      if (typeof v !== "string" || !DECISIONS.includes(v)) return bad("decision must be pending, invite or reject");
      patch.decision = v;
    } else if (k === "email") {
      const e = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (e && (!EMAIL_RE.test(e) || e.length > 254)) return bad("That doesn't look like a valid email address");
      patch.email = e || null;
    } else if (k in TEXT_LIMITS) {
      if (typeof v !== "string" && v !== null) return bad(`${k} must be text`);
      const t = typeof v === "string" ? v.trim() : "";
      if (t.length > TEXT_LIMITS[k]) return bad(`${k} is too long`);
      patch[k] = k === "full_name" ? t || null : t;
    }
    // Anything else (scores, status, send state) is not editable from the browser.
  }
  if (!Object.keys(patch).length) return bad("Nothing to update");

  const supabase = db();
  const { data: cur, error: curErr } = await supabase.from("candidates").select("email_status").eq("id", id).single();
  if (curErr || !cur) return bad("Candidate not found", 404);
  if (cur.email_status === "sent") return bad("This candidate has already been emailed, so their record is locked.", 409);

  const { data, error } = await supabase.from("candidates").update(patch).eq("id", id).select(LIST_COLUMNS).single();
  if (error) return bad(error.message, 500);
  return NextResponse.json(withDerived(data as unknown as { status: string; updated_at: string }));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await db().from("candidates").delete().eq("id", id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
