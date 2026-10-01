// Smoke test of a DEPLOYED instance with the real database and the real Gemini API.
// Creates one synthetic candidate, exercises the main paths, then deletes it. Sends no email unless --send
// is passed AND the server is in test mode (EMAIL_OVERRIDE_TO set), so a real candidate can never be emailed.
//   [APP_PASSWORD=...] npx tsx scripts/smoke-live.ts https://your-app.vercel.app [--send]   (no password needed for an open demo)
const base = (process.argv[2] || "").replace(/\/$/, "");
const password = process.env.APP_PASSWORD || ""; // empty for an open demo
if (!base) { console.error("usage: APP_PASSWORD=... tsx scripts/smoke-live.ts <url> [--send]"); process.exit(2); }

let failed = 0, cookie = "";
const check = (name: string, ok: unknown, detail = "") => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  → " + detail : ""}`); };
async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (cookie) headers.cookie = cookie;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(init.json); }
  const res = await fetch(base + path, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(90_000) });
  const text = await res.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body, headers: res.headers };
}

const CV = `Smoke Testcase
Product Manager | Mumbai
smoke.testcase@example.com | +91 98765 43210

SUMMARY
Product manager with 3 years at a Series A freight-visibility startup in Mumbai. Started as an operations coordinator at a 3PL, so I know the documentation chain from the ground up. First PM at the company; ran product without a manager.

EXPERIENCE
Product Manager, PortLink Technologies (Series A, freight SaaS, 40 employees), Mumbai, Jan 2023 - Present
- First and only PM; owned the roadmap for shipment tracking and customs documentation with no senior PM above me.
- Shipped 6 features in 14 months and killed 2 after adoption data showed under 8% weekly use despite positive interviews; redirected the sprint to a bill-of-lading checker that 30 operators adopted within a month without being asked.
- Spent two weeks embedded in a freight forwarder's operations room during a port congestion incident; the alert system we built afterwards cut customer-reported exceptions by 34%.

Operations Coordinator, Mahindra Logistics, Mumbai, Jul 2020 - Dec 2022
- Managed carrier allocation and exception handling for three FMCG accounts, 400+ movements a month.
`;

(async () => {
  let r = await call("/api/candidates");
  const open = r.status === 200; // open demo: no login required
  if (open) console.log("  · open demo (no login)");
  else {
    check("signed-out API call is refused (401)", r.status === 401);
    r = await call("/api/login", { method: "POST", json: { password: "definitely-wrong" } });
    check("wrong password refused (401)", r.status === 401);
    r = await call("/api/login", { method: "POST", json: { password } });
    cookie = (r.headers.get("set-cookie") || "").split(";")[0];
    check("sign in works", r.status === 200 && cookie.startsWith("kargo_session="), `${r.status} ${JSON.stringify(r.body)}`);
    if (!cookie) process.exit(1);
  }

  r = await call("/api/config");
  const cfg = r.body;
  check("server config readable", r.status === 200);
  check("database connected", cfg.databaseConfigured === true, "set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  check("Gemini configured", cfg.geminiConfigured === true);
  console.log(`  · email: ${!cfg.emailConfigured ? "not configured" : cfg.sendBlocked ? "sending BLOCKED (open demo without test mode)" : cfg.testRedirect ? `test mode → ${cfg.testRedirect}` : "LIVE to candidates"}`);
  if (!cfg.databaseConfigured || !cfg.geminiConfigured) { console.log("\nStopping: configure the items above first."); process.exit(1); }

  r = await call("/api/candidates");
  check("candidate list loads", r.status === 200 && Array.isArray(r.body), JSON.stringify(r.body).slice(0, 200));

  const fd = new FormData(); fd.append("file", new File([CV], "Smoke_Testcase_Resume.txt", { type: "text/plain" })); fd.append("role", "PM");
  const t = Date.now();
  r = await call("/api/process", { method: "POST", body: fd });
  check(`upload → redact → Gemini → score (${Math.round((Date.now() - t) / 1000)}s)`, r.status === 200 && typeof r.body.score === "number", JSON.stringify(r.body).slice(0, 250));
  const id = r.body.id;
  if (!id) process.exit(1);

  try {
    r = await call("/api/candidates");
    const row = r.body.find((c: any) => c.id === id);
    check("candidate appears, scored, name found", row?.status === "scored" && row.full_name === "Smoke Testcase", JSON.stringify(row)?.slice(0, 200));
    check("both rubric breakdowns + brief + both drafts present", row?.pm_breakdown?.length === 6 && row?.spm_breakdown?.length === 6 && row?.interview_brief?.probe_questions?.length >= 3 && row?.invite_body && row?.rejection_body);
    check("list omits stored CV text", !("redacted_text" in (row || {})));

    const fd2 = new FormData(); fd2.append("file", new File([CV], "Smoke_Testcase_Resume.txt", { type: "text/plain" })); fd2.append("role", "PM");
    r = await call("/api/process", { method: "POST", body: fd2 });
    check("same CV again is detected as a duplicate", r.status === 200 && r.body.duplicate === true, JSON.stringify(r.body).slice(0, 200));

    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { decision: "maybe" } });
    check("invalid decision refused (400)", r.status === 400);
    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { decision: "invite", email: "Smoke.Testcase@Example.com" } });
    check("decision + email saved (email normalised)", r.status === 200 && r.body.decision === "invite" && r.body.email === "smoke.testcase@example.com");

    if (process.argv.includes("--send")) {
      if (!cfg.emailConfigured || !cfg.testRedirect || cfg.sendBlocked) check("refusing to send: server is not in test mode", false, "set EMAIL_OVERRIDE_TO on the server first");
      else {
        r = await call(`/api/candidates/${id}/send`, { method: "POST" });
        check(`invite sent (test mode → ${cfg.testRedirect})`, r.status === 200 && r.body.email_status === "sent", JSON.stringify(r.body).slice(0, 250));
        const again = await call(`/api/candidates/${id}/send`, { method: "POST" });
        check("second send refused (409)", again.status === 409);
      }
    } else console.log("  · send not tested (pass --send while the server is in test mode)");
  } finally {
    r = await call(`/api/candidates/${id}`, { method: "DELETE" });
    check("test candidate deleted", r.status === 200);
    r = await call("/api/candidates");
    check("…and gone from the list", !r.body.some((c: any) => c.id === id));
  }
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
