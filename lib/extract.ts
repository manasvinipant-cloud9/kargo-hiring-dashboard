// Context step: turn an uploaded CV into text, pull out contact details, and produce the redacted
// text the AI sees. The AI never receives a name, email, phone, link, school name or gendered word.

export type Extracted = { text: string; links: string[] };

export async function extractDocument(fileName: string, buf: Buffer): Promise<Extracted> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    // Emails are often only present as clickable mailto: links, so read the link annotations too.
    const links: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        for (const a of await page.getAnnotations()) if (typeof a.url === "string") links.push(a.url);
      } catch { /* annotations are a bonus, never fatal */ }
    }
    return { text: clean(Array.isArray(text) ? text.join("\n") : text), links };
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { text: clean(value), links: [] };
  }
  if (ext === "txt" || ext === "md") return { text: clean(buf.toString("utf8")), links: [] };
  throw new Error(`Unsupported file type: .${ext}. Upload PDF, DOCX or TXT.`);
}

/** Kept for callers that only need text. */
export async function extractText(fileName: string, buf: Buffer): Promise<string> {
  return (await extractDocument(fileName, buf)).text;
}

function clean(s: string) {
  return s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------------------------

const TLDS = "com|in|co|org|net|edu|io|ai|dev|me|app|xyz|info|biz|us|uk|ac\\.in|co\\.in|gov\\.in|edu\\.in";
const EMAIL_STRICT = new RegExp(`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*?\\.(?:${TLDS})(?![a-z])`, "g");
const EMAIL_LOOSE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EMAIL_ANY = new RegExp(`${EMAIL_STRICT.source}|${EMAIL_LOOSE.source}`, "g");

// Web addresses (portfolio links often contain the person's name) and bare profile paths.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s|·,<>]+|\b(?:linkedin\.com|github\.com|twitter\.com|x\.com|behance\.net|notion\.site|medium\.com|leetcode\.com)\/[^\s|·,<>]*/gi;

export type PII = { fullName: string | null; email: string | null; phone: string | null };

export function extractPII(text: string, fileName: string, links: string[] = []): PII {
  const fullName = guessName(text, fileName, links);
  const tokens = [...(fullName || "").split(/\s+/), ...(nameFromFile(fileName) || "").split(/\s+/)].filter((t) => t.length > 1);
  return { fullName, email: findEmail(text, links, tokens), phone: findPhone(text) };
}

function findEmail(text: string, links: string[], nameTokens: string[]): string | null {
  const fromLinks = links.filter((l) => /^mailto:/i.test(l)).map((l) => decodeURIComponent(l.slice(7).split("?")[0]));
  const fromText = text.match(EMAIL_STRICT) ?? text.match(EMAIL_LOOSE) ?? [];
  for (const raw of [...fromLinks, ...fromText]) {
    const cleaned = unglue(raw.replace(/\\_/g, "_"), nameTokens);
    if (/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(cleaned)) return cleaned.toLowerCase();
  }
  return null;
}

// PDFs often glue the preceding word onto the address ("REDDYsquad_5@x.com"). Only an ALL-CAPS prefix
// that is exactly part of the candidate's own name is stripped, so a legitimate "ABCdev@x.com" is untouched.
function unglue(email: string, nameTokens: string[]): string {
  const at = email.indexOf("@");
  let local = email.slice(0, at);
  for (const t of nameTokens) {
    const up = t.toUpperCase();
    if (up.length >= 3 && local.startsWith(up) && /^[a-z0-9_.]/.test(local.slice(up.length))) local = local.slice(up.length);
  }
  return local + email.slice(at);
}

// A run of digits/spaces/hyphens that adds up to a phone number. Also catches the number printed
// twice and glued together ("+91 98202 1134598202 11345"), which PDFs with a repeated header produce.
const PHONE_RUN = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?){1,7}\d{2,5}/g;

