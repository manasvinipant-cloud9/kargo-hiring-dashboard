# Kargo Hiring Dashboard

Arjun uploads CVs for the Product Manager and Senior Product Manager roles. The app extracts each CV, strips personal details, scores it against **both** rubrics, and returns a ranked shortlist with an interview brief for every candidate and ready-to-send invite and rejection emails. Arjun makes the call. Nothing is emailed until he clicks Send.

## Flow (components map)

| Stage | Actor | What happens | Code |
|---|---|---|---|
| Trigger | Founder | Uploads CVs and picks the applied role (PM / SPM) | `app/page.tsx` |
| Input | Founder | CV file (PDF / DOCX / TXT) + selected role | `POST /api/process` |
| Context | App backend | Extracts text, pulls name/email/phone, **redacts them before the AI sees the CV** | `lib/extract.ts` |
| Processing | App backend | Weights per-criterion scores into PM and SPM totals (0–100), ranks, suggests interview / maybe / reject | `lib/rubric.ts` |
| AI | Gemini | Scores each rubric criterion 0–5 with evidence, writes the interview brief, drafts invite and rejection emails | `lib/gemini.ts` |
| Output | Founder + Resend | Ranked dashboard; Arjun chooses Invite or Reject, edits if he wants, clicks Send | `app/api/candidates/[id]/send` |

## Design decisions

- **Rubric** (`lib/rubric.ts`) is built from `rubric.txt`: JD criteria plus two patterns found in all 5 "Exceeds" past hires ("built something unprompted that got adopted" and "owned a named crisis and institutionalized the fix"). Pedigree, number of certifications and raw years were tested against the past hires and did not predict performance, so the model is told not to reward them.
- **Past-hire ratings are never sent to the model.** They were only used to design the rubric.
- **The AI never sees personal details.** Name, email, phone, profile links, school names, gendered words and personal-detail lines (date of birth, marital status…) are replaced with placeholders. Emails are drafted with `{{first_name}}` and `{{role}}`, filled in by the server at send time.
- **The AI scores; the server does the maths.** Gemini returns 0–5 per criterion with evidence. Weighting, totals and ranking are deterministic code, so rankings can be audited.
- **The cut: no auto-sending.** Arjun wanted everything downstream to happen without him chasing it. The app drafts every email, but a person must choose Invite/Reject and click Send. Bulk send asks for confirmation first.
- **Every CV is scored for both roles.** A PM applicant who fits SPM better shows up with a green ↑ in the other-role column.
- **CV text is treated as untrusted.** The prompt tells the model to ignore instructions embedded in a CV and to flag them as a concern.

## Run locally

```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev                  # http://localhost:3000 (runs open if APP_PASSWORD is empty; never in production)
```

No accounts yet? `npm run demo` starts a seeded dashboard at http://localhost:3200 with a fake database and fake mailer (set `GEMINI_API_KEY` to try real uploads).

## Deploy (Vercel)

1. Import the repo on Vercel and add the variables from `.env.example` (**`APP_PASSWORD` is required**, otherwise the app stays locked).
2. Deploy. The scoring route is limited to 60 s per CV, which Gemini normally meets in 10–20 s.
3. Until you verify a domain in Resend, set `EMAIL_OVERRIDE_TO` to your own address to test safely.

Database schema: `supabase/schema.sql` (unchanged by this version).

## More

- **[docs/LOGIC_MAP.md](docs/LOGIC_MAP.md)**: every pathway, state, API route, failure case and test.
- Tests: `npm run typecheck`, `npm run test:names`, `npm run test:extract -- <folder of CVs>`, `npm run test:e2e -- <folder of CVs>`.
