import { NextResponse } from "next/server";
import { aiRecap, offlineRecap } from "@/lib/analyze";
import { activeProvider, LLMUnavailable } from "@/lib/llm";
import { parseSegments } from "@/lib/validate";

export const maxDuration = 300; // long lectures take a while to analyze

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const segments = parseSegments(body?.segments);
  if (!segments) return NextResponse.json({ error: "Send { segments: [{start, end, text}, ...] }" }, { status: 400 });

  const provider = body?.offline ? null : activeProvider();
  if (!provider) return NextResponse.json({ recap: offlineRecap(segments) });
  try {
    return NextResponse.json({ recap: await aiRecap(segments, provider) });
  } catch (error) {
    // Any AI failure still gets the user a recap - just the offline one, with a note why.
    const note = error instanceof LLMUnavailable ? error.message : "AI analysis failed";
    console.error("analyze:", error);
    return NextResponse.json({ recap: offlineRecap(segments), note });
  }
}
