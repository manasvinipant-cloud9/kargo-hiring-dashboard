// Trigger -> Input -> Context -> Processing -> AI, for one CV per request (keeps each call under serverless time limits).
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { extractDocument, extractPII, redact } from "@/lib/extract";
import { MAX_CV_CHARS } from "@/lib/gemini";
import { scoreAndSave } from "@/lib/pipeline";
import type { Role } from "@/lib/rubric";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // Vercel rejects request bodies over ~4.5MB
const fail = (error: string, status: number, extra: object = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const requested = String(form?.get("role") || "") as Role | "AUTO";
  if (!(file instanceof File)) return fail("No file received", 400);
  if (requested !== "PM" && requested !== "SPM" && requested !== "AUTO") return fail("Role must be PM, SPM or AUTO", 400);
  if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) return fail(`${file.name}: only PDF, DOCX or TXT files are supported`, 415);
  if (file.size === 0) return fail(`${file.name} is empty`, 422);
  if (file.size > MAX_BYTES) return fail(`${file.name} is larger than 4 MB`, 413);

  let supabase;
  try { supabase = db(); } catch (e) { return fail((e as Error).message, 500); }
  // "AUTO": applied role unknown; filed as PM for now and moved to whichever rubric fits better once scored.
  const role: Role = requested === "AUTO" ? "PM" : requested;
  const { data: row, error: insErr } = await supabase
    .from("candidates").insert({ file_name: file.name, applied_role: role, status: "processing" }).select("id").single();
  if (insErr || !row) return fail(insErr?.message ?? "Could not create the candidate record", 500);

  const t0 = Date.now();
  try {
    const { text, links } = await extractDocument(file.name, Buffer.from(await file.arrayBuffer()));
    const tExtract = Date.now() - t0;
    if (text.length < 200) throw new Error("Could not read enough text from this file (is it a scanned image?)");
    const pii = extractPII(text, file.name, links);
    const redacted = redact(text, pii);
    if (redacted.length > MAX_CV_CHARS) throw new Error(`This CV is too long to score (limit ${MAX_CV_CHARS.toLocaleString()} characters).`);

    // The same CV uploaded twice (same file name or same email, identical text) must not appear twice in the ranking.
    for (const q of [supabase.from("candidates").select("id,full_name,redacted_text").eq("file_name", file.name), pii.email ? supabase.from("candidates").select("id,full_name,redacted_text").eq("email", pii.email) : null]) {
      if (!q) continue;
      const { data } = await q.neq("id", row.id).eq("status", "scored");
      const same = data?.find((d) => d.redacted_text === redacted);
      if (same) {
        await supabase.from("candidates").delete().eq("id", row.id);
        return NextResponse.json({ id: same.id, name: same.full_name, duplicate: true });
      }
    }

    // Save contact details and the redacted text first, so a scoring failure can be retried without re-uploading.
    const { error: saveErr } = await supabase.from("candidates")
      .update({ full_name: pii.fullName, email: pii.email, phone: pii.phone, redacted_text: redacted }).eq("id", row.id);
    if (saveErr) throw new Error(`Could not save the extracted text: ${saveErr.message}`);

    const { role: finalRole, score } = await scoreAndSave(supabase, row.id, redacted, requested);
    console.info(`[process] ${file.name}: extract ${tExtract}ms, total ${Date.now() - t0}ms`);
    return NextResponse.json({ id: row.id, name: pii.fullName, role: finalRole, score, noEmail: !pii.email });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.warn(`[process] ${file.name} failed after ${Date.now() - t0}ms: ${msg}`);
    await supabase.from("candidates").update({ status: "error", error: msg }).eq("id", row.id);
    return fail(msg, 500, { id: row.id });
  }
}
