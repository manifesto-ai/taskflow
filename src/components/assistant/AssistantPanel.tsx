'use client';

import { useState, useCallback, useRef } from 'react';
import { AssistantHeader } from './AssistantHeader';
import { AssistantMessages } from './AssistantMessages';
import { AssistantInput } from './AssistantInput';
import { QuickActions, ConfirmPrompt } from './messages';
import { useTasksStore } from '@/store/useTasksStore';
import type { DateFilter } from '@/components/ui/date-range-picker';
import type {
  AssistantMessage,
  UserMessage as UserMessageType,
  AgentExecutionMessage,
  ErrorMessage,
} from '@/types/assistant';
import { generateMessageId as genId } from '@/types/assistant';
import type { Task } from '@/domain/tasks';
import type { AgentStep, AgentEffect } from '@/lib/agents/types';

interface AssistantPanelProps {
  onClose: () => void;
}

// Parse step from serialized JSON (outside component to avoid recreation)
function parseStep(step: Record<string, unknown>): AgentStep {
  return {
    id: step.id as string,
    agentName: step.agentName as string,
    agentIcon: step.agentIcon as string,
    status: step.status as AgentStep['status'],
    description: step.description as string | undefined,
    input: step.input as Record<string, unknown> | undefined,
    output: step.output as Record<string, unknown> | undefined,
    error: step.error as string | undefined,
    startTime: new Date(step.startTime as string),
    endTime: step.endTime ? new Date(step.endTime as string) : undefined,
    duration: step.duration as number | undefined,
  };
}