function phoneDigits(run: string): string | null {
  const tokens = run.split(/\D+/).filter(Boolean);
  const digits = tokens.join("");
  if (digits.length < 10 || digits.length > 26) return null;
  // A list of years ("2018 2019 2020 2021") is not a phone number.
  if (tokens.every((t) => t.length === 4 && +t >= 1950 && +t <= 2040)) return null;
  return digits;
}

function findPhone(text: string): string | null {
  for (const m of text.matchAll(PHONE_RUN)) {
    const digits = phoneDigits(m[0]);
    if (!digits) continue;
    // Country code (0-3 digits) followed by a number printed twice: keep one copy.
    for (const cc of [0, 2, 1, 3]) {
      const rest = digits.slice(cc);
      const half = rest.length / 2;
      if (rest.length >= 20 && Number.isInteger(half) && rest.slice(0, half) === rest.slice(half)) {
        const num = digits.slice(0, cc) + rest.slice(0, half);
        return m[0].trim().startsWith("+") ? `+${num}` : num;
      }
    }
    if (digits.length <= 13) return m[0].trim().startsWith("+") ? `+${digits}` : digits;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------------------------

const NAME_STOP = new Set(
  ("product manager senior associate engineer engineering strategy strategic marketing growth analyst lead director head founder " +
    "co operations operation software data business consultant designer design intern internship summary profile experience education " +
    "skills resume curriculum vitae cv contact objective about technical project program management leader executive advisory " +
    "mumbai bangalore bengaluru delhi pune chennai hyderabad kolkata gurgaon gurugram noida india ahmedabad jaipur surat " +
    "full stack backend frontend ai ml digital innovation platform enterprise fintech saas logistics supply chain finance " +
    "sales customer success officer specialist coordinator vice president general partner principal " +
    "the and of for with at in to a an present current work professional core key " +
    // section headings, institutions and contact labels that sit near the top of a CV
    "scholastic achievements academic qualifications qualification venture builder delegate maestro certifications awards interests " +
    "languages references declaration university college school institute institution polytechnic academy technology technological " +
    "international sciences science studies mob mobile phone email linkedin github portfolio address btech mtech mba pgdm bsc bcom " +
    "iit iim nit bits imt xlri isb personal details career training courses publications volunteer activities hobbies").split(/\s+/),
);

function titleCase(w: string) {
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

function isNameWord(w: string) {
  return /^[A-Z][A-Za-z'’.-]{1,}$/.test(w) && !NAME_STOP.has(w.toLowerCase().replace(/[.'’-]/g, ""));
}

const FILE_NOISE = new Set("copy of resume curriculum vitae cv final updated latest new pm spm product manager senior sr jr application profile docx pdf draft revised version".split(" "));

function nameFromFile(fileName: string): string | null {
  const parts = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/\(\d+\)/g, " ")
    .split(/[\s_.\-]+/) // underscores and hyphens separate words ("Meera_Venkataraman_Resume")
    .filter((p) => /^[a-z]+$/i.test(p) && p.length > 1 && !FILE_NOISE.has(p.toLowerCase()));
  if (parts.length < 2 || parts.length > 4) return null;
  return parts.map(titleCase).join(" ");
}

/** Leading run of name-like words in a segment, with ALL CAPS normalised to Title Case. */
function nameRun(segment: string): { run: string[]; pure: boolean } {
  const words = segment.split(/\s+/).filter(Boolean).map((w) => (w === w.toUpperCase() && w.length > 1 ? titleCase(w) : w));
  const run: string[] = [];
  for (const w of words) { if (isNameWord(w) && run.length < 3) run.push(w); else break; }
  return { run, pure: run.length === words.length };
}

// PDFs with a sidebar header sometimes print the name twice, glued: "ROHAN MEHTARohan Mehta".
function doubledHeaderName(line: string): string | null {
  const m = line.toLowerCase().match(/^([a-z]+(?: [a-z]+){1,2})\1$/);
  return m && m[1].split(" ").every((w) => w.length > 1 && !NAME_STOP.has(w)) ? m[1].split(" ").map(titleCase).join(" ") : null;
}

