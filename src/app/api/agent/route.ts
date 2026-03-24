import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { TASKFLOW_MEL } from '@/domain/taskflow-schema';
import { resolve } from '@/lib/resolver';
import { lower } from '@/lib/lower';
import type { IntentIR } from '@/types/intent-ir';
import type { AgentRequest, AgentResponse, ConversationTurn, IntentResult } from '@/types/intent';

const SYSTEM_PROMPT = `You are a semantic parser. Given a domain schema in MEL and the user's message, output an Intent IR JSON object.

## Domain Schema
\`\`\`mel
${TASKFLOW_MEL}
\`\`\`

## Intent IR Format
\`\`\`
{
  "v": "0.2",
  "force": "DO" | "ASK",
  "event": { "lemma": "<verb>", "class": "<category>" },
  "args": { "<ROLE>": <Term> },
  "time": { "role": "DEADLINE", "value": "<raw expression>" }
}
\`\`\`

## Event Lemmas
create (CREATE), update (TRANSFORM), move (TRANSFORM), delete (DESTROY),
restore (CONTROL), destroy (DESTROY), empty (CONTROL), select (CONTROL),
show (CONTROL), query (OBSERVE)

## Roles
TARGET: entity being acted on (task reference)
THEME: content/value (title, question, view mode)
DEST: destination (status to move to)
BENEFICIARY: person (assignee)
INSTRUMENT: context/description
SOURCE: tags

## Term Types
- { "kind": "literal", "value": "..." }
- { "kind": "ref", "anchor": "that"|"this"|"last"|"title", "value": "..." }
- { "kind": "status", "value": "todo"|"in-progress"|"review"|"done" }
- { "kind": "priority", "value": "low"|"medium"|"high" }
- { "kind": "view", "value": "kanban"|"todo"|"table"|"trash" }

## Rules
- Output semantic meaning, NOT execution details
- Keep time.value as raw text ("내일", "next friday") — do NOT compute dates
- Use ref anchor "that"/"this" for discourse references ("그 작업", "아까 그거")
- Use ref anchor "title" with value for named references ("발표자료 준비")
- For questions (force: ASK), put the question in THEME as literal

## Examples
User: "할일 추가: 사과 사기"
→ {"v":"0.2","force":"DO","event":{"lemma":"create","class":"CREATE"},"args":{"THEME":{"kind":"literal","value":"사과 사기"}}}

User: "그 작업 삭제해"
→ {"v":"0.2","force":"DO","event":{"lemma":"delete","class":"DESTROY"},"args":{"TARGET":{"kind":"ref","anchor":"that"}}}

User: "발표자료 준비를 완료로 옮겨"
→ {"v":"0.2","force":"DO","event":{"lemma":"move","class":"TRANSFORM"},"args":{"TARGET":{"kind":"ref","anchor":"title","value":"발표자료 준비"},"DEST":{"kind":"status","value":"done"}}}

User: "내일까지 민수한테 디자인 시안 받기, 급해"
→ {"v":"0.2","force":"DO","event":{"lemma":"create","class":"CREATE"},"args":{"THEME":{"kind":"literal","value":"디자인 시안 받기"},"BENEFICIARY":{"kind":"literal","value":"민수"},"DEST":{"kind":"priority","value":"high"}},"time":{"role":"DEADLINE","value":"내일"}}`;

function buildMessages(
  message: string,
  snapshot: { tasks: AgentRequest['tasks']; viewMode: string },
  history: ConversationTurn[],
): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  const context = JSON.stringify({
    today: new Date().toISOString().split('T')[0],
    snapshot: { tasks: snapshot.tasks, viewMode: snapshot.viewMode },
  });

  messages.push({ role: 'user', content: `${context}\n\n${message}` });
  return messages;
}

export async function POST(request: Request): Promise<NextResponse<AgentResponse>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { intent: null, message: 'OPENAI_API_KEY is not configured.', executed: false },
      { status: 503 },
    );
  }

  let body: AgentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { intent: null, message: 'Invalid request body.', executed: false },
      { status: 400 },
    );
  }

  const { message, tasks, viewMode, history } = body;
  if (!message || typeof message !== 'string') {
    return NextResponse.json(
      { intent: null, message: 'Message is required.', executed: false },
      { status: 400 },
    );
  }

  const client = new OpenAI({ apiKey });
  const messages = buildMessages(
    message,
    { tasks: tasks ?? [], viewMode: viewMode ?? 'kanban' },
    history ?? [],
  );

  try {
    // 1. LLM → Intent IR (non-deterministic boundary)
    const response = await client.chat.completions.create({
      model: 'gpt-5.4-nano-2026-03-17',
      max_completion_tokens: 512,
      messages,
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content ?? '';
    let ir: IntentIR;
    try {
      ir = JSON.parse(text) as IntentIR;
    } catch {
      return NextResponse.json({
        intent: { kind: 'query', question: message, answer: text } as IntentResult,
        message: text,
        executed: false,
      });
    }

    // Handle ASK force as query
    if (ir.force === 'ASK' && ir.args?.THEME?.kind === 'literal') {
      const answer = typeof ir.args.THEME.value === 'string' ? ir.args.THEME.value : '';
      return NextResponse.json({
        intent: { kind: 'query', question: message, answer } as IntentResult,
        message: answer,
        executed: false,
      });
    }

    // 2. Resolve (deterministic)
    const today = new Date().toISOString().split('T')[0];
    const resolved = resolve(ir, {
      tasks: tasks ?? [],
      history: history ?? [],
      today,
    });

    if ('code' in resolved) {
      return NextResponse.json({
        intent: null,
        message: '',
        executed: false,
        inquiry: {
          question: resolved.message,
          field: resolved.field,
          candidates: resolved.candidates,
        },
      });
    }

    // 3. Lower (deterministic)
    const intent = lower(resolved);

    if ('kind' in intent && intent.kind === 'lower_error') {
      return NextResponse.json({
        intent: null,
        message: `Lowering failed: ${(intent as { message: string }).message}`,
        executed: false,
      });
    }

    const responseMessage =
      intent.kind === 'query' && 'answer' in intent && typeof intent.answer === 'string'
        ? intent.answer
        : '';

    return NextResponse.json({ intent, message: responseMessage, executed: false });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { intent: null, message: `Agent error: ${errMessage}`, executed: false },
      { status: 502 },
    );
  }
}
