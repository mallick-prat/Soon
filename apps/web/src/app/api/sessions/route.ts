import { NextResponse } from "next/server";
import { loadUpcoming } from "@/lib/data";

export const dynamic = "force-dynamic";

/** list unresolved sessions in spec order (same view the /upcoming page uses) */
export async function GET() {
  const result = await loadUpcoming();
  return NextResponse.json(result);
}
