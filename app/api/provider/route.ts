import { NextResponse } from "next/server";
import { activeProvider } from "@/lib/llm";

export const dynamic = "force-dynamic";

// Tells the UI which engine is live (never the key itself).
export function GET() {
  return NextResponse.json({ provider: activeProvider() ?? "offline" });
}
