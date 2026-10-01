// Re-run scoring for a candidate whose scoring failed or timed out. Uses the stored redacted text, so no re-upload.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { scoreAndSave } from "@/lib/pipeline";
import { LIST_COLUMNS, STALE_MS, withDerived } from "@/lib/candidates";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = db();
  const { data: c } = await supabase.from("candidates").select("id,status,applied_role,redacted_text,updated_at").eq("id", id).single();
  if (!c) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  const stalled = c.status === "processing" && Date.now() - new Date(c.updated_at).getTime() > STALE_MS;
  if (c.status === "scored") return NextResponse.json({ error: "Already scored" }, { status: 409 });
  if (c.status === "processing" && !stalled) return NextResponse.json({ error: "Still being scored. Give it a minute." }, { status: 409 });
  if (!c.redacted_text) return NextResponse.json({ error: "The CV text was never saved. Remove this entry and upload the file again." }, { status: 422 });

  await supabase.from("candidates").update({ status: "processing", error: null }).eq("id", id); // also refreshes updated_at
  try {
    await scoreAndSave(supabase, id, c.redacted_text, c.applied_role);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await supabase.from("candidates").update({ status: "error", error: msg }).eq("id", id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const { data } = await supabase.from("candidates").select(LIST_COLUMNS).eq("id", id).single();
  return NextResponse.json(withDerived(data as unknown as { status: string; updated_at: string }));
}
