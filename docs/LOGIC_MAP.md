# Kargo Hiring: logic map

What the app does, every path through it, and what happens when something goes wrong. Everything below is covered by a test (`npm run test:*`) unless marked *not automated*.

## 1. Principles (these must not be broken)

1. **The AI recommends, Arjun decides.** Nothing is emailed until Arjun sets Invite/Reject *and* confirms a send dialog.
2. **The AI never sees personal details.** Name, email, phone, links, school names, gendered words and personal-detail lines are removed before the CV text reaches Gemini.
3. **The AI scores, code does the maths.** Gemini gives 0–5 per criterion with evidence. Weighting, totals, ranking and the suggestion thresholds are plain code in `lib/rubric.ts`.
4. **Fail closed.** No password and no explicit `OPEN_ACCESS=true` means the app is locked. In open mode, real candidates can't be emailed. A failed send is never recorded as sent. A missing AI criterion is never silently scored 0.
5. **No double emails.** Sending claims the row atomically, and Resend also gets an idempotency key.

## 2. Components map

| Stage | What happens | Code |
|---|---|---|
| Trigger | Arjun drops CVs on the page and picks the applied role (PM / SPM / Not sure) | `app/page.tsx`, `app/components/UploadCard.tsx` |
| Input | One CV (PDF, DOCX, TXT; ≤ 4 MB) per request | `POST /api/process` |
| Context | Extract text and links; find name, email, phone; write the redacted text | `lib/extract.ts` |
| Processing | Weighted totals per role, suggestion, rank | `lib/rubric.ts`, `lib/pipeline.ts` |
| AI | One Gemini call: 12 criterion scores with evidence, summary, interview brief, invite and rejection drafts | `lib/gemini.ts` |
| Output | Ranked dashboard → Arjun decides → confirm → Resend | `app/page.tsx`, `app/components/*`, `POST /api/candidates/[id]/send` |

## 3. Candidate lifecycle

Three independent fields in the `candidates` table:

```
status        processing ──► scored          (AI finished)
                  │            
                  └──────────► error           (extraction or AI failed; has a message)
              processing for > 2.5 min  ⇒  shown as "stalled" (derived, not stored)

decision      pending ◄──► invite | reject     (Arjun's call; reversible until sent)

email_status  draft ──► sent                   (locked from now on: no edits, no decision change)
                │
                └──► failed ──► (send again) ──► sent
```

Ranking is per applied role, by that role's score (0–100), highest first, ties broken by upload time. The rank number never changes when you filter or search.

## 4. Pathways

### A. Sign in / out
`/login` → `POST /api/login {password}` → constant-time compare → signed cookie (HMAC, 7 days, httpOnly, never contains the password) → `/`. Middleware checks the cookie on every page and API call.
- Wrong or empty password → 401 after a 0.6 s delay.
- `APP_PASSWORD` not set in production → login returns 503 explaining why; every API call is 401 (fail closed).
- **Open demo** (`OPEN_ACCESS=true`): no login at all, for shared evaluation. It takes precedence over any password and shows an "Open demo" badge and a notice that everyone sees the same candidates. Because anyone can then reach the send button, **sending (and the summary email) is refused with 403 unless test mode (`EMAIL_OVERRIDE_TO`) is on**, in which case every email goes only to that address. Local `npm run dev` without a password also runs open.
- Tampered, forged or expired cookie → 401.
- Sign out clears the cookie.

### B. Upload and score (`POST /api/process`, up to 3 files at a time from the browser)
1. Validate: file present; type pdf/docx/txt/md (415); non-empty (422); ≤ 4 MB (413); role is PM/SPM/AUTO (400). Rejected files create no database row.
2. Insert a row `status=processing`, so it shows up immediately.
3. Extract text (PDF text plus `mailto:` link annotations; DOCX text). Fewer than 200 characters → error "scanned image?".
4. Find name, email, phone → build redacted text (see §6).
5. **Duplicate check**: same file name or same email with identical redacted text, already scored → delete the placeholder, return `duplicate: true`. (Re-uploading an *updated* CV from the same person is kept as a new entry.)
6. Save contact details and redacted text to the row *before* calling AI, so a failure can be retried without re-uploading.
7. Gemini call (time-boxed to 52 s; see §8), validate the answer, compute PM and SPM totals, pick the suggestion for the applied role.
8. "Not sure" (AUTO) files the candidate under the role with the higher total.
9. Save. If the save fails the request fails (previously the row stayed on "Scoring…" forever).

