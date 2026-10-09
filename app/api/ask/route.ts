import { NextResponse } from "next/server";
import { aiAsk } from "@/lib/analyze";
import { activeProvider, LLMUnavailable } from "@/lib/llm";
import { offlineAsk } from "@/lib/offline";
import { parseSegments } from "@/lib/validate";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const segments = parseSegments(body?.segments);
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!segments || !question) return NextResponse.json({ error: "Send { question, segments }" }, { status: 400 });

  const provider = activeProvider();
  if (!provider) return NextResponse.json(offlineAsk(question, segments));
  try {
    return NextResponse.json(await aiAsk(question, segments, provider));
  } catch (error) {
    const note = error instanceof LLMUnavailable ? error.message : "AI answer failed";
    return NextResponse.json({ ...offlineAsk(question, segments), note });
  }
}
