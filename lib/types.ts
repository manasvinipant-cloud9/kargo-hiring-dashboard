import type { Role, CriterionScore } from "./rubric";

export type Decision = "pending" | "invite" | "reject";

export type Candidate = {
  id: string;
  created_at: string;
  updated_at: string;
  file_name: string;
  applied_role: Role;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: "processing" | "scored" | "error";
  error: string | null;
  pm_score: number | null;
  spm_score: number | null;
  pm_breakdown: CriterionScore[] | null;
  spm_breakdown: CriterionScore[] | null;
  years_pm_experience: number | null;
  summary: string | null;
  best_fit_role: Role | null;
  recommendation: "interview" | "maybe" | "reject" | null;
  interview_brief: { why_ranked_here: string; strengths: string[]; concerns: string[]; probe_questions: string[] } | null;
  invite_subject: string | null;
  invite_body: string | null;
  rejection_subject: string | null;
  rejection_body: string | null;
  decision: Decision;
  email_status: "draft" | "sent" | "failed";
  email_sent_at: string | null;
  email_error: string | null;
  sent_email_type: "invite" | "rejection" | null;
  /** Derived by the server: still "processing" long after it should have finished. */
  stalled?: boolean;
};

export type AppConfig = {
  emailConfigured: boolean;
  testRedirect: string | null;
  reviewAvailable: boolean;
  openAccess: boolean;
  /** Open demo without test mode: sending real email is switched off. */
  sendBlocked: boolean;
  geminiConfigured: boolean;
  databaseConfigured: boolean;
};