### C. Retry (`POST /api/candidates/[id]/retry`)
Allowed for `error` rows and for rows stalled > 2.5 min. Re-runs step 7 on the stored redacted text. Refused for scored rows (409), rows still being scored (409), and rows with no stored text (422: "upload again").

### D. Decide
- Per row: **Invite** / **Reject** buttons (click again to undo), or in the panel. `PATCH /api/candidates/[id] {decision}`.
- **Accept AI suggestions** (`POST /api/candidates/decide-suggested`): one confirmed action; sets Invite where the AI said *interview* and Reject where it said *reject*, only for undecided, unsent candidates, across both roles. "Maybe" stays Arjun's call. **Sends nothing.**
- Suggestion thresholds (code, `recommend()`): score ≥ 65 interview · 45–64 maybe · < 45 reject. A suggestion only.

### E. Edit
In the panel: name (used in the greeting), email, subject, message. Saved on blur / "Save edits" / before sending. Validation (400): decision must be pending/invite/reject; email must look valid (trimmed, lower-cased); lengths capped. Scores, status and send state cannot be edited from the browser. Everything is locked (409) once the email is sent. Half-typed edits are never overwritten by background refreshes.

### F. Send (`POST /api/candidates/[id]/send`, always after a confirm dialog)
Checks, in order: exists (404) → scored (400) → decision set (400) → not already sent (409) → valid email (400) → non-empty draft (400). Then:
1. **Claim**: `UPDATE … SET email_status='sent' WHERE id=? AND email_status<>'sent'`. Only one of several simultaneous requests wins; the rest get 409.
2. Fill `{{first_name}}` and `{{role}}` into the saved draft, call Resend with idempotency key `kargo-<id>-<type>`. A 429 is retried (up to 2×).
3. Success → row stays `sent` with time and type. Failure → row reverts to `failed` with a plain-English reason, and can be sent again.
- **Test mode**: `EMAIL_OVERRIDE_TO` redirects every email to one address and prefixes the body with "[TEST MODE…]". The header pill, send dialog and panel all say so.
- **Bulk send**: the confirm dialog lists every recipient (and anyone skipped for having no email), then sends one by one with live per-person results.

### G. Summary email to Arjun (`POST /api/review`)
Needs `ARJUN_EMAIL` and Resend. Emails the top five per role, counts, how many are waiting, and a link back.

### H. Remove (`DELETE /api/candidates/[id]`)
Deletes the row, including CV text, scores and drafts (right to erasure). Confirmed in a dialog.

## 5. API reference (all routes except `/login` and `/api/login` require a valid session)

| Route | Method | Purpose |
|---|---|---|
| `/api/login` | POST | Password → session cookie |
| `/api/logout` | POST | Clear cookie |
| `/api/config` | GET | Email configured? test redirect? review available? open access? Gemini configured? |
| `/api/candidates` | GET | All candidates (no stored CV text), with derived `stalled` |
| `/api/candidates/[id]` | PATCH / DELETE | Edit allowed fields / remove |
| `/api/candidates/[id]/send` | POST | Send the decided email (atomic claim) |
| `/api/candidates/[id]/retry` | POST | Re-score from stored text |
| `/api/candidates/decide-suggested` | POST | Adopt AI suggestions for undecided candidates |
| `/api/process` | POST (multipart) | Upload, redact, score one CV |
| `/api/review` | POST | Email Arjun the summary |

## 6. What is removed before the AI sees a CV (`redact()`)

| Removed | Replaced by |
|---|---|
| Emails | `[EMAIL]` |
| Phone numbers, including numbers printed twice and glued together by PDFs | `[PHONE]` (year lists like "2018 2019 2020" and metrics are left alone) |
| Web addresses and profile links (LinkedIn, GitHub…) and handle fragments | `[PROFILE_URL]` / `[CANDIDATE]` |
| The candidate's own name, including glued forms like `MEHTARohan` | `[CANDIDATE]` |
| School, college, university and institute names (IIT, IIM, "… University", …) | `[INSTITUTION]` |
| Lines with date of birth, marital status, gender, religion, nationality, passport… | `[PERSONAL DETAIL REMOVED]` |
| he/she/his/her/him, Mr/Mrs/Ms | they/their/them, (title dropped) |

Kept: employers, job titles, dates, cities of work, and every achievement, because the rubric scores those.

How the name is found (it drives both redaction and the email greeting): a clean name on the first two CV lines that is backed by the file name, a profile handle or the email; otherwise the file name; otherwise a standalone top line; otherwise none ("Hi there,"). Section headings, employers and institutions are never taken as names. Arjun can correct name and email in the panel.

