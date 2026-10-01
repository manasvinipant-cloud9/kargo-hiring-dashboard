// Audits extraction + redaction against a folder of real CVs (default: the 60 sample applications).
//   npx tsx scripts/test-extract.ts <folder> [--show] [--inst]
import { readdirSync, readFileSync } from "node:fs";
import { extractDocument, extractPII, redact, INSTITUTION_RE } from "../lib/extract";

const dir = process.argv[2];
const show = process.argv.includes("--show");
(async () => {
  let bad = 0;
  const instSeen = new Map<string, number>();
  const files = readdirSync(dir).filter((x) => /\.(pdf|docx|txt)$/i.test(x)).sort();
  for (const f of files) {
    const { text, links } = await extractDocument(f, readFileSync(`${dir}/${f}`));
    const pii = extractPII(text, f, links);
    const red = redact(text, pii);
    const truth = f.replace(/^(?:s?pm_)?\d+_/, "").replace(/\.\w+$/, "").split("_");
    const issues: string[] = [];
    if (!pii.fullName || !truth.every((t) => pii.fullName!.toLowerCase().includes(t))) issues.push(`NAME=${pii.fullName}`);
    if (!pii.email || !/^squad_\d@pg27\.mesaschool\.co$/.test(pii.email)) issues.push(`EMAIL=${pii.email}`);
    if (!pii.phone) issues.push("PHONE=none");
    for (const t of truth) if (t.length > 2 && (new RegExp(`(?<![a-z])${t}(?![a-z])`, "i").test(red) || new RegExp(`[A-Z]${t[0].toUpperCase() + t.slice(1)}(?![a-z])`).test(red))) issues.push(`LEAK:${t}`);
    if (/@/.test(red.replace(/\(@[^)]*\)/g, ""))) issues.push("@-LEFT");
    if (/\+91|\d{10}|\b\d{5}\s?\d{5}\b/.test(red)) issues.push("PHONE-LEFT");
    if (/\b(IIT|IIM|NIT|XLRI|BITS|University|College|Institute)\b/.test(red)) issues.push("INSTITUTION-LEFT");
    if (/\b(he|she|his|her|him)\b/i.test(red)) issues.push("PRONOUN-LEFT");
    const cand = (red.match(/\[CANDIDATE\]/g) || []).length;
    if (cand > 6) issues.push(`CANDIDATE×${cand}`);
    const kept = Math.round((red.replace(/\[[A-Z_ ]+\]/g, "").length / text.length) * 100);
    if (kept < 90) issues.push(`KEPT-ONLY-${kept}%`);
    for (const m of text.matchAll(INSTITUTION_RE)) instSeen.set(m[0], (instSeen.get(m[0]) || 0) + 1);
    if (issues.length) bad++;
    if (issues.length || show) console.log(`${f.padEnd(28)} ${issues.join(" | ") || "ok"}`);
  }
  console.log(`\n${files.length - bad}/${files.length} clean`);
  if (show || process.argv.includes("--inst")) {
    console.log("\nText removed as INSTITUTION (review for over-redaction):");
    for (const [k, v] of [...instSeen].sort()) console.log(`  ${String(v).padStart(2)}× ${JSON.stringify(k)}`);
  }
  process.exit(bad ? 1 : 0);
})();
