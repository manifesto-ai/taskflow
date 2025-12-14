/**
 * Simple Intent API Stream Route (SSE)
 *
 * 2-LLM Architecture:
 * 1st LLM: Intent parsing (structure user intent)
 * 2nd LLM: Response generation (natural language response based on execution result)
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { Intent } from '@/lib/agents/intent';
import { validateIntent } from '@/lib/agents/intent';
import { executeIntent, type Snapshot, type ExecutionResult } from '@/lib/agents/runtime';
import type { AgentEffect } from '@/lib/agents/types';
import { ratelimit, getClientId, isRateLimitConfigured } from '@/lib/rate-limit';

// ============================================
// Request Type
// ============================================

interface SimpleIntentRequest {
  instruction: string;
  snapshot: Snapshot;
}

// ============================================
// 1st LLM: Intent Parser Prompt
// ============================================

function getIntentParserPrompt(): string {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayStr = now.toISOString().split('T')[0];
  const dayOfWeek = days[now.getDay()];

  // Calculate tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  return `You are an Intent Parser. Convert natural language into structured Intent JSON.

## Today: ${todayStr} (${dayOfWeek})
## Tomorrow: ${tomorrowStr}

## Output Format (JSON only, NO message field)
{
  "kind": "...",
  "confidence": 0.9,
  "source": "human",
  ...kind-specific fields
}

## Intent Types
| kind | When to use | Key fields |
|------|-------------|------------|
| CreateTask | Add new task(s) | tasks: [{ title, priority?, dueDate?, tags? }] |
| ChangeStatus | Complete/start/change task state | taskId, toStatus: "todo"|"in-progress"|"review"|"done" |
| UpdateTask | Modify task properties | taskId, changes: { title?, priority?, dueDate?, assignee?, description?, tags? } |
| DeleteTask | Remove a task | taskId |
| RestoreTask | Restore deleted task | taskId |
| SelectTask | View/open a task | taskId (null to deselect) |
| QueryTasks | Question about tasks or greeting/chat | query |
| ChangeView | Switch view mode | viewMode: "kanban"|"table"|"todo" |
| SetDateFilter | Filter by date | filter: { field: "dueDate"|"createdAt", type: "today"|"week"|"month" } or null |
| Undo | Undo last action | (no extra fields) |
| RequestClarification | Truly ambiguous | reason, question, originalInput |

## Rules
1. **Match tasks by meaning** - Find tasks by keywords from task list. Use exact taskId.
2. **"this/it" = selected task** - Refer to Currently Selected Task in context.
3. **Calculate dates** - "tomorrow" → ${tomorrowStr}, "next Tuesday" → compute YYYY-MM-DD.
4. **Questions & Chat → QueryTasks** - Greetings, questions, casual chat all use QueryTasks.
5. **User's words = task title** - Use exactly what the user says as the title. "사과사기 추가" → title: "사과사기". "buy milk" → title: "buy milk". Don't overthink.
6. **Assign = UpdateTask** - "assign to X" → UpdateTask with changes.assignee.
7. **RequestClarification is RARE** - Only use when 2+ existing tasks match the same keyword (which_task) or user literally says "add a task" with no content at all.

⚠️ DO NOT include "message" or "answer" fields. Only structured intent data.`;
}

// ============================================
// 2nd LLM: Response Generator
// ============================================

function getResponseGeneratorPrompt(): string {
  return `You are a friendly Task Assistant. Generate natural, conversational responses.

## Rules
1. **Respond in the SAME LANGUAGE as the user's input** (detect from User's Original Request)
2. Be concise (1-2 sentences max)
3. For task operations: briefly confirm what was done
4. For QueryTasks: answer the user's question based on the task data provided
5. For off-topic questions (weather, news, etc.): politely say you can only help with tasks
6. For greetings: respond warmly and offer to help with tasks
7. Be friendly and human-like

## Output Format (JSON)
{ "message": "your response" }`;
}

interface ResponseGeneratorInput {
  instruction: string;
  intent: Intent;
  executionResult: ExecutionResult;
  snapshot: Snapshot;
}

async function generateResponse(
  openai: OpenAI,
  input: ResponseGeneratorInput
): Promise<string> {
  const { instruction, intent, executionResult, snapshot } = input;

  // Build context for response generation
  const activeTasks = snapshot.data.tasks.filter(t => !t.deletedAt);
  const tasksSummary = {
    total: activeTasks.length,
    byStatus: {
      todo: activeTasks.filter(t => t.status === 'todo').length,
      'in-progress': activeTasks.filter(t => t.status === 'in-progress').length,
      review: activeTasks.filter(t => t.status === 'review').length,
      done: activeTasks.filter(t => t.status === 'done').length,
    },
  };

  // For QueryTasks, include task list for answering questions
  let taskContext = '';
  if (intent.kind === 'QueryTasks') {
    taskContext = `\n\n## Task List (for answering questions)
${activeTasks.map(t => `- "${t.title}" (${t.status}, ${t.priority}${t.dueDate ? `, due: ${t.dueDate}` : ''})`).join('\n')}`;
  }

  const userMessage = `## User's Original Request
"${instruction}"

## Action Taken
- Intent: ${intent.kind}
- Execution: ${executionResult.success ? 'SUCCESS' : `FAILED - ${executionResult.error}`}
${intent.kind === 'CreateTask' ? `- Created tasks: ${(intent as { tasks: { title: string }[] }).tasks.map(t => t.title).join(', ')}` : ''}
${intent.kind === 'ChangeStatus' ? `- Changed status to: ${(intent as { toStatus: string }).toStatus}` : ''}
${intent.kind === 'ChangeView' ? `- Changed view to: ${(intent as { viewMode: string }).viewMode}` : ''}
${intent.kind === 'QueryTasks' ? `- Query: ${(intent as { query: string }).query}` : ''}
${intent.kind === 'RequestClarification' ? `- Reason: ${(intent as { reason: string }).reason}\n- Question hint: ${(intent as { question: string }).question}` : ''}

## Current State
- Total tasks: ${tasksSummary.total}
- By status: todo=${tasksSummary.byStatus.todo}, in-progress=${tasksSummary.byStatus['in-progress']}, review=${tasksSummary.byStatus.review}, done=${tasksSummary.byStatus.done}
- View mode: ${snapshot.state.viewMode}${taskContext}

Generate a natural response message.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: getResponseGeneratorPrompt() },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 200,
    });

    const content = completion.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content) as { message: string };
      if (parsed.message) {
        return parsed.message;
      }
    }
  } catch (e) {
    console.error('Response generation failed:', e);
  }

  // Fallback to simple message
  return getDefaultMessage(intent);
}

function getDefaultMessage(intent: Intent): string {
  const messages: Record<string, string> = {
    CreateTask: 'Added the task.',
    ChangeStatus: 'Changed the status.',
    UpdateTask: 'Updated the task.',
    DeleteTask: 'Deleted the task.',
    RestoreTask: 'Restored the task.',
    SelectTask: 'Selected the task.',
    QueryTasks: "Here's what I found.",
    ChangeView: 'Changed the view.',
    SetDateFilter: 'Applied the filter.',
    Undo: 'Undid the last action.',
    RequestClarification: (intent as { question?: string }).question || 'Need clarification.',
  };

  return messages[intent.kind] || 'Done.';
}

// ============================================
// SSE Helper
// ============================================

function sendSSE(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

// ============================================
// Main Handler (2-LLM Architecture)
// ============================================

export async function POST(request: NextRequest) {
  // Rate limiting
  if (isRateLimitConfigured()) {
    const clientId = getClientId(request);
    const { success, limit, reset, remaining } = await ratelimit.limit(clientId);

    if (!success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body: SimpleIntentRequest = await request.json();
        const { instruction, snapshot } = body;

        if (!instruction) {
          sendSSE(controller, 'error', { error: 'Instruction is required' });
          controller.close();
          return;
        }

        if (!process.env.OPENAI_API_KEY) {
          sendSSE(controller, 'error', { error: 'OPENAI_API_KEY not configured' });
          controller.close();
          return;
        }

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // 1. Start event
        sendSSE(controller, 'start', {});

        // 2. Build user message for Intent Parser (1st LLM)
        const activeTasks = snapshot.data.tasks.filter(t => !t.deletedAt);
        const taskListForLLM = activeTasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
        }));

        const selectedTask = snapshot.state.selectedTaskId
          ? activeTasks.find(t => t.id === snapshot.state.selectedTaskId)
          : null;

        const intentParserMessage = `## Current Tasks
${JSON.stringify(taskListForLLM, null, 2)}

## Currently Selected Task
${selectedTask
  ? `ID: ${selectedTask.id}\nTitle: "${selectedTask.title}"\nStatus: ${selectedTask.status}\nPriority: ${selectedTask.priority}`
  : 'None (no task is currently selected)'}

## Current View State
- View Mode: ${snapshot.state.viewMode}
- Date Filter: ${snapshot.state.dateFilter ? JSON.stringify(snapshot.state.dateFilter) : 'none'}

## User Instruction
${instruction}

Output only a valid JSON Intent object (no message field).`;

        // 3. 1st LLM Call: Intent Parsing
        const intentCompletion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: getIntentParserPrompt() },
            { role: 'user', content: intentParserMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 500,
        });

        const intentContent = intentCompletion.choices[0]?.message?.content;
        if (!intentContent) {
          sendSSE(controller, 'error', { error: 'No response from Intent Parser' });
          controller.close();
          return;
        }

        // 4. Parse Intent JSON
        let intent: Intent;
        try {
          intent = JSON.parse(intentContent);
        } catch {
          sendSSE(controller, 'error', { error: `Invalid JSON from Intent Parser: ${intentContent}` });
          controller.close();
          return;
        }

        // 5. Validate Intent
        const validation = validateIntent(intent);
        if (!validation.valid) {
          sendSSE(controller, 'error', { error: `Intent validation failed: ${validation.errors.join(', ')}` });
          controller.close();
          return;
        }

        // 6. Send intent event
        sendSSE(controller, 'intent', { intent });

        // 7. Execute Intent
        const executionResult = executeIntent(intent, snapshot);

        // 8. 2nd LLM Call: Generate Response
        const message = await generateResponse(openai, {
          instruction,
          intent,
          executionResult,
          snapshot,
        });

        // 9. Handle execution failure
        if (!executionResult.success) {
          sendSSE(controller, 'done', {
            effects: [],
            message: `Error occurred: ${executionResult.error}`,
          });
          controller.close();
          return;
        }

        // 10. Send done event with effects and generated message
        sendSSE(controller, 'done', {
          effects: executionResult.effects,
          message,
        });

        controller.close();
      } catch (error) {
        sendSSE(controller, 'error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
