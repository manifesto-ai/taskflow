/**
 * Simple Intent API Route (1-shot, Demo 용)
 *
 * GPT-4o-mini로 1회 LLM 호출만으로 Intent를 직접 생성
 * 기존 multi-agent 구조는 실험용으로 유지하고, 이 endpoint를 실제 데모에 사용
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { Intent } from '@/lib/agents/intent';
import { validateIntent } from '@/lib/agents/intent';
import { executeIntent, type Snapshot } from '@/lib/agents/runtime';
import type { AgentEffect } from '@/lib/agents/types';

// ============================================
// Request/Response Types
// ============================================

interface SimpleIntentRequest {
  instruction: string;
  snapshot: Snapshot;
}

interface SimpleIntentResponse {
  success: boolean;
  intent: Intent | null;
  effects: AgentEffect[];
  message: string;
  error?: string;
}

// ============================================
// System Prompt
// ============================================

const SYSTEM_PROMPT = `You are a task management assistant. Convert user instructions into structured Intent JSON.

## Current Date
Today is ${new Date().toISOString().split('T')[0]}.

## Intent Schema
You must output a single JSON object matching one of these Intent types:

### ChangeView
Switch view mode.
\`\`\`json
{ "kind": "ChangeView", "viewMode": "kanban" | "table" | "todo", "confidence": 0.9, "source": "human" }
\`\`\`

### SetDateFilter
Set or clear date filter. Only use for EXPLICIT filter commands like "오늘 마감인 것만 보여줘", "filter by today".
Do NOT use for questions - use QueryTasks instead.
\`\`\`json
{ "kind": "SetDateFilter", "filter": { "field": "dueDate" | "createdAt", "type": "today" | "week" | "month" } | null, "confidence": 0.9, "source": "human" }
\`\`\`

### CreateTask
Create one or more tasks.
\`\`\`json
{ "kind": "CreateTask", "tasks": [{ "title": "Task title", "priority": "low" | "medium" | "high", "dueDate": "2024-12-20", "tags": ["tag1"] }], "confidence": 0.9, "source": "human" }
\`\`\`
- dueDate format: YYYY-MM-DD (ISO date)
- "tomorrow" = today + 1 day
- "next week" = today + 7 days

### UpdateTask
Update task properties (title, description, priority, tags, dueDate).
\`\`\`json
{ "kind": "UpdateTask", "taskId": "task-xxx", "changes": { "title": "New title", "priority": "high" }, "confidence": 0.9, "source": "human" }
\`\`\`

### ChangeStatus
Change task status (most common operation).
\`\`\`json
{ "kind": "ChangeStatus", "taskId": "task-xxx", "toStatus": "todo" | "in-progress" | "review" | "done", "confidence": 0.9, "source": "human" }
\`\`\`
- "완료", "done", "끝났어" → toStatus: "done"
- "시작", "진행 중" → toStatus: "in-progress"
- "리뷰" → toStatus: "review"

### DeleteTask
Soft delete a task.
\`\`\`json
{ "kind": "DeleteTask", "taskId": "task-xxx", "confidence": 0.9, "source": "human" }
\`\`\`

### SelectTask
Select a task to view details. Use taskId: null to deselect.
\`\`\`json
{ "kind": "SelectTask", "taskId": "task-xxx" | null, "confidence": 0.9, "source": "human" }
\`\`\`

### QueryTasks
Answer questions about tasks (read-only). Use for ANY question including:
- "내일 뭐해야해?" / "What do I need to do tomorrow?"
- "오늘 할 일 뭐야?" / "What's due today?"
- "몇 개 남았어?" / "How many tasks left?"
- "진행 중인 거 뭐야?" / "What's in progress?"
**IMPORTANT**: Include "answer" field with the actual answer based on the task list!
\`\`\`json
{ "kind": "QueryTasks", "query": "내일 뭐해야해?", "answer": "내일 마감인 태스크는 2개입니다: 1. 로그인 구현, 2. API 연동", "confidence": 0.9, "source": "human" }
\`\`\`

### Undo
Undo the last action.
\`\`\`json
{ "kind": "Undo", "confidence": 0.9, "source": "human" }
\`\`\`

### RequestClarification
When the user's intent is unclear or multiple tasks could match.
\`\`\`json
{ "kind": "RequestClarification", "reason": "which_task" | "ambiguous_action" | "multiple_matches", "question": "Which task do you mean?", "originalInput": "mark it done", "candidates": ["task-1", "task-2"], "confidence": 0.5, "source": "agent" }
\`\`\`

## Rules
1. ALWAYS output valid JSON matching one of the schemas above
2. **CRITICAL: Questions (?) vs Commands**
   - Questions like "뭐해야해?", "뭐야?", "몇 개?", "What do I need?" → QueryTasks
   - Commands like "보여줘", "필터해", "Show only", "Filter by" → SetDateFilter/ChangeView
3. **CRITICAL: "이거", "이 태스크", "this", "it" = Currently Selected Task**
   - When user says "이거 완료해", "mark this done", "이거 삭제해" → use the Currently Selected Task's ID
   - If no task is selected, use RequestClarification
4. For task operations (ChangeStatus, UpdateTask, DeleteTask, SelectTask), you MUST use the exact taskId from the provided task list
5. Match tasks by title keywords. If user says "로그인 태스크", find the task with "로그인" in the title
6. If multiple tasks match or no task matches, use RequestClarification
7. confidence should be 0.9 for clear intents, lower for uncertain ones
8. source is always "human" except for RequestClarification (use "agent")
9. **CRITICAL: Always include a "message" field** with a user-friendly response in THE SAME LANGUAGE as the user's instruction`;

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
// Main Handler
// ============================================

export async function POST(request: NextRequest) {
  try {
    const body: SimpleIntentRequest = await request.json();
    const { instruction, snapshot } = body;

    if (!instruction) {
      return NextResponse.json<SimpleIntentResponse>(
        { success: false, intent: null, effects: [], message: '', error: 'Instruction is required' },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json<SimpleIntentResponse>(
        { success: false, intent: null, effects: [], message: '', error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Build user message with task context
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

    // Call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-5.1-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json<SimpleIntentResponse>(
        { success: false, intent: null, effects: [], message: '', error: 'No response from LLM' },
        { status: 500 }
      );
    }

    // Parse Intent
    let intent: Intent;
    try {
      intent = JSON.parse(content);
    } catch {
      return NextResponse.json<SimpleIntentResponse>(
        { success: false, intent: null, effects: [], message: '', error: `Invalid JSON from LLM: ${content}` },
        { status: 500 }
      );
    }

    // Validate Intent
    const validation = validateIntent(intent);
    if (!validation.valid) {
      return NextResponse.json<SimpleIntentResponse>(
        { success: false, intent: null, effects: [], message: '', error: `Intent validation failed: ${validation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    // Handle RequestClarification (no execution needed)
    if (intent.kind === 'RequestClarification') {
      return NextResponse.json<SimpleIntentResponse>({
        success: true,
        intent,
        effects: [],
        message: intent.question,
      });
    }

    // Execute Intent
    const executionResult = executeIntent(intent, snapshot);

    if (!executionResult.success) {
      return NextResponse.json<SimpleIntentResponse>(
        { success: false, intent, effects: [], message: '', error: executionResult.error },
        { status: 400 }
      );
    }

    // Generate response message
    const message = generateMessage(intent);

    return NextResponse.json<SimpleIntentResponse>({
      success: true,
      intent,
      effects: executionResult.effects,
      message,
    });
  } catch (error) {
    return NextResponse.json<SimpleIntentResponse>(
      {
        success: false,
        intent: null,
        effects: [],
        message: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