## 7. Scoring (`lib/rubric.ts`)

PM and SPM each have six weighted criteria (weights sum to 100). Three of them mirror the spec; the rest are patterns found in Arjun's best past hires that the job spec never asked for (shown with a green "not in JD" tag). Gemini returns an integer 0–5 and one line of evidence per criterion; the server rescales to 0–100. Pedigree, certifications, tool lists and raw years are explicitly not rewarded. The other role's score is shown beside each candidate, with ↑ when they fit it clearly better.

## 8. Failure and edge-case matrix

| Situation | What happens |
|---|---|
| Unsupported / empty / oversize file | Rejected with a message; no row created |
| Scanned PDF (no text) | Row shows "Failed: could not read enough text"; remove and upload a text version |
| Same CV uploaded twice | Detected; queue says "already added"; no second row |
| Gemini slow, rate-limited (429) or overloaded (5xx) | Pause and retry, then the fallback model; each call has a hard timeout; whole step ends at 52 s |
| Gemini model retired (404) | Falls back to the second model |
| Gemini returns truncated, malformed or incomplete JSON | Re-asked; if still bad the row fails with the reason (never saved with 0s) |
| Gemini key invalid | Fails immediately with Google's reason |
| Function killed by the platform mid-scoring | Row shows "timed out" after 2.5 min; **Retry scoring** uses the stored text |
| Name not found / email not found | Row flagged "no email"; fix in the panel; sending is blocked until an address exists |
| Resend test-mode restriction (can only send to your own address) | 502 with the fix spelled out; row = `failed`; nothing delivered |
| Resend key invalid, Resend down | Clear message; row = `failed`; can be sent again |
| Double-click / "send all" plus single send | One email; the others are refused (409) |
| Edit or change decision after sending | Refused (409): record is locked |
| Two people with the same email | Both kept; sending uses each row's saved address |
| *Not automated:* process killed between "claimed" and Resend's reply | Row shows sent without delivery. Very rare; Resend's idempotency key prevents a duplicate if the same send is repeated |

## 9. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only. Schema: `supabase/schema.sql` |
| `GEMINI_API_KEY` | yes | `GEMINI_MODEL` (default `gemini-3.8-flash`), `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash`) |
| `APP_PASSWORD` | one of these two in production | Password gate. `AUTH_SECRET` optional (signs sessions; defaults to the password) |
| `OPEN_ACCESS` | one of these two in production | `true` = no login (shared demo). Sending needs `EMAIL_OVERRIDE_TO` in this mode |
| `RESEND_API_KEY` | to send | `RESEND_FROM`, `REPLY_TO` optional |
| `EMAIL_OVERRIDE_TO` | for testing | Redirects every email to this address |
| `ARJUN_EMAIL` | optional | Enables "Email me a summary" |

## 10. Open decisions for the owner

- **Rubric.** This app scores each candidate with *one* 0–100 number per role. The separate rubric document in the case (`kargo-pm-spm-rubric.md`) asks for two independent axes (role fit, and a Kargo success profile) that are never combined, read through a 2×2. They are different designs; this repo implements the first.
- **"Not sure" uploads** that fail and are retried are retried as the stored role (PM), because the original "not sure" choice isn't stored.
- **Hosting limits.** Scoring must finish inside Vercel's function limit (60 s here). Resend without a verified domain only delivers to your own address.

## 11. Tests

| Command | Covers |
|---|---|
| `npm run typecheck` | Types |
| `npm run test:extract -- <folder>` | Extraction and redaction on a folder of real CVs: leaks, wrong contact details, over-redaction |
| `npm run test:names` | Name/email detection on realistic file names and layouts; redaction does not mangle ordinary text |
| `npx tsx scripts/test-gemini.ts [--slow]` | Every AI failure mode with a stubbed Gemini; `--slow` proves a hung call ends inside 60 s |
| `npm run test:e2e -- <folder>` | Whole app on a production build against a fake database (same constraints as the schema) and fake Resend, with the real Gemini API: access control, validation, scoring, duplicates, retry, stalled rows, decisions, bulk accept, the double-send race, mail failures, review email, removal. Needs `GEMINI_API_KEY` and a build (`npm run build`) |
| `APP_PASSWORD=… npx tsx scripts/smoke-live.ts <url> [--send]` | A deployed instance with the real database and Gemini: sign-in, config, upload and score a synthetic CV, duplicate detection, decision, delete. `--send` only works while the server is in test mode, so a real candidate can never be emailed |
| `npm run demo` | Seeded demo at http://localhost:3200 with every state, using the fakes |
