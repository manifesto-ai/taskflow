import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import type { RespondRequest, RespondResponse } from '@/types/intent';

const RESPONSE_SYSTEM_PROMPT = `You are a friendly task assistant. Given the user's original message, the structured intent that was parsed, and the execution result, generate a brief, natural response in the same language the user used.

Rules:
- Confirm what was done, mentioning key details (title, assignee, due date, etc.)
- If execution failed, explain why helpfully
- Keep it conversational and concise (1-2 sentences)
- Match the user's language (Korean → Korean, English → English)
- Do NOT use markdown or formatting — plain text only`;

export async function POST(request: Request): Promise<NextResponse<RespondResponse>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { message: 'API key not configured.' },
      { status: 503 },
    );
  }

  let body: RespondRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const { userMessage, intent, executionResult } = body;

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5.4-nano-2026-03-17',
      max_completion_tokens: 256,
      messages: [
        { role: 'system', content: RESPONSE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `User said: "${userMessage}"
Parsed intent: ${JSON.stringify(intent)}
Execution: ${executionResult.executed ? 'Success' : 'Failed'} — ${executionResult.description}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? executionResult.description;

    return NextResponse.json({ message: text });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { message: `Response generation failed: ${errMessage}` },
      { status: 502 },
    );
  }
}
