import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createManifesto, createIntent, dispatchAsync } from '@manifesto-ai/sdk';
import type { ManifestoInstance } from '@manifesto-ai/sdk';
import type { Task } from '@/types/taskflow';

function dispatch(instance: ManifestoInstance<TaskFlowData>, type: string, input?: Record<string, unknown>) {
  return dispatchAsync(instance, createIntent(type, input, crypto.randomUUID()));
}

type TaskFlowData = {
  tasks: Task[];
  selectedTaskId: string | null;
  viewMode: string;
  assistantOpen: boolean;
};

// Read MEL source once
const melSource = readFileSync(
  resolve(__dirname, '../../domain/taskflow.mel'),
  'utf8',
);

// Helper: make a task object
function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Test Task',
    description: overrides.description ?? null,
    status: overrides.status ?? 'todo',
    priority: overrides.priority ?? 'medium',
    assignee: overrides.assignee ?? null,
    dueDate: overrides.dueDate ?? null,
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-03-18T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-18T00:00:00Z',
    deletedAt: overrides.deletedAt ?? null,
  };
}

describe('TaskFlow MEL Domain', () => {
  let instance: ManifestoInstance<TaskFlowData>;

  beforeEach(() => {
    instance = createManifesto<TaskFlowData>({ schema: melSource, effects: {} });
  });

  afterEach(() => {
    instance.dispose();
  });

  // Scenario 1: createTask
  it('adds a task to the tasks array', async () => {
    const task = makeTask({ id: 'task-1', title: 'Buy groceries' });

    await dispatch(instance, 'createTask', { task });

    const snap = instance.getSnapshot();
    const tasks = snap.data.tasks;

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-1');
    expect(tasks[0].title).toBe('Buy groceries');
    expect(tasks[0].status).toBe('todo');
  });

  // Scenario 2: selectTask
  it('selects a task by id', async () => {
    const t1 = makeTask({ id: 'a', title: 'Task A' });
    const t2 = makeTask({ id: 'b', title: 'Task B' });
    const t3 = makeTask({ id: 'c', title: 'Task C' });

    await dispatch(instance, 'createTask', { task: t1 });
    await dispatch(instance, 'createTask', { task: t2 });
    await dispatch(instance, 'createTask', { task: t3 });
    await dispatch(instance, 'selectTask', { taskId: 'b' });

    const snap = instance.getSnapshot();
    expect(snap.data.selectedTaskId).toBe('b');
  });

  // Scenario 3: softDeleteTask + computed
  it('soft-deletes a task and updates computed lists', async () => {
    const task = makeTask({ id: 'del-1', title: 'Delete me' });

    await dispatch(instance, 'createTask', { task });

    // Before delete: activeTasks has 1, deletedTasks has 0
    let snap = instance.getSnapshot();
    expect((snap.computed.activeTasks as Task[]).length).toBe(1);
    expect((snap.computed.deletedTasks as Task[]).length).toBe(0);
    expect(snap.computed.totalCount).toBe(1);

    await dispatch(instance, 'softDeleteTask', {
      id: 'del-1',
      timestamp: '2026-03-18T12:00:00Z',
    });

    snap = instance.getSnapshot();
    expect((snap.computed.activeTasks as Task[]).length).toBe(0);
    expect((snap.computed.deletedTasks as Task[]).length).toBe(1);
    expect(snap.computed.totalCount).toBe(0);
    expect(snap.computed.deletedCount).toBe(1);
  });

  // Scenario 4: changeView
  it('changes the view mode', async () => {
    await dispatch(instance, 'changeView', { mode: 'table' });

    const snap = instance.getSnapshot();
    expect(snap.data.viewMode).toBe('table');
  });

  // Scenario 5: moveTask + status computed
  it('moves a task and updates status-based computed', async () => {
    const task = makeTask({ id: 'move-1', title: 'Move me', status: 'todo' });

    await dispatch(instance, 'createTask', { task });

    let snap = instance.getSnapshot();
    expect(snap.computed.todoCount).toBe(1);
    expect(snap.computed.inProgressCount).toBe(0);

    await dispatch(instance, 'moveTask', {
      taskId: 'move-1',
      newStatus: 'in-progress',
    });

    snap = instance.getSnapshot();
    expect(snap.computed.todoCount).toBe(0);
    expect(snap.computed.inProgressCount).toBe(1);

    // Verify the task status changed
    const tasks = snap.data.tasks;
    const moved = tasks.find((t) => t.id === 'move-1');
    expect(moved?.status).toBe('in-progress');
  });

  // Bonus: restoreTask
  it('restores a soft-deleted task', async () => {
    const task = makeTask({ id: 'rest-1' });

    await dispatch(instance, 'createTask', { task });
    await dispatch(instance, 'softDeleteTask', {
      id: 'rest-1',
      timestamp: '2026-03-18T12:00:00Z',
    });

    let snap = instance.getSnapshot();
    expect(snap.computed.deletedCount).toBe(1);
    expect(snap.computed.totalCount).toBe(0);

    await dispatch(instance, 'restoreTask', { id: 'rest-1' });

    snap = instance.getSnapshot();
    expect(snap.computed.deletedCount).toBe(0);
    expect(snap.computed.totalCount).toBe(1);
  });

  // Bonus: emptyTrash
  it('empties trash by removing all soft-deleted tasks', async () => {
    const t1 = makeTask({ id: 'e-1' });
    const t2 = makeTask({ id: 'e-2' });

    await dispatch(instance, 'createTask', { task: t1 });
    await dispatch(instance, 'createTask', { task: t2 });
    await dispatch(instance, 'softDeleteTask', {
      id: 'e-1',
      timestamp: '2026-03-18T12:00:00Z',
    });

    let snap = instance.getSnapshot();
    expect(snap.computed.deletedCount).toBe(1);
    expect(snap.computed.totalCount).toBe(1);

    await dispatch(instance, 'emptyTrash', {});

    snap = instance.getSnapshot();
    expect(snap.computed.deletedCount).toBe(0);
    // The non-deleted task should remain
    expect(snap.computed.totalCount).toBe(1);
    expect(snap.data.tasks.length).toBe(1);
  });

  // Bonus: permanentlyDeleteTask
  it('permanently removes a task from the array', async () => {
    const task = makeTask({ id: 'perm-1' });

    await dispatch(instance, 'createTask', { task });
    await dispatch(instance, 'permanentlyDeleteTask', { id: 'perm-1' });

    const snap = instance.getSnapshot();
    expect(snap.data.tasks.length).toBe(0);
  });

  // Bonus: updateTask partial update
  it('partially updates a task', async () => {
    const task = makeTask({
      id: 'upd-1',
      title: 'Old Title',
      priority: 'low',
    });

    await dispatch(instance, 'createTask', { task });
    await dispatch(instance, 'updateTask', {
      id: 'upd-1',
      title: 'New Title',
      description: null,
      status: null,
      priority: 'high',
      assignee: null,
      dueDate: null,
      tags: null,
      updatedAt: '2026-03-18T01:00:00Z',
    });

    const snap = instance.getSnapshot();
    const tasks = snap.data.tasks;
    const updated = tasks.find((t) => t.id === 'upd-1');

    expect(updated?.title).toBe('New Title');
    expect(updated?.priority).toBe('high');
    // Fields passed as null should retain original values (via coalesce)
    expect(updated?.status).toBe('todo');
    expect(updated?.updatedAt).toBe('2026-03-18T01:00:00Z');
  });
});
