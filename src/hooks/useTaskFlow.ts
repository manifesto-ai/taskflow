'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createManifesto } from '@manifesto-ai/sdk';
import type { ManifestoInstance, Snapshot } from '@manifesto-ai/sdk';
import type { Task, TaskStatus, ViewMode } from '@/types/taskflow';
import { TASKFLOW_MEL } from '@/domain/taskflow-schema';
import { TASK_FIXTURES } from '@/lib/taskflow-fixtures';

/** SDK v2.0.0: Snapshot data type for TaskFlow domain */
type TaskFlowData = {
  tasks: Task[];
  selectedTaskId: string | null;
  viewMode: ViewMode;
  assistantOpen: boolean;
};

type TaskFlowComputed = {
  activeTasks: Task[];
  deletedTasks: Task[];
  todoTasks: Task[];
  inProgressTasks: Task[];
  reviewTasks: Task[];
  doneTasks: Task[];
  totalCount: number;
  todoCount: number;
  inProgressCount: number;
  reviewCount: number;
  doneCount: number;
  deletedCount: number;
};

type TaskFlowState = TaskFlowData & TaskFlowComputed;

type TaskFlowActions = {
  createTask: (task: Task) => void;
  updateTask: (id: string, fields: Partial<Omit<Task, 'id' | 'createdAt'>>) => void;
  moveTask: (taskId: string, newStatus: TaskStatus) => void;
  softDeleteTask: (id: string) => void;
  restoreTask: (id: string) => void;
  permanentlyDeleteTask: (id: string) => void;
  emptyTrash: () => void;
  selectTask: (taskId: string | null) => void;
  changeView: (mode: ViewMode) => void;
  toggleAssistant: (open: boolean) => void;
};

export type UseTaskFlowResult = {
  state: TaskFlowState | null;
  ready: boolean;
  actions: TaskFlowActions;
  dispatch: (type: string, input?: Record<string, unknown>) => void;
};

function extractState(snapshot: Snapshot<TaskFlowData>): TaskFlowState {
  const { data: d } = snapshot;
  const c = snapshot.computed as TaskFlowComputed;
  return {
    tasks: d.tasks ?? [],
    selectedTaskId: d.selectedTaskId ?? null,
    viewMode: d.viewMode ?? 'kanban',
    assistantOpen: d.assistantOpen ?? false,
    activeTasks: c.activeTasks ?? [],
    deletedTasks: c.deletedTasks ?? [],
    todoTasks: c.todoTasks ?? [],
    inProgressTasks: c.inProgressTasks ?? [],
    reviewTasks: c.reviewTasks ?? [],
    doneTasks: c.doneTasks ?? [],
    totalCount: c.totalCount ?? 0,
    todoCount: c.todoCount ?? 0,
    inProgressCount: c.inProgressCount ?? 0,
    reviewCount: c.reviewCount ?? 0,
    doneCount: c.doneCount ?? 0,
    deletedCount: c.deletedCount ?? 0,
  };
}

export function useTaskFlow(): UseTaskFlowResult {
  const instanceRef = useRef<ManifestoInstance<TaskFlowData> | null>(null);
  const [state, setState] = useState<TaskFlowState | null>(null);

  useEffect(() => {
    const instance = createManifesto<TaskFlowData>({
      schema: TASKFLOW_MEL,
      effects: {},
    });
    instanceRef.current = instance;

    // Seed fixture data
    for (const task of TASK_FIXTURES) {
      instance.dispatch({
        type: 'createTask',
        input: { task },
        intentId: crypto.randomUUID(),
      });
    }

    // Set initial state after seeding
    setState(extractState(instance.getSnapshot()));

    const unsubscribe = instance.subscribe(
      (s) => s,
      (snapshot) => {
        setState(extractState(snapshot));
      },
    );

    return () => {
      unsubscribe();
      instanceRef.current = null;
      instance.dispose();
    };
  }, []);

  const dispatch = useCallback((type: string, input?: Record<string, unknown>) => {
    instanceRef.current?.dispatch({
      type,
      input,
      intentId: crypto.randomUUID(),
    });
  }, []);

  const actions: TaskFlowActions = {
    createTask: useCallback((task: Task) => {
      dispatch('createTask', { task });
    }, [dispatch]),

    updateTask: useCallback((id: string, fields: Partial<Omit<Task, 'id' | 'createdAt'>>) => {
      dispatch('updateTask', {
        id,
        title: fields.title ?? null,
        description: fields.description ?? null,
        status: fields.status ?? null,
        priority: fields.priority ?? null,
        assignee: fields.assignee ?? null,
        dueDate: fields.dueDate ?? null,
        tags: fields.tags ?? null,
        updatedAt: new Date().toISOString(),
      });
    }, [dispatch]),

    moveTask: useCallback((taskId: string, newStatus: TaskStatus) => {
      dispatch('moveTask', { taskId, newStatus });
    }, [dispatch]),

    softDeleteTask: useCallback((id: string) => {
      dispatch('softDeleteTask', { id, timestamp: new Date().toISOString() });
    }, [dispatch]),

    restoreTask: useCallback((id: string) => {
      dispatch('restoreTask', { id });
    }, [dispatch]),

    permanentlyDeleteTask: useCallback((id: string) => {
      dispatch('permanentlyDeleteTask', { id });
    }, [dispatch]),

    emptyTrash: useCallback(() => {
      dispatch('emptyTrash', {});
    }, [dispatch]),

    selectTask: useCallback((taskId: string | null) => {
      dispatch('selectTask', { taskId });
    }, [dispatch]),

    changeView: useCallback((mode: ViewMode) => {
      dispatch('changeView', { mode });
    }, [dispatch]),

    toggleAssistant: useCallback((open: boolean) => {
      dispatch('toggleAssistant', { open });
    }, [dispatch]),
  };

  return { state, ready: state !== null, actions, dispatch };
}
