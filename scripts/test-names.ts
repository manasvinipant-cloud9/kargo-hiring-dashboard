// Name/email/phone detection on realistic file names and CV layouts.   npx tsx scripts/test-names.ts
import { extractPII, redact } from "../lib/extract";

const cases: Array<{ file: string; text: string; name: string | null; email?: string | null; links?: string[] }> = [
  { file: "Meera_Venkataraman_Resume.txt", text: "Meera Venkataraman\nProduct Manager | Mumbai\nmeera@gmail.com", name: "Meera Venkataraman", email: "meera@gmail.com" },
  { file: "Resume.pdf", text: "Rohan Desai\nSenior Software Engineer\nrohan.desai.dev@gmail.com | +91 98204 37810", name: "Rohan Desai", email: "rohan.desai.dev@gmail.com" },
  { file: "CV_final(2).pdf", text: "SANDEEP KUMAR\nProduct Manager\nsandeep@x.in", name: "Sandeep Kumar" },
  { file: "Priya Krishnan Product Manager.pdf", text: "Priya Krishnan\nProduct Manager · Mumbai", name: "Priya Krishnan" },
  { file: "Copy of Aditya Shetty CV.docx", text: "Enterprise Sales · B2B SaaS · Logistics\nAditya Shetty\naditya.shetty.sales@gmail.com", name: "Aditya Shetty" },
  { file: "document.pdf", text: "Product Manager\nB2B SaaS\nAnil Kapoor\nanil.kapoor@outlook.com", name: "Anil Kapoor", email: "anil.kapoor@outlook.com" },
  { file: "scan.pdf", text: "Strategy Leader | Corporate Strategy\nExecutive Advisory\ncontact@x.com", name: null },
  { file: "Vikram_Nair_PM.pdf", text: "Vikram Nair\nProduct Manager", name: "Vikram Nair" },
  { file: "resume_v3.pdf", text: "Anne-Marie D'Souza\nProduct Lead\nam@x.com", name: "Anne-Marie D'Souza" },
  { file: "Burger Singh.pdf", text: "Mohit Singh\nProduct Manager\nExperience\nBurger Singh · Product Manager", name: "Mohit Singh", email: null },
  { file: "Kavya Patel.pdf", text: "Credora Capital\nProduct Manager\nkavya.patel@x.com", name: "Kavya Patel", email: "kavya.patel@x.com" },
  { file: "x.pdf", text: "Education\nIIT Delhi\nProduct Manager\nz@x.com", name: null },
  { file: "Harsh_Reddy.pdf", text: "HARSH REDDY\nHARSH REDDYsquad_5@pg27.mesaschool.co", name: "Harsh Reddy", email: "squad_5@pg27.mesaschool.co" },
  { file: "Rahul.pdf", text: "Rahul Gupta\nProduct Manager\nrahul@x.com | linkedin.com/in/rahul-gupta", name: "Rahul Gupta" },
];

let failed = 0;
for (const c of cases) {
  const pii = extractPII(c.text, c.file, c.links);
  const bad: string[] = [];
  if (pii.fullName !== c.name) bad.push(`name ${JSON.stringify(pii.fullName)} ≠ ${JSON.stringify(c.name)}`);
  if (c.email !== undefined && pii.email !== c.email) bad.push(`email ${pii.email} ≠ ${c.email}`);
  if (bad.length) failed++;
  console.log(`${bad.length ? "✗" : "✓"} ${c.file.padEnd(34)} ${bad.join(" | ") || JSON.stringify(pii.fullName)}`);
}

// Redaction never blanks ordinary words.
const red = redact("Meera Venkataraman\nSenior Resume Reviewer. She led the product launch; her team shipped it. Mr. Rao praised him.", { fullName: "Meera Venkataraman", email: null, phone: null });
const ok = /Resume Reviewer/.test(red) && !/\bShe\b|\bher\b|\bhim\b/.test(red) && !/Meera|Venkataraman/.test(red) && !/Mr\./.test(red);
console.log(`${ok ? "✓" : "✗"} redaction keeps ordinary words, neutralises pronouns/titles  → ${JSON.stringify(red)}`);
if (!ok) failed++;
const ph = redact("Phone 98204 37810 and 2018 2019 2020 2021 and FY2022-2023, 800+ shipments, 3 4 hours", { fullName: null, email: null, phone: null });
const ok2 = /\[PHONE\]/.test(ph) && /2018 2019 2020 2021/.test(ph) && /FY2022-2023/.test(ph) && /800\+ shipments/.test(ph) && /3 4 hours/.test(ph);
console.log(`${ok2 ? "✓" : "✗"} phone numbers redacted, year lists and metrics untouched  → ${JSON.stringify(ph)}`);
if (!ok2) failed++;
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
