// Failure modes of the AI step, with a stubbed Gemini (no API cost).   npx tsx scripts/test-gemini.ts [--slow]
import { scoreCV, checkResult } from "../lib/gemini";
import { RUBRICS } from "../lib/rubric";

process.env.GEMINI_API_KEY = "stub";
const realFetch = globalThis.fetch;
let failed = 0;
const check = (name: string, ok: unknown, detail = "") => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  → " + detail : ""}`); };

const good = () => ({
  pm_scores: RUBRICS.PM.map((c) => ({ key: c.key, score: 4, evidence: "e" })), spm_scores: RUBRICS.SPM.map((c) => ({ key: c.key, score: 3, evidence: "e" })),
  years_pm_experience: 3, summary: "s", interview_brief: { why_ranked_here: "w", strengths: ["a"], concerns: ["b"], probe_questions: ["q"] },
  invite_email: { subject: "i", body: "Hi {{first_name}},\n\nhello" }, rejection_email: { subject: "r", body: "no greeting here" },
});
const reply = (obj: unknown, status = 200, finishReason = "STOP") =>
  new Response(JSON.stringify(status === 200 ? { candidates: [{ finishReason, content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] } : { error: { message: String(obj) } }), { status });
const stub = (fn: (n: number, init: RequestInit) => Promise<Response>) => { let n = 0; globalThis.fetch = ((_u: unknown, init: RequestInit) => fn(++n, init)) as typeof fetch; return () => n; };
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as Error).message; } };

(async () => {
  let calls = stub(async () => reply(good()));
  const r = await scoreCV("cv text", "PM");
  check("valid answer accepted", r.pm_scores.length === 6 && r.spm_scores.length === 6);
  check("rejection email without a greeting gets one added", /^Hi \{\{first_name\}\},/.test(r.rejection_email.body));

  stub(async (n) => (n === 1 ? reply("quota", 429) : reply(good())));
  check("429 then success → retried and succeeds", (await scoreCV("cv", "PM")).summary === "s");

  stub(async (n, init) => (String(init.body).length && n === 1 ? reply("gone", 404) : reply(good())));
  check("404 on the primary model → falls back to the second model", (await scoreCV("cv", "PM")).summary === "s");

  const bad = good(); bad.pm_scores = bad.pm_scores.slice(0, 4);
  calls = stub(async (n) => (n === 1 ? reply(bad) : reply(good())));
  check("answer missing criteria is rejected, then retried (not silently scored 0)", (await scoreCV("cv", "PM")).pm_scores.length === 6 && calls() === 2);

  calls = stub(async () => reply(bad));
  let msg = await fails(scoreCV("cv", "PM"));
  check("persistently incomplete answers fail with a clear message", !!msg && /missing criteria/.test(msg), String(msg));

  calls = stub(async () => reply('{"pm_scores": [{"key": "ops_exp', 200, "MAX_TOKENS"));
  msg = await fails(scoreCV("cv", "PM"));
  check("truncated output fails clearly (no crash on bad JSON)", !!msg && /could not score/.test(msg), String(msg));

  stub(async () => reply("not json at all"));
  msg = await fails(scoreCV("cv", "PM"));
  check("malformed JSON fails clearly", !!msg && /malformed/.test(msg), String(msg));

  stub(async () => reply("API key not valid", 400));
  msg = await fails(scoreCV("cv", "PM"));
  check("bad API key fails immediately with Gemini's reason", !!msg && /rejected the request \(400\)/.test(msg), String(msg));

  stub(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }));
  msg = await fails(scoreCV("cv", "PM"));
  check("blocked/empty response fails clearly", !!msg && /empty response/.test(msg), String(msg));

  msg = await fails(scoreCV("x".repeat(90_000), "PM"));
  check("over-long CV is refused rather than silently truncated", !!msg && /too long/.test(msg), String(msg));

  check("checkResult normalises scores into 0–5 integers", (() => { const g = good() as any; g.pm_scores[0].score = 9.7; g.spm_scores[0].score = -3; const c = checkResult(g); return c.ok && c.value.pm_scores[0].score === 5 && c.value.spm_scores[0].score === 0; })());

  if (process.argv.includes("--slow")) {
    // Gemini never answers: the call must still end inside the function's 60s limit.
    stub((_n, init) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "TimeoutError" })))));
    const t = Date.now();
    const keepAlive = setInterval(() => {}, 1000); // a real socket would keep Node running; the stub has none
    msg = await fails(scoreCV("cv", "PM"));
    clearInterval(keepAlive);
    const s = (Date.now() - t) / 1000;
    check(`a Gemini call that never answers gives up after ${s.toFixed(0)}s (< 60s) with a retryable message`, s < 58 && !!msg && /Press Retry|could not score/.test(msg), `${s}s ${msg}`);
  }
  globalThis.fetch = realFetch;
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