/** Lower-case word fragments that independently point at who the candidate is: file name, profile handles, email. */
function evidenceTokens(text: string, fileName: string, links: string[]): Set<string> {
  const bits = [fileName.replace(/\.[^.]+$/, ""), ...links.filter((l) => /linkedin|github|behance|medium/i.test(l))];
  for (const m of text.matchAll(/(?:linkedin\.com\/in\/|github\.com\/)([\w-]+)/gi)) bits.push(m[1]);
  for (const m of text.matchAll(/\b([a-z]+-[a-z]+)(?:-[a-z0-9]+)*\b/g)) bits.push(m[1]); // bare handles: "priya-krishnan-pm"
  for (const e of text.match(EMAIL_STRICT) ?? []) bits.push(e.split("@")[0]);
  const out = new Set<string>();
  for (const b of bits) for (const t of b.toLowerCase().split(/[^a-z]+/)) if (t.length > 2 && !NAME_STOP.has(t)) out.add(t);
  return out;
}

function guessName(text: string, fileName: string, links: string[]): string | null {
  const fromFile = nameFromFile(fileName);
  const evidence = evidenceTokens(text, fileName, links);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 14);
  let best: { name: string; score: number } | null = null;
  let standalone: string | null = null;
  lines.forEach((line, i) => {
    const dbl = doubledHeaderName(line);
    const cands: Array<{ name: string; strong: boolean }> = dbl ? [{ name: dbl, strong: true }] : [];
    const seg = line.split(/\s*[|·•,]\s*|\s{2,}|\s[-–—]\s|[+@\d(]/)[0] ?? "";
    const { run, pure } = nameRun(seg);
    if (run.length >= 2) cands.push({ name: run.join(" "), strong: pure && i < 2 });
    for (const c of cands) {
      const toks = c.name.toLowerCase().split(" ");
      const hits = toks.filter((t) => evidence.has(t)).length;
      if (c.strong && !standalone) standalone = c.name;
      // Eligible: every word is backed by the file name / profile handle / email, or it is a clean name on the
      // first two lines that shares at least one word with that evidence. Earlier lines outweigh later ones,
      // so an employer line further down can't beat the name at the top.
      if (hits === toks.length || (c.strong && hits > 0)) {
        const score = hits * 3 + (i === 0 ? 4 : i === 1 ? 2 : 0) + (c.strong ? 2 : 0);
        if (!best || score > best.score) best = { name: c.name, score };
      }
    }
  });
  const hit = (best as { name: string; score: number } | null)?.name ?? null;
  // The filename may carry the fuller form of a name found in the CV.
  if (hit) return fromFile && fromFile.toLowerCase().startsWith(hit.toLowerCase()) ? fromFile : hit;
  // An uncorroborated line near the top could be a company or heading, so the filename wins over it.
  return fromFile ?? standalone;
}

// ---------------------------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------------------------

const INSTITUTION_ACRONYMS =
  "IIT|IIM|NIT|IIIT|BITS|IMT|XLRI|ISB|SPJIMR|MDI|NMIMS|VJTI|DTU|NSIT|SRCC|LSR|VIT|MICA|TISS|JBIMS|NITIE|IISc|PICT|COEP|RVCE|SIBM|SCMHRD|KJSIEMR";
