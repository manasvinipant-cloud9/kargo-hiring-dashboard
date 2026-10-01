// One explicit bulk action by Arjun: adopt the AI's suggestion for every undecided candidate
// ("interview" -> Invite, "reject" -> Reject). "Maybe" stays his call. This only sets decisions; nothing is emailed.
import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function POST() {
  const supabase = db();
  let invited = 0;
  let rejected = 0;
  for (const [rec, decision] of [["interview", "invite"], ["reject", "reject"]] as const) {
    const { data, error } = await supabase
      .from("candidates").update({ decision })
      .eq("status", "scored").eq("decision", "pending").eq("email_status", "draft").eq("recommendation", rec).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (decision === "invite") invited = data?.length ?? 0; else rejected = data?.length ?? 0;
  }
  return NextResponse.json({ invited, rejected });
}
