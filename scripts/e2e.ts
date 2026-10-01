// End-to-end test of every pathway against a production build, fake Supabase, fake Resend and the REAL Gemini API.
//   export GEMINI_API_KEY=...; npx next build && npx tsx scripts/e2e.ts <folder-with-sample-CVs>
import { spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { startFakeResend, startFakeSupabase } from "./fakes";

const CV_DIR = process.argv[2];
const PORT = 3100, BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "test-pass-123";
process.env.APP_PASSWORD = PASSWORD; process.env.RESEND_API_KEY = "re_fake"; process.env.RESEND_API_URL = "http://127.0.0.1:54322";

let passed = 0, failed = 0;
function check(name: string, ok: unknown, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}
const section = (s: string) => console.log(`\n${s}`);
let cookie = "";
async function call(path: string, init: RequestInit & { json?: unknown; noAuth?: boolean } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (!init.noAuth && cookie) headers.cookie = cookie;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(init.json); }
  const res = await fetch(BASE + path, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(150_000) });
  const text = await res.text();
  let body: any = text; try { body = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, body, headers: res.headers };
}
const upload = (file: string, role: string, name = file) => {
  const fd = new FormData(); fd.append("file", new File([readFileSync(`${CV_DIR}/${file}`)], name)); fd.append("role", role);
  return call("/api/process", { method: "POST", body: fd });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = startFakeSupabase(54321);
  const resend = startFakeResend(54322);
  const server = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env: { ...process.env, NODE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
      ARJUN_EMAIL: "arjun@kargo.test", EMAIL_OVERRIDE_TO: "", GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.8-flash" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; const logFile = createWriteStream(process.env.E2E_SERVER_LOG || "/dev/null");
  server.stdout.on("data", (d) => { log += d; logFile.write(d); }); server.stderr.on("data", (d) => { log += d; logFile.write(d); });
  for (let i = 0; i < 60 && !(await fetch(BASE + "/login").then((r) => r.ok).catch(() => false)); i++) await sleep(500);

  try {
    section("0. Fail closed: production without APP_PASSWORD");
    {
      const env2: NodeJS.ProcessEnv = { ...process.env, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k" };
      env2.APP_PASSWORD = ""; // explicit empty: Next would otherwise load APP_PASSWORD from .env.local
      const locked = spawn("node_modules/.bin/next", ["start", "-p", "3101"], { env: { ...env2 }, stdio: "ignore" });
      for (let i = 0; i < 60 && !(await fetch("http://127.0.0.1:3101/login").then((x) => x.ok).catch(() => false)); i++) await sleep(500);
      const get = (path: string, init?: RequestInit) => fetch("http://127.0.0.1:3101" + path, { redirect: "manual", ...init });
      let x = await get("/api/candidates");
      check("no password configured → API is locked (401), not open", x.status === 401);
      x = await get("/");
      check("no password configured → dashboard redirects to login", x.status === 307);
      x = await get("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "" }) });
      check("login explains that APP_PASSWORD must be set (503)", x.status === 503 && /APP_PASSWORD/.test(((await x.json()) as any).error));
      x = await get("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "anything" }) });
      check("any password is refused when none is configured", x.status === 503);
      locked.kill();
    }

    section("0b. Open demo (OPEN_ACCESS=true): no login, but no way to email real candidates");
    {
      const startOpen = async (port: number, extra: Record<string, string>) => {
        const env3: NodeJS.ProcessEnv = { ...process.env, SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k", OPEN_ACCESS: "true", ARJUN_EMAIL: "arjun@kargo.test", ...extra };
        env3.APP_PASSWORD = "";
        const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], { env: { ...env3 }, stdio: "ignore" });
        for (let i = 0; i < 60 && !(await fetch(`http://127.0.0.1:${port}/login`).then((x) => x.ok).catch(() => false)); i++) await sleep(500);
        return { child, get: (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", ...init }) };
      };
      const seed = (id: string) => db.table.push({ id, created_at: "2026-01-01", updated_at: "2026-01-01", file_name: "demo.pdf", applied_role: "PM", full_name: "Demo Person", email: "demo.person@example.com",
        status: "scored", decision: "invite", email_status: "draft", invite_subject: "Hi", invite_body: "Hi {{first_name}}, about the {{role}} role", rejection_subject: "x", rejection_body: "y" });
      seed("33333333-3333-3333-3333-333333333333");
      const sentBefore = resend.sent.length;

      const open = await startOpen(3102, {});
      let x = await open.get("/api/candidates");
      check("open mode: API works without a login", x.status === 200);
      x = await open.get("/");
      check("open mode: dashboard loads without redirect", x.status === 200);
      const cfg3: any = await (await open.get("/api/config")).json();
      check("open mode: config says open + sending blocked + no review email", cfg3.openAccess === true && cfg3.sendBlocked === true && cfg3.reviewAvailable === false, JSON.stringify(cfg3));
      x = await open.get("/api/candidates/33333333-3333-3333-3333-333333333333/send", { method: "POST" });
      check("open mode without test mode: sending a real candidate is refused (403)", x.status === 403 && /open demo/i.test(((await x.json()) as any).error));
      check("…nothing was delivered and the row is untouched", resend.sent.length === sentBefore && db.table.find((r) => r.id === "33333333-3333-3333-3333-333333333333")?.email_status === "draft");
      x = await open.get("/api/review", { method: "POST" });
      check("open mode: summary email refused (403)", x.status === 403);
      open.child.kill();

      const test = await startOpen(3103, { EMAIL_OVERRIDE_TO: "evaluator@kargo.test" });
      const cfg4: any = await (await test.get("/api/config")).json();
      check("open mode + test redirect: sending allowed", cfg4.openAccess === true && cfg4.sendBlocked === false && cfg4.testRedirect === "evaluator@kargo.test");
      x = await test.get("/api/candidates/33333333-3333-3333-3333-333333333333/send", { method: "POST" });
      check("open mode + test redirect: email is sent", x.status === 200);
      const m0 = resend.sent[resend.sent.length - 1];
      check("…to the redirect address only, labelled as a test", m0?.to.length === 1 && m0.to[0] === "evaluator@kargo.test" && /TEST MODE/.test(m0.text) && /demo\.person@example\.com/.test(m0.text), JSON.stringify(m0)?.slice(0, 200));
      test.child.kill();
      db.table.splice(db.table.findIndex((r) => r.id === "33333333-3333-3333-3333-333333333333"), 1);
      resend.sent.length = 0; // later sections count deliveries from zero
    }

    section("1. Access control");
    let r = await call("/", { noAuth: true });
    check("dashboard redirects to /login when signed out", r.status === 307 && /\/login/.test(r.headers.get("location") || ""));
    r = await call("/api/candidates", { noAuth: true });
    check("API refuses unauthenticated requests (401)", r.status === 401);
    r = await call("/api/candidates/x/send", { method: "POST", noAuth: true });
    check("send endpoint refuses unauthenticated requests", r.status === 401);
    r = await call("/api/login", { method: "POST", json: { password: "wrong" }, noAuth: true });
    check("wrong password is rejected (401)", r.status === 401);
    r = await call("/api/login", { method: "POST", json: {}, noAuth: true });
    check("empty password is rejected", r.status === 401);
    r = await call("/api/login", { method: "POST", json: { password: PASSWORD }, noAuth: true });
    cookie = (r.headers.get("set-cookie") || "").split(";")[0];
    check("correct password signs in and sets a cookie", r.status === 200 && cookie.startsWith("kargo_session="));
    check("cookie does not contain the password", !cookie.includes(PASSWORD));
    const [exp, sig] = cookie.split("=")[1].split(".");
    r = await call("/api/candidates", { headers: { cookie: `kargo_session=${Number(exp) + 99999}.${sig}` }, noAuth: true });
    check("tampered session expiry is rejected", r.status === 401);
    r = await call("/api/candidates", { headers: { cookie: `kargo_session=${exp}.${"0".repeat(64)}` }, noAuth: true });
    check("forged signature is rejected", r.status === 401);
    r = await call("/api/candidates", { headers: { cookie: `kargo_session=${Math.floor(Date.now() / 1000) - 10}.${sig}` }, noAuth: true });
    check("expired session is rejected", r.status === 401);
    r = await call("/api/candidates");
    check("signed-in request is allowed", r.status === 200 && Array.isArray(r.body));
    r = await call("/api/config");
    check("config reports email + gemini state", r.body.emailConfigured === true && r.body.geminiConfigured === true && r.body.databaseConfigured === true && r.body.reviewAvailable === true && r.body.openAccess === false, JSON.stringify(r.body));

    section("2. Upload validation (no AI cost)");
    let fd = new FormData(); fd.append("file", new File(["x"], "notes.exe")); fd.append("role", "PM");
    r = await call("/api/process", { method: "POST", body: fd });
    check("unsupported file type rejected (415) without creating a row", r.status === 415 && db.table.length === 0, `${r.status} rows=${db.table.length}`);
    fd = new FormData(); fd.append("file", new File([new Uint8Array(5 * 1024 * 1024)], "big.pdf")); fd.append("role", "PM");
    r = await call("/api/process", { method: "POST", body: fd });
    check("file over 4 MB rejected (413)", r.status === 413 && db.table.length === 0);
    fd = new FormData(); fd.append("file", new File(["short"], "tiny.txt")); fd.append("role", "NOPE");
    r = await call("/api/process", { method: "POST", body: fd });
    check("invalid role rejected (400)", r.status === 400);
    r = await call("/api/process", { method: "POST", body: new FormData() });
    check("missing file rejected (400)", r.status === 400);
    fd = new FormData(); fd.append("file", new File(["a short note, not a CV"], "empty-ish.txt")); fd.append("role", "PM");
    r = await call("/api/process", { method: "POST", body: fd });
    check("unreadable/short CV fails clearly and is recorded as an error row", r.status === 500 && /enough text/.test(r.body.error) && db.table[0]?.status === "error", JSON.stringify(r.body));
    db.table.length = 0;

    section("3. Real upload → redact → Gemini → score (3 CVs in parallel, real API)");
    const t0 = Date.now();
    const [a, b, c] = await Promise.all([
      upload("pm_01_priya_krishnan.pdf", "PM"),
      upload("spm_16_siddharth_rao.pdf", "SPM"),
      upload("05_ishaan_roy.pdf", "AUTO"),
    ]);
    console.log(`     (${Math.round((Date.now() - t0) / 1000)}s for 3 parallel uploads)`);
    for (const [label, x] of [["PM", a], ["SPM", b], ["AUTO", c]] as const) check(`${label} upload scored`, x.status === 200 && typeof x.body.score === "number", JSON.stringify(x.body).slice(0, 200));
    check("PM candidate name and contact extracted", a.body.name === "Priya Krishnan");
    check("SPM candidate filed under SPM", b.body.role === "SPM");
    check("AUTO candidate filed under the better-fitting role", c.body.role === "PM" || c.body.role === "SPM");
    const rows = db.table.filter((x) => x.status === "scored");
    check("3 scored rows saved", rows.length === 3, `rows=${db.table.map((x) => x.status)}`);
    for (const row of rows) {
      const red = String(row.redacted_text), nm = String(row.full_name);
      check(`[${nm}] AI never saw name/email/phone`, !nm.split(" ").some((t) => new RegExp(`\\b${t}\\b`, "i").test(red)) && !/@/.test(red) && !/\d{5}\s?\d{5}/.test(red));
      check(`[${nm}] criterion scores complete (6+6)`, (row.pm_breakdown as any[]).length === 6 && (row.spm_breakdown as any[]).length === 6);
      check(`[${nm}] emails use placeholders, not hard-coded name/role`, /\{\{first_name\}\}/.test(String(row.invite_body)) && /\{\{first_name\}\}/.test(String(row.rejection_body)));
      check(`[${nm}] interview brief has probe questions`, (row.interview_brief as any).probe_questions.length >= 3);
      check(`[${nm}] contact email is the real address`, /^squad_\d@pg27\.mesaschool\.co$/.test(String(row.email)), String(row.email));
    }

    section("4. Duplicates, listing, stalled rows");
    r = await upload("pm_01_priya_krishnan.pdf", "PM");
    check("re-uploading the same CV is detected as a duplicate", r.status === 200 && r.body.duplicate === true && db.table.filter((x) => x.status === "scored").length === 3, JSON.stringify(r.body));
    check("duplicate leaves no stray 'processing' row", db.table.filter((x) => x.status === "processing").length === 0);
    r = await call("/api/candidates");
    check("list has 3 candidates", r.body.length === 3);
    check("list payload omits the stored CV text", r.body.every((x: any) => !("redacted_text" in x)));
    db.table.push({ id: "11111111-1111-1111-1111-111111111111", created_at: new Date(Date.now() - 600000).toISOString(), updated_at: new Date(Date.now() - 600000).toISOString(), file_name: "ghost.pdf", applied_role: "PM", status: "processing", decision: "pending", email_status: "draft", redacted_text: null });
    r = await call("/api/candidates");
    check("row stuck in 'processing' is flagged stalled", r.body.find((x: any) => x.file_name === "ghost.pdf")?.stalled === true);
    r = await call("/api/candidates/11111111-1111-1111-1111-111111111111/retry", { method: "POST" });
    check("retry without saved text explains what to do (422)", r.status === 422 && /upload the file again/.test(r.body.error), JSON.stringify(r.body));
    r = await call(`/api/candidates/${rows[0].id}/retry`, { method: "POST" });
    check("retry refuses an already-scored candidate (409)", r.status === 409);
    r = await call("/api/candidates/11111111-1111-1111-1111-111111111111", { method: "DELETE" });
    check("stalled row can be removed", r.status === 200 && !db.table.some((x) => x.file_name === "ghost.pdf"));
    // Simulate a Gemini failure after redaction: retry must re-score from the stored text, no re-upload.
    const victim = rows[2]; Object.assign(victim, { status: "error", error: "Gemini timed out", pm_score: null, spm_score: null, pm_breakdown: null, spm_breakdown: null, summary: null });
    const t1 = Date.now();
    r = await call(`/api/candidates/${victim.id}/retry`, { method: "POST" });
    check("retry re-scores a failed candidate from stored text", r.status === 200 && r.body.status === "scored" && r.body.pm_breakdown?.length === 6, JSON.stringify(r.body).slice(0, 200));
    console.log(`     (retry took ${Math.round((Date.now() - t1) / 1000)}s)`);

    section("5. Decisions and edits (validation)");
    const id = String(rows[0].id);
    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { decision: "maybe" } });
    check("invalid decision rejected (400)", r.status === 400);
    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { email: "not-an-email" } });
    check("invalid email rejected (400)", r.status === 400);
    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { pm_score: 100, status: "scored", email_status: "sent" } });
    check("scores/status/send-state cannot be edited from the browser", r.status === 400 && /Nothing to update/.test(r.body.error));
    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { full_name: "x".repeat(500) } });
    check("over-long name rejected", r.status === 400);
    r = await call("/api/candidates/00000000-0000-0000-0000-000000000000", { method: "PATCH", json: { decision: "invite" } });
    check("unknown candidate → 404", r.status === 404);
    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { decision: "invite", invite_subject: "Hello", invite_body: "Hi {{first_name}},\n\nLet's talk about the {{role}} role.\n\nArjun" } });
    check("valid decision + edited draft saved", r.status === 200 && r.body.decision === "invite" && r.body.invite_subject === "Hello" && !("redacted_text" in r.body));

    section("6. Bulk 'accept AI suggestions'");
    const others = db.table.filter((x) => x.id !== id && x.status === "scored");
    const expectInvite = others.filter((x) => x.recommendation === "interview").length, expectReject = others.filter((x) => x.recommendation === "reject").length;
    r = await call("/api/candidates/decide-suggested", { method: "POST" });
    check("only undecided candidates with an interview/reject suggestion are set", r.status === 200 && r.body.invited === expectInvite && r.body.rejected === expectReject, `${JSON.stringify(r.body)} expected ${expectInvite}/${expectReject}`);
    check("bulk accept did not touch the manually decided candidate", db.table.find((x) => x.id === id)?.decision === "invite");
    check("bulk accept sends nothing", resend.sent.length === 0);

    section("7. Sending: guards, race, failures");
    const pendingRow = db.table.find((x) => x.decision === "pending" && x.status === "scored");
    if (pendingRow) { r = await call(`/api/candidates/${pendingRow.id}/send`, { method: "POST" }); check("cannot send without a decision (400)", r.status === 400); }
    else {
      const maybe = db.table.find((x) => x.status === "scored")!; const keep = { d: maybe.decision, e: maybe.email_status };
      Object.assign(maybe, { decision: "pending", email_status: "draft" });
      r = await call(`/api/candidates/${maybe.id}/send`, { method: "POST" });
      check("cannot send without a decision (400)", r.status === 400);
      Object.assign(maybe, { decision: keep.d, email_status: keep.e });
    }
    db.table.push({ id: "22222222-2222-2222-2222-222222222222", file_name: "err.pdf", applied_role: "PM", status: "error", decision: "invite", email_status: "draft", email: "a@b.co", invite_subject: "s", invite_body: "b", created_at: "x", updated_at: "x" });
    r = await call("/api/candidates/22222222-2222-2222-2222-222222222222/send", { method: "POST" });
    check("cannot email a candidate that failed scoring (400)", r.status === 400);
    db.table.splice(db.table.findIndex((x) => x.id === "22222222-2222-2222-2222-222222222222"), 1);
    await call(`/api/candidates/${id}`, { method: "PATCH", json: { email: "" } });
    r = await call(`/api/candidates/${id}/send`, { method: "POST" });
    check("cannot send without an email address (400)", r.status === 400 && /email address/i.test(r.body.error));
    await call(`/api/candidates/${id}`, { method: "PATCH", json: { email: "Priya.K@Example.com " } });
    check("edited email is trimmed and lower-cased", db.table.find((x) => x.id === id)?.email === "priya.k@example.com");

    resend.state.mode = "test-mode-403";
    r = await call(`/api/candidates/${id}/send`, { method: "POST" });
    check("Resend test-mode rejection gives a plain-English fix (502)", r.status === 502 && /verify a domain|EMAIL_OVERRIDE_TO/.test(r.body.error), r.body.error);
    const afterFail = db.table.find((x) => x.id === id)!;
    check("failed send is recorded as 'failed' (not 'sent') with the reason", afterFail.email_status === "failed" && afterFail.sent_email_type === null && !!afterFail.email_error);
    check("nothing was delivered", resend.sent.length === 0);
    resend.state.mode = "bad-key";
    r = await call(`/api/candidates/${id}/send`, { method: "POST" });
    check("invalid Resend key gives a clear message", r.status === 502 && /API key/.test(r.body.error), r.body.error);

    resend.state.mode = "ok"; resend.state.delayMs = 500;
    const burst = await Promise.all(Array.from({ length: 6 }, () => call(`/api/candidates/${id}/send`, { method: "POST" })));
    const codes = burst.map((x) => x.status).sort().join(",");
    check("6 simultaneous sends → exactly one delivered (200), five refused (409)", codes === "200,409,409,409,409,409", codes);
    check("candidate received exactly ONE email", resend.sent.length === 1, `emails=${resend.sent.length}`);
    resend.state.delayMs = 0;
    const mail = resend.sent[0];
    check("email went to the candidate's address", mail.to[0] === "priya.k@example.com");
    check("placeholders were filled ({{first_name}}, {{role}})", /^Hi Priya,/.test(mail.text) && /Product Manager role/.test(mail.text) && !/\{\{/.test(mail.text), mail.text.slice(0, 120));
    check("sent with an idempotency key", /^kargo-/.test(mail.key || ""));
    r = await call(`/api/candidates/${id}/send`, { method: "POST" });
    check("sending again is refused (409)", r.status === 409);
    r = await call(`/api/candidates/${id}`, { method: "PATCH", json: { decision: "reject" } });
    check("decision is locked after the email is sent (409)", r.status === 409);
    r = await call("/api/candidates");
    const done = r.body.find((x: any) => x.id === id);
    check("record shows sent state and time", done.email_status === "sent" && done.sent_email_type === "invite" && !!done.email_sent_at);

    resend.state.mode = "429-once";
    const next = db.table.find((x) => x.decision === "invite" && x.email_status === "draft" && x.email);
    if (next) { r = await call(`/api/candidates/${next.id}/send`, { method: "POST" }); check("a Resend rate-limit (429) is retried automatically", r.status === 200 && resend.sent.length === 2, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`); }
    resend.state.mode = "ok";

    section("8. Review digest to Arjun");
    const before = resend.sent.length;
    r = await call("/api/review", { method: "POST" });
    check("digest sent to ARJUN_EMAIL", r.status === 200 && resend.sent.length === before + 1 && resend.sent.at(-1)!.to[0] === "arjun@kargo.test", JSON.stringify(r.body));
    check("digest lists ranked candidates and the dashboard link", /Senior Product Manager/.test(resend.sent.at(-1)!.text) && /Open the dashboard: http/.test(resend.sent.at(-1)!.text));

    section("9. Remove (right to erasure)");
    const gone = String(rows[1].id);
    r = await call(`/api/candidates/${gone}`, { method: "DELETE" });
    check("candidate and their data deleted", r.status === 200 && !db.table.some((x) => x.id === gone));

    section("10. Sign out");
    r = await call("/api/logout", { method: "POST" });
    check("logout clears the cookie", /Max-Age=0/i.test(r.headers.get("set-cookie") || ""));
    check("server log has no unhandled errors", !/unhandled|TypeError|ReferenceError/i.test(log), log.split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" | "));
  } finally {
    server.kill(); db.close(); resend.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
