// Placeholder filling shared by the server (send time) and the browser (preview).
// Emails are drafted once with {{first_name}} and {{role}}; they are filled in as late as possible
// so a corrected name, or a candidate moved to the other role, is always reflected.
import type { Role } from "./rubric";

export const roleName = (r: Role) => (r === "PM" ? "Product Manager" : "Senior Product Manager");

export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName || "").trim().split(/\s+/)[0];
  return first || "there";
}

export function fillVars(text: string | null | undefined, c: { full_name: string | null; applied_role: Role }): string {
  return (text || "")
    .replace(/\{\{\s*first_name\s*\}\}/g, firstNameOf(c.full_name))
    .replace(/\{\{\s*role\s*\}\}/g, roleName(c.applied_role));
}
