// Runs the dashboard against fake Supabase/Resend seeded with a realistic mix of candidates in every state,
// so the UI can be explored without real accounts. Live Gemini is used if GEMINI_API_KEY is set (uploads work).
//   bash scripts/demo.sh
import { spawn } from "node:child_process";
import { RUBRICS } from "../lib/rubric";
import { startFakeResend, startFakeSupabase } from "./fakes";

const db = startFakeSupabase(54321);
startFakeResend(54322);

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
let n = 0;
function crit(role: "PM" | "SPM", base: number) {
  return RUBRICS[role].map((c, i) => ({ key: c.key, score: Math.max(0, Math.min(5, base + ((i * 7 + n) % 3) - 1)), evidence: `${c.label}: example drawn from the CV (demo data).` }));
}
function mk(name: string | null, role: "PM" | "SPM", pm: number, spm: number, rec: "interview" | "maybe" | "reject", over: Record<string, unknown> = {}) {
  n++;
  const first = (name || "there").split(" ")[0];
  const rn = role === "PM" ? "Product Manager" : "Senior Product Manager";
  db.table.push({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, created_at: ago(120 - n), updated_at: ago(120 - n),
    file_name: `${(name || "resume").toLowerCase().replace(/\s+/g, "_")}.pdf`, applied_role: role, full_name: name,
    email: name ? `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` : null, phone: "+919800000000", status: "scored", error: null,
    pm_score: pm, spm_score: spm, pm_breakdown: crit("PM", Math.round(pm / 20)), spm_breakdown: crit("SPM", Math.round(spm / 20)),
    years_pm_experience: role === "PM" ? 3 : 6, best_fit_role: pm >= spm ? "PM" : "SPM",
    summary: `${rn} with ${role === "PM" ? "freight-tech" : "platform and integration"} experience; ${rec === "interview" ? "built and shipped tools adopted by ops teams" : rec === "maybe" ? "solid product work but little ground-level logistics exposure" : "mostly consumer-product experience"}.`,
    recommendation: rec,
    interview_brief: { why_ranked_here: `Scores ${role === "PM" ? pm : spm}/100 for ${rn}. The CV names a concrete example of ${rec === "reject" ? "shipping features, but not of working with operations" : "owning a decision with no playbook, with measurable results"}.`,
      strengths: ["Named a feature they killed and the data behind it", "Spent two weeks embedded with a freight forwarder's ops team"], concerns: ["No evidence of owning an integration layer"],
      probe_questions: ["Walk me through the last feature you shut down. What data told you, and who disagreed?", "Describe a day you spent with end users in operations. What surprised you?", "What did you build that nobody asked for, and who ended up using it?"] },
    invite_subject: `Let's talk about the ${"{{role}}"} role at Kargo`,
    invite_body: `Hi {{first_name}},\n\nThank you for applying for the {{role}} role at Kargo. Your work on the dock-scheduling alerts stood out, especially how you decided what to cut.\n\nI'd like to set up a 45-minute conversation, at our Mumbai office or on video. Could you reply with 2–3 slots that work next week?\n\nArjun Mehta\nFounder, Kargo`,
    rejection_subject: "Your application to Kargo",
    rejection_body: `Hi {{first_name}},\n\nThank you for applying for the {{role}} role at Kargo, and for your patience while we reviewed applications.\n\nWe've decided to move forward with candidates whose experience is closer to what this role needs right now. Your consumer-growth work was strong and I wish you well.\n\nArjun Mehta\nFounder, Kargo`,
    decision: "pending", email_status: "draft", email_sent_at: null, email_error: null, sent_email_type: null, redacted_text: "demo", ...over,
  });
}
mk("Priya Krishnan", "PM", 91, 62, "interview");
mk("Kabir Mehta", "PM", 84, 55, "interview", { decision: "invite" });
mk("Deepika Nair", "PM", 78, 80, "interview");
mk("Ananya Rajan", "PM", 66, 41, "interview");
mk("Virat Patel", "PM", 58, 35, "maybe");
mk("Aditi Sharma", "PM", 52, 49, "maybe", { email: null });
mk("Nishant Joshi", "PM", 39, 30, "reject", { decision: "reject" });
mk("Sneha Patil", "PM", 28, 22, "reject");
mk("Tanvi Jain", "PM", 18, 12, "reject", { email_status: "sent", decision: "reject", sent_email_type: "rejection", email_sent_at: ago(30) });
mk("Siddharth Rao", "SPM", 70, 92, "interview");
mk("Nalini Iyer", "SPM", 61, 83, "interview");
mk("Varun Khanna", "SPM", 55, 71, "interview", { decision: "invite", email_status: "failed", email_error: "Resend is in test mode and only delivers to the address on your Resend account. Verify a domain in Resend, or set EMAIL_OVERRIDE_TO to your own address." });
mk("Kritika Sharma", "SPM", 44, 58, "maybe");
mk("Rajesh Kumar", "SPM", 30, 36, "reject");
mk(null, "PM", 0, 0, "reject", { status: "error", error: "Gemini could not score this CV: gemini-3.8-flash 429 quota exceeded", file_name: "cv_final_v3.pdf", summary: null, recommendation: null, pm_score: null, spm_score: null, pm_breakdown: null, spm_breakdown: null, interview_brief: null });
mk(null, "SPM", 0, 0, "reject", { status: "processing", updated_at: ago(9), created_at: ago(9), file_name: "scan_resume.pdf", summary: null, recommendation: null, pm_score: null, spm_score: null, pm_breakdown: null, spm_breakdown: null, interview_brief: null });

const env = { ...process.env, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "demo", RESEND_API_KEY: "re_demo", RESEND_API_URL: "http://127.0.0.1:54322",
  EMAIL_OVERRIDE_TO: process.env.DEMO_LIVE ? "" : "test@kargo.test", ARJUN_EMAIL: "arjun@kargo.test" };
(env as Record<string, string>).APP_PASSWORD = ""; // explicit empty so Next does not load one from .env.local
const mode = process.env.DEMO_PROD ? "start" : "dev";
const child = spawn("node_modules/.bin/next", [mode, "-p", "3200"], { env, stdio: "inherit" });
process.on("SIGTERM", () => child.kill());
child.on("exit", (c) => process.exit(c ?? 0));