const INSTITUTION_WORDS = "University|College|Institute|Institution|Polytechnic|Vidyalaya|Academy|School of [A-Z][A-Za-z&]+|Business School|Management School";
export const INSTITUTION_RE = new RegExp(
  // Acronym + optional city/branch word: "IIM Ahmedabad", "NIT Calicut", "IMT Ghaziabad", "BITS Pilani"
  `\\b(?:${INSTITUTION_ACRONYMS})\\b(?:[ \\t-][A-Z][a-z]{2,}(?![A-Za-z]))?` +
    // Up to three capitalised words before University/College/Institute, plus an optional "of X Y" tail.
    // Spaces/tabs only, never newlines, so section headings on the previous line are left alone.
    `|\\b(?:[A-Z][A-Za-z.&'’]*[ \\t]+){0,3}(?:${INSTITUTION_WORDS})\\b(?:[ \\t]+of[ \\t]+[A-Z][A-Za-z&]+(?:[ \\t][A-Z][A-Za-z&]+){0,2})?`,
  "g",
);

const PERSONAL_LINE_RE =
  /^.*\b(date of birth|d\.o\.b\.?|dob|marital status|gender\s*[:\-]|sex\s*[:\-]|religion|nationality|father'?s name|mother'?s name|passport\s*(?:no|number))\b.*$/gim;

const PRONOUNS: Array<[RegExp, string]> = [
  [/\b(?:Mr|Mrs|Ms|Miss|Shri|Smt)\.?\s+/g, ""],
  [/\b(he|she)\b/g, "they"], [/\b(He|She)\b/g, "They"],
  [/\b(his|hers)\b/g, "their"], [/\bher\b/g, "their"], [/\b(His|Her|Hers)\b/g, "Their"],
  [/\bhim\b/g, "them"], [/\bHim\b/g, "Them"],
  [/\b(himself|herself)\b/g, "themself"],
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Personal details never reach the AI model. */
export function redact(text: string, pii: PII): string {
  let out = text.replace(EMAIL_ANY, "[EMAIL]").replace(URL_RE, "[PROFILE_URL]");
  // Phones: any digit run that adds up to a number, including doubled/glued ones.
  out = out.replace(PHONE_RUN, (m) => (phoneDigits(m) ? "[PHONE]" : m));
  out = out.replace(/(\[PHONE\][\s\d+-]*)+/g, "[PHONE] ");
  out = out.replace(PERSONAL_LINE_RE, "[PERSONAL DETAIL REMOVED]");

  // Name: whole words, plus glued forms like "MEHTARohan" or "PATILVivek".
  for (const part of (pii.fullName || "").split(/\s+/).filter((p) => p.length > 2)) {
    const e = escapeRe(part);
    out = out.replace(new RegExp(`\\b${e}\\b`, "gi"), "[CANDIDATE]");
    if (part.length >= 4) {
      out = out.replace(new RegExp(e.toUpperCase(), "g"), "[CANDIDATE]"); // ALLCAPS glued to the next word
      out = out.replace(new RegExp(`(?<![A-Za-z])${e}(?=[A-Z])`, "g"), "[CANDIDATE]"); // Name glued in front of a Capitalised word
      out = out.replace(new RegExp(`(?<=[A-Za-z\\]])${escapeRe(part[0].toUpperCase() + part.slice(1).toLowerCase())}(?![a-z])`, "g"), "[CANDIDATE]"); // ...or behind an ALLCAPS one
    }
  }
  // Profile-handle remnants such as "[CANDIDATE]-[CANDIDATE]-product" collapse to one token.
  out = out.replace(/\[CANDIDATE\](?:[-_.]\[CANDIDATE\])*(?:[-_.][a-z0-9]+)*/g, "[CANDIDATE]");
  out = out.replace(/(\[CANDIDATE\][\s]*){2,}/g, "[CANDIDATE] ");

  // Pedigree and gender are excluded from scoring, so they are removed rather than merely ignored.
  out = out.replace(INSTITUTION_RE, "[INSTITUTION]").replace(/\[INSTITUTION\]\s*\([A-Z]{2,8}\)/g, "[INSTITUTION]");
  for (const [re, rep] of PRONOUNS) out = out.replace(re, rep);
  return out.replace(/[ \t]+\n/g, "\n").trim();
}
