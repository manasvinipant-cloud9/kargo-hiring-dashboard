// Password gate. Arjun is the only user. Sessions are signed (HMAC) and expire; the password itself is never stored in a cookie.
// Works in the Edge runtime (middleware) and Node via Web Crypto.
export const COOKIE = "kargo_session";
const MAX_AGE_S = 60 * 60 * 24 * 7;

const enc = new TextEncoder();
const secret = () => process.env.AUTH_SECRET?.trim() || process.env.APP_PASSWORD?.trim() || "";

/**
 * Access modes:
 *  - OPEN_ACCESS=true  → no login at all (shared demo / evaluation). Sending real email is blocked unless test mode is on.
 *  - APP_PASSWORD set  → password gate.
 *  - neither           → locked in production (fails closed); open only under local `npm run dev`.
 */
export const authConfigured = () => Boolean(process.env.APP_PASSWORD?.trim());
export const openAccess = () =>
  process.env.OPEN_ACCESS?.trim().toLowerCase() === "true" || (!authConfigured() && process.env.NODE_ENV !== "production");

/** In open mode anyone can reach the send button, so real candidates may only be emailed via the test redirect. */
export const sendBlockedInOpenMode = () => openAccess() && !process.env.EMAIL_OVERRIDE_TO?.trim();

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function passwordMatches(input: string): Promise<boolean> {
  if (!authConfigured()) return false;
  return safeEqual(await hmac(`pw:${input}`), await hmac(`pw:${process.env.APP_PASSWORD!.trim()}`));
}

export async function makeSession(): Promise<{ value: string; maxAge: number }> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  return { value: `${exp}.${await hmac(`session:${exp}`)}`, maxAge: MAX_AGE_S };
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token || !authConfigured()) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now() / 1000)) return false;
  return safeEqual(sig, await hmac(`session:${exp}`));
}
