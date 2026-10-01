import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { LIST_COLUMNS, withDerived } from "@/lib/candidates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await db().from("candidates").select(LIST_COLUMNS).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json((data as unknown as Array<{ status: string; updated_at: string }>).map(withDerived));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
