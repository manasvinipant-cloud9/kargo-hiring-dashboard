// Column list for the dashboard (everything except the stored CV text, which is large and never shown).
export const LIST_COLUMNS =
  "id,created_at,updated_at,file_name,applied_role,full_name,email,phone,status,error,pm_score,spm_score,pm_breakdown,spm_breakdown," +
  "years_pm_experience,summary,best_fit_role,recommendation,interview_brief,invite_subject,invite_body,rejection_subject,rejection_body," +
  "decision,email_status,email_sent_at,email_error,sent_email_type";

// A scoring call is bounded to ~60s. A row still "processing" after this was killed by the platform.
export const STALE_MS = 2.5 * 60 * 1000;

export function withDerived<T extends { status: string; updated_at: string }>(row: T): T & { stalled: boolean } {
  return { ...row, stalled: row.status === "processing" && Date.now() - new Date(row.updated_at).getTime() > STALE_MS };
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
