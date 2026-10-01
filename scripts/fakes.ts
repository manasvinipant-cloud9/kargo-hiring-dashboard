// Test doubles: a minimal PostgREST (Supabase) server that enforces the same check constraints as
// supabase/schema.sql, and a fake Resend. Used only by scripts/e2e.ts.
import http from "node:http";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
const CHECKS: Record<string, string[]> = {
  applied_role: ["PM", "SPM"], status: ["processing", "scored", "error"], recommendation: ["interview", "maybe", "reject"],
  decision: ["pending", "invite", "reject"], email_status: ["draft", "sent", "failed"], sent_email_type: ["invite", "rejection"],
};

export function startFakeSupabase(port: number) {
  const table: Row[] = [];
  const send = (res: http.ServerResponse, code: number, body?: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const filters = (u: URL) => {
    const preds: Array<(r: Row) => boolean> = [];
    for (const [k, v] of u.searchParams) {
      if (["select", "order", "limit", "offset", "columns"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      if (op === "eq") preds.push((r) => String(r[k] ?? "") === val && r[k] !== null);
      else if (op === "neq") preds.push((r) => String(r[k] ?? "") !== val);
      else if (op === "in") { const set = val.slice(1, -1).split(","); preds.push((r) => set.includes(String(r[k]))); }
      else if (op === "is") preds.push((r) => (val === "null" ? r[k] == null : r[k] != null));
    }
    return (r: Row) => preds.every((p) => p(r));
  };
  const violates = (r: Row) => Object.entries(CHECKS).find(([c, ok]) => r[c] != null && !ok.includes(String(r[c])));
  const project = (r: Row, sel: string | null) => {
    if (!sel || sel === "*") return r;
    const out: Row = {}; for (const c of sel.split(",")) out[c] = r[c] ?? null; return out;
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const u = new URL(req.url!, `http://127.0.0.1:${port}`);
      if (u.pathname === "/__rows") return send(res, 200, table);
      if (u.pathname === "/__insert") { const r = JSON.parse(Buffer.concat(chunks).toString()); table.push(r); return send(res, 200, r); }
      if (!u.pathname.endsWith("/candidates")) return send(res, 404, { message: "unknown table" });
      const wantRep = /return=representation/.test(String(req.headers.prefer));
      const single = /pgrst\.object/.test(String(req.headers.accept));
      const sel = u.searchParams.get("select");
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      const respond = (rows: Row[], created = false) => {
        if (!wantRep && req.method !== "GET") return send(res, created ? 201 : 204);
        const out = rows.map((r) => project(r, sel));
        if (single) return out.length === 1 ? send(res, created ? 201 : 200, out[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${out.length} rows` });
        return send(res, created ? 201 : 200, out);
      };
      const now = () => new Date().toISOString();
      if (req.method === "POST") {
        const row: Row = { id: randomUUID(), created_at: now(), updated_at: now(), status: "processing", decision: "pending", email_status: "draft",
          full_name: null, email: null, phone: null, redacted_text: null, error: null, ...body };
        if (!row.file_name || !row.applied_role) return send(res, 400, { code: "23502", message: "null value violates not-null constraint" });
        const v = violates(row); if (v) return send(res, 400, { code: "23514", message: `new row for relation "candidates" violates check constraint "candidates_${v[0]}_check"` });
        table.push(row); return respond([row], true);
      }
      if (req.method === "PATCH") {
        const hit = table.filter(filters(u)); const stage = hit.map((r) => ({ ...r, ...body, updated_at: now() }));
        for (const s of stage) { const v = violates(s); if (v) return send(res, 400, { code: "23514", message: `new row violates check constraint "candidates_${v[0]}_check"` }); }
        stage.forEach((s, i) => Object.assign(hit[i], s)); return respond(hit);
      }
      if (req.method === "DELETE") { const hit = table.filter(filters(u)); hit.forEach((r) => table.splice(table.indexOf(r), 1)); return respond(hit); }
      let rows = table.filter(filters(u));
      const order = u.searchParams.get("order");
      if (order) { const [col, dir] = order.split("."); rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === "desc" ? -1 : 1)); }
      return respond(rows);
    });
  });
  server.listen(port);
  return { table, close: () => server.close() };
}

export function startFakeResend(port: number) {
  const sent: Array<{ to: string[]; subject: string; text: string; key?: string }> = [];
  const seen = new Map<string, string>();
  const state = { mode: "ok" as "ok" | "test-mode-403" | "bad-key" | "429-once", delayMs: 0, hits429: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const j = (code: number, b: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(b)); };
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.url === "/__sent") return j(200, sent);
      if (req.url === "/__mode") { Object.assign(state, body); state.hits429 = 0; return j(200, state); }
      setTimeout(() => {
        if (state.mode === "bad-key") return j(401, { name: "validation_error", message: "API key is invalid" });
        if (state.mode === "test-mode-403") return j(403, { name: "validation_error", message: "You can only send testing emails to your own email address (me@example.com). To send emails to other recipients, please verify a domain." });
        if (state.mode === "429-once" && state.hits429++ === 0) return j(429, { name: "rate_limit_exceeded", message: "Too many requests" });
        const key = String(req.headers["idempotency-key"] || "");
        if (key && seen.has(key)) return j(200, { id: seen.get(key) });
        const id = `msg_${sent.length + 1}`; if (key) seen.set(key, id);
        sent.push({ to: body.to, subject: body.subject, text: body.text, key });
        j(200, { id });
      }, state.delayMs);
    });
  });
  server.listen(port);
  return { sent, state, close: () => server.close() };
}