export function AssistantPanel({ onClose }: AssistantPanelProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const executionMsgIdRef = useRef<string | null>(null);
  const [clarificationSessionId, setClarificationSessionId] = useState<string | null>(null);
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);

  const tasks = useTasksStore((s) => s.tasks);
  const viewMode = useTasksStore((s) => s.viewMode);
  const dateFilter = useTasksStore((s) => s.dateFilter);
  const addTask = useTasksStore((s) => s.addTask);
  const updateTask = useTasksStore((s) => s.updateTask);
  const removeTask = useTasksStore((s) => s.removeTask);
  const restoreTask = useTasksStore((s) => s.restoreTask);
  const setViewMode = useTasksStore((s) => s.setViewMode);
  const setDateFilter = useTasksStore((s) => s.setDateFilter);
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId);
  const setAssistantOpen = useTasksStore((s) => s.setAssistantOpen);
  const setLastCreatedTaskIds = useTasksStore((s) => s.setLastCreatedTaskIds);
  const setLastModifiedTaskId = useTasksStore((s) => s.setLastModifiedTaskId);
  const lastCreatedTaskIds = useTasksStore((s) => s.lastCreatedTaskIds);
  const lastModifiedTaskId = useTasksStore((s) => s.lastModifiedTaskId);

  // Helper to update agent execution message
  const updateExecutionMessage = useCallback((
    msgId: string,
    updater: (msg: AgentExecutionMessage) => AgentExecutionMessage
  ) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === msgId && msg.type === 'agent-execution'
          ? updater(msg as AgentExecutionMessage)
          : msg
      )
    );
  }, []);

  // Effects를 적용하는 헬퍼 함수
  const applyEffects = useCallback((effects: AgentEffect[]) => {
    const createdTaskIds: string[] = [];
    let modifiedTaskId: string | null = null;

    for (const effect of effects) {
      if (effect.type === 'snapshot.patch' && effect.ops) {
        for (const op of effect.ops) {
          if (op.op === 'append' && op.path === 'data.tasks') {
            const task = op.value as Task;
            addTask(task);
            createdTaskIds.push(task.id);
          } else if (op.op === 'set' && op.path === 'state.viewMode') {
            setViewMode(op.value as 'todo' | 'kanban' | 'table');
          } else if (op.op === 'set' && op.path === 'state.dateFilter') {
            setDateFilter(op.value as DateFilter | null);
          } else if (op.op === 'set' && op.path === 'state.selectedTaskId') {
            setSelectedTaskId(op.value as string | null);
          } else if (op.op === 'set' && op.path === 'state.assistantOpen') {
            setAssistantOpen(op.value as boolean);
          } else if (op.op === 'remove' && op.path === 'data.tasks') {
            const taskId = op.value as string;
            removeTask(taskId);
            if (useTasksStore.getState().selectedTaskId === taskId) {
              setSelectedTaskId(null);
            }
          } else if (op.op === 'restore' && op.path === 'data.tasks') {
            restoreTask(op.value as string);
          } else if (op.op === 'set' && op.path.startsWith('data.tasks.')) {
            // Handle new format: data.tasks.id:taskId.field
            const idMatch = op.path.match(/data\.tasks\.id:([^.]+)\.(\w+)/);
            if (idMatch) {
              const [, taskId, field] = idMatch;
              updateTask(taskId, { [field]: op.value } as Partial<Task>);
              modifiedTaskId = taskId;
            } else {
              // Handle legacy format: data.tasks.index.field
              const indexMatch = op.path.match(/data\.tasks\.(\d+)\.(\w+)/);
              if (indexMatch) {
                const [, indexStr, field] = indexMatch;
                const index = parseInt(indexStr, 10);
                const currentTasks = useTasksStore.getState().tasks;
                const task = currentTasks[index];
                if (task) {
                  updateTask(task.id, { [field]: op.value } as Partial<Task>);
                  modifiedTaskId = task.id;
                }
              }
            }
          }
        }
      }
    }

    // Update last action context
    if (createdTaskIds.length > 0) {
      setLastCreatedTaskIds(createdTaskIds);
    }
    if (modifiedTaskId) {
      setLastModifiedTaskId(modifiedTaskId);
    }
  }, [addTask, updateTask, removeTask, restoreTask, setViewMode, setDateFilter, setSelectedTaskId, setAssistantOpen, setLastCreatedTaskIds, setLastModifiedTaskId]);

  // SSE 이벤트 처리 (Simple API)
  const handleSSEEvent = useCallback((msgId: string, eventType: string, data: unknown) => {
    const payload = data as Record<string, unknown>;

    switch (eventType) {
      case 'start': {
        const step: AgentStep = {
          id: 'processing',
          agentName: 'processing',
          agentIcon: '🧠',
          status: 'running',
          description: 'Processing...',
          startTime: new Date(),
        };
        updateExecutionMessage(msgId, (msg) => ({
          ...msg,
          steps: [step],
        }));
        break;
      }

      case 'intent': {
        updateExecutionMessage(msgId, (msg) => ({
          ...msg,
          steps: msg.steps.map((s) =>
            s.id === 'processing'
              ? { ...s, status: 'completed' as const, description: 'Understood', endTime: new Date() }
              : s
          ).concat({
            id: 'executing',
            agentName: 'executing',
            agentIcon: '⚡',
            status: 'running',
            description: 'Executing...',
            startTime: new Date(),
          }),
        }));
        break;
      }

      case 'done': {
        const message = payload.message as string;
        const effects = payload.effects as AgentEffect[];

        if (effects && effects.length > 0) {
          applyEffects(effects);
        }

        updateExecutionMessage(msgId, (msg) => ({
          ...msg,
          steps: msg.steps.map((s) =>
            s.id === 'executing'
              ? { ...s, status: 'completed' as const, description: 'Done', endTime: new Date() }
              : s
          ),
          summary: message || 'Done.',
          status: 'completed',
        }));
        break;
      }

      case 'error': {
        const errorMessage = payload.error as string;
        updateExecutionMessage(msgId, (msg) => ({
          ...msg,
          steps: msg.steps.map((s) =>
            s.status === 'running'
              ? { ...s, status: 'failed' as const, error: errorMessage, endTime: new Date() }
              : s
          ),
          summary: `Error: ${errorMessage}`,
          status: 'failed',
        }));
        break;
      }
    }
  }, [updateExecutionMessage, applyEffects]);

  // 메시지 제출 핸들러
  const handleSubmit = useCallback(async (content: string) => {
    const userMessage: UserMessageType = {
      id: genId(),
      type: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsThinking(true);

    const execMsgId = genId();
    executionMsgIdRef.current = execMsgId;
    const initialExecMsg: AgentExecutionMessage = {
      id: execMsgId,
      type: 'agent-execution',
      steps: [],
      summary: '',
      status: 'running',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, initialExecMsg]);

    try {
      // Build request body
      const requestBody: Record<string, unknown> = {
        instruction: content,
        snapshot: {
          data: { tasks },
          state: {
            selectedTaskId: useTasksStore.getState().selectedTaskId,
            viewMode,
            dateFilter,
            lastCreatedTaskIds,
            lastModifiedTaskId,
          },
        },
      };

      // Include sessionId if in clarification follow-up mode
      if (clarificationSessionId) {
        requestBody.sessionId = clarificationSessionId;
      }

      const response = await fetch('/api/agent/simple/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error('Failed to connect to stream');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);

            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                handleSSEEvent(execMsgId, eventType, data);
              } catch {
                // Ignore parse errors
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      }
    } catch (error) {
      const errorMsg: ErrorMessage = {
        id: genId(),
        type: 'error',
        content: error instanceof Error ? error.message : 'An unknown error occurred',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setMessages((prev) => prev.filter((m) => m.id !== execMsgId));
    } finally {
      setIsThinking(false);
      executionMsgIdRef.current = null;
    }
  }, [tasks, viewMode, dateFilter, handleSSEEvent, clarificationSessionId, lastCreatedTaskIds, lastModifiedTaskId]);

  // Confirm 응답 핸들러
  const handleConfirmResponse = useCallback(async (approved: boolean) => {
    if (!confirmSessionId) return;

    setIsConfirmLoading(true);

    const execMsgId = genId();
    executionMsgIdRef.current = execMsgId;
    const initialExecMsg: AgentExecutionMessage = {
      id: execMsgId,
      type: 'agent-execution',
      steps: [{
        id: 'confirm-response',
        agentName: approved ? 'approving' : 'cancelling',
        agentIcon: approved ? '✅' : '❌',
        status: 'running',
        description: approved ? 'Continuing...' : 'Cancelling...',
        startTime: new Date(),
      }],
      summary: '',
      status: 'running',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, initialExecMsg]);

    try {
      const response = await fetch('/api/agent/simple/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: '',
          snapshot: {
            data: { tasks },
            state: {
              selectedTaskId: useTasksStore.getState().selectedTaskId,
              viewMode,
              dateFilter,
              lastCreatedTaskIds,
              lastModifiedTaskId,
            },
          },
          confirmSessionId,
          approved,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to connect to stream');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);

            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                handleSSEEvent(execMsgId, eventType, data);
              } catch {
                // Ignore parse errors
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      }
    } catch (error) {
      const errorMsg: ErrorMessage = {
        id: genId(),
        type: 'error',
        content: error instanceof Error ? error.message : 'An unknown error occurred',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setMessages((prev) => prev.filter((m) => m.id !== execMsgId));
    } finally {
      setIsConfirmLoading(false);
      setConfirmSessionId(null);
      setConfirmMessage(null);
      executionMsgIdRef.current = null;
    }
  }, [confirmSessionId, tasks, viewMode, dateFilter, lastCreatedTaskIds, lastModifiedTaskId, handleSSEEvent]);

  const handleViewTask = useCallback((taskId: string) => {
    useTasksStore.getState().setSelectedTaskId(taskId);
  }, []);

  const handleEditTask = useCallback((taskId: string) => {
    useTasksStore.getState().setSelectedTaskId(taskId);
    useTasksStore.getState().setIsEditing(true);
  }, []);

  const handleNewTask = useCallback(() => {
    handleSubmit('Create a new task');
  }, [handleSubmit]);

  return (
    <div className="flex flex-col h-full bg-background">
      <AssistantHeader onClose={onClose} />

      <AssistantMessages
        messages={messages}
        isThinking={isThinking}
        onViewTask={handleViewTask}
        onEditTask={handleEditTask}
        onSelectTask={handleViewTask}
      />

      {messages.length === 0 && !isThinking && (
        <div className="px-4 pb-2">
          <QuickActions
            onNewTask={handleNewTask}
            onShowAll={() => handleSubmit('Show all tasks')}
            onTodayTasks={() => handleSubmit('Show tasks due today')}
            onWeekTasks={() => handleSubmit('Show tasks due this week')}
          />
        </div>
      )}

      {confirmSessionId && confirmMessage && (
        <ConfirmPrompt
          message={confirmMessage}
          sessionId={confirmSessionId}
          onApprove={() => handleConfirmResponse(true)}
          onReject={() => handleConfirmResponse(false)}
          isLoading={isConfirmLoading}
        />
      )}

      <AssistantInput
        onSubmit={handleSubmit}
        isLoading={isThinking}
      />
    </div>
  );
}
