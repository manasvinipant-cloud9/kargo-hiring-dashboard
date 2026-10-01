// Output step: send via Resend, only when the founder clicks Send.
export function mailStatus() {
  return {
    configured: Boolean(process.env.RESEND_API_KEY?.trim()),
    testRedirect: process.env.EMAIL_OVERRIDE_TO?.trim() || null,
    reviewTo: process.env.ARJUN_EMAIL?.trim() || null,
  };
}

export class SendError extends Error {}

function friendly(status: number, raw: string): string {
  let msg = raw;
  try { msg = JSON.parse(raw).message || raw; } catch { /* keep raw */ }
  if (/only send testing emails/i.test(msg)) {
    return "Resend is in test mode and only delivers to the address on your Resend account. Verify a domain in Resend, or set EMAIL_OVERRIDE_TO to your own address.";
  }
  if (status === 401 || /api key is invalid/i.test(msg)) return "Resend rejected the API key. Check RESEND_API_KEY.";
  if (status === 429) return "Resend is rate-limiting. Wait a few seconds and press Send again.";
  return `Resend ${status}: ${msg.slice(0, 200)}`;
}

export async function sendEmail(opts: { to: string; subject: string; body: string; idempotencyKey?: string }) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new SendError("RESEND_API_KEY is not set on the server");
  const from = process.env.RESEND_FROM?.trim() || "Kargo Hiring <onboarding@resend.dev>";
  const redirect = process.env.EMAIL_OVERRIDE_TO?.trim();
  const to = redirect || opts.to;
  const text = redirect ? `[TEST MODE: this email was meant for ${opts.to}]\n\n${opts.body}` : opts.body;
  const url = `${process.env.RESEND_API_URL?.trim() || "https://api.resend.com"}/emails`;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  // Resend de-duplicates repeats of the same key for 24h, a second guard against double sends.
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const payload = JSON.stringify({ from, to: [to], reply_to: process.env.REPLY_TO?.trim() || undefined, subject: opts.subject, text });

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new SendError(e instanceof Error && e.name === "TimeoutError" ? "Resend did not respond in time. Check the dashboard before retrying." : `Could not reach Resend: ${String(e)}`);
    }
    if (res.status === 429 && attempt < 2) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    if (!res.ok) throw new SendError(friendly(res.status, (await res.text()).slice(0, 400)));
    return { id: ((await res.json()) as { id: string }).id, deliveredTo: to, redirected: Boolean(redirect) };
  }
}
