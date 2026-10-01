// Processing -> AI -> save. Shared by first-time upload and by Retry.
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreCV } from "./gemini";
import { weightedTotal, recommend, type Role } from "./rubric";

export async function scoreAndSave(supabase: SupabaseClient, id: string, redacted: string, requested: Role | "AUTO") {
  const ai = await scoreCV(redacted, requested);
  const pmScore = weightedTotal("PM", ai.pm_scores);
  const spmScore = weightedTotal("SPM", ai.spm_scores);
  const best: Role = pmScore >= spmScore ? "PM" : "SPM";
  // "Not sure" files the candidate under whichever rubric they fit better.
  const role: Role = requested === "AUTO" ? best : requested;
  const applied = role === "PM" ? pmScore : spmScore;
  const { error } = await supabase
    .from("candidates")
    .update({
      applied_role: role,
      status: "scored",
      error: null,
      pm_score: pmScore,
      spm_score: spmScore,
      pm_breakdown: ai.pm_scores,
      spm_breakdown: ai.spm_scores,
      years_pm_experience: ai.years_pm_experience,
      summary: ai.summary,
      best_fit_role: best,
      recommendation: recommend(applied),
      interview_brief: ai.interview_brief,
      invite_subject: ai.invite_email.subject,
      invite_body: ai.invite_email.body,
      rejection_subject: ai.rejection_email.subject,
      rejection_body: ai.rejection_email.body,
    })
    .eq("id", id);
  // Without this check a failed save left the candidate on "Scoring…" forever.
  if (error) throw new Error(`Scored, but could not save the result: ${error.message}`);
  return { role, score: applied };
}
