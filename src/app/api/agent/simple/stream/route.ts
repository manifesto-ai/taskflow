/**
 * Simple Intent API Stream Route (SSE)
 *
 * GPT-4o-mini로 1회 LLM 호출 + SSE 스트리밍
 * 데모용 단순화된 API
 */

import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import type { Intent } from '@/lib/agents/intent';
import { validateIntent } from '@/lib/agents/intent';
import { executeIntent, type Snapshot } from '@/lib/agents/runtime';
import type { AgentEffect } from '@/lib/agents/types';

// ============================================
// Request Type
// ============================================

interface SimpleIntentRequest {
  instruction: string;
  snapshot: Snapshot;
}

// ============================================
// System Prompt
// ============================================

function getSystemPrompt(): string {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayStr = now.toISOString().split('T')[0];
  const dayOfWeek = days[now.getDay()];

  return `You are a task management assistant. Convert natural language into Intent JSON.

## Today: ${todayStr} (${dayOfWeek})

## Intent Types (output one JSON object)

| kind | When to use | Key fields |
|------|-------------|------------|
| CreateTask | User wants to add new task(s) | tasks: [{ title, priority?, dueDate?, tags? }] |
| ChangeStatus | User wants to complete/start/change task state | taskId, toStatus: "todo"|"in-progress"|"review"|"done" |
| UpdateTask | User wants to modify task properties (assign, rename, etc.) | taskId, changes: { title?, priority?, dueDate?, assignee?, description?, tags? } |
| DeleteTask | User wants to remove a task | taskId |
| SelectTask | User wants to view/open a task | taskId (null to deselect) |
| QueryTasks | User is asking a question about tasks | query, answer (include your answer!) |
| ChangeView | User wants to switch view mode | viewMode: "kanban"|"table"|"todo" |
| SetDateFilter | User wants to filter by date | filter: { field, type } or null |
| Undo | User wants to undo | (no extra fields) |
| RequestClarification | Truly ambiguous, need user input | reason: "which_task"\|"multiple_matches"\|"ambiguous_action"\|"unknown", question, originalInput |

## Key Principles

1. **Understand intent naturally** - Don't be too literal. "let me see the shopping task" means select that task.

2. **Match tasks by meaning** - Find tasks by keywords/meaning from the provided task list. Use the exact taskId from the list.

3. **"this/it" = selected task** - Refer to the Currently Selected Task shown in context.

4. **Calculate dates** - "next Tuesday", "tomorrow", "next Friday" → compute actual YYYY-MM-DD.

5. **Questions & Chat → QueryTasks** - For questions ("what is...?", "how many?") OR greetings/casual chat ("hello", "hi", "thanks"), use QueryTasks. Put your natural response in both "answer" and "message" fields.

6. **CRITICAL: Match user's language** - "message" and "question" fields MUST be in the SAME language as user input. English input → English response. Non-English input → respond in that language.

7. **Avoid RequestClarification** - Only use when genuinely ambiguous (0 or 2+ matching tasks). If you can reasonably infer the intent, just do it.

8. **Assign = UpdateTask with assignee** - "assign to X", "give this to Y" → UpdateTask with changes.assignee.

## Output Format (ALL fields required)
\`\`\`json
{
  "kind": "...",
  "message": "friendly confirmation message",
  "confidence": 0.9,
  "source": "human",
  ...other fields based on kind
}
\`\`\`
- **kind**: Intent type from table above (REQUIRED)
- **message**: Natural, friendly response confirming the action (REQUIRED). Examples: "Added 'Buy bananas' for tomorrow!", "Marked as complete.", "Which task do you mean?"
- **confidence**: 0.0-1.0 (REQUIRED, use 0.9 for clear intents)
- **source**: "human" (REQUIRED)

**Message examples by intent**:
- CreateTask: "Added 'Buy groceries' for tomorrow!"
- ChangeStatus: "Done! Marked 'Login feature' as complete."
- UpdateTask: "Updated the assignee to John."
- DeleteTask: "Deleted the task."
- QueryTasks (question): "You have 3 tasks due today."
- QueryTasks (greeting): "Hello! How can I help you with your tasks?"
- RequestClarification: "Which task do you mean?"`;
}

// ============================================
// Message Generator
// ============================================

function generateMessage(intent: Intent): string {
  // Use LLM-generated message if available
  const llmMessage = (intent as unknown as { message?: string }).message;
  if (llmMessage) {
    return llmMessage;
  }

  // Fallback for special cases
  if (intent.kind === 'QueryTasks') {
    return (intent as unknown as { answer?: string }).answer || 'Done.';
  }

  if (intent.kind === 'RequestClarification') {
    return intent.question;
  }

  return 'Done.';
}

// ============================================
// SSE Helper
// ============================================

function sendSSE(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

// ============================================
// Main Handler
// ============================================

export async function POST(request: NextRequest) {
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

        // 1. Start event
        sendSSE(controller, 'start', {});

        // 2. Build user message with task context
        const activeTasks = snapshot.data.tasks.filter(t => !t.deletedAt);
        const taskListForLLM = activeTasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
        }));

        // Find selected task details
        const selectedTask = snapshot.state.selectedTaskId
          ? activeTasks.find(t => t.id === snapshot.state.selectedTaskId)
          : null;

        const userMessage = `## Current Tasks
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

Output only a valid JSON Intent object.`;

        // 3. Call OpenAI
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: getSystemPrompt() },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 500,
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          sendSSE(controller, 'error', { error: 'No response from LLM' });
          controller.close();
          return;
        }

        // 4. Parse Intent
        let intent: Intent;
        try {
          intent = JSON.parse(content);
        } catch {
          sendSSE(controller, 'error', { error: `Invalid JSON from LLM: ${content}` });
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

        // 7. Handle RequestClarification (no execution needed)
        if (intent.kind === 'RequestClarification') {
          sendSSE(controller, 'done', {
            effects: [],
            message: intent.question,
          });
          controller.close();
          return;
        }

        // 8. Execute Intent
        const executionResult = executeIntent(intent, snapshot);

        if (!executionResult.success) {
          sendSSE(controller, 'error', { error: executionResult.error });
          controller.close();
          return;
        }

        // 9. Generate response message
        const message = generateMessage(intent);

        // 10. Send done event
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
