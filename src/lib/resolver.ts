/**
 * Resolver — deterministic reference and time resolution.
 *
 * Resolves:
 * - TimeSpec values ("내일", "next friday") → ISO dates
 * - Discourse refs (that/this/last) → task titles
 * - Title refs → verified task titles
 *
 * Errors are values, not exceptions (Constitution §5).
 */

import type { IntentIR, Term, Role } from '@/types/intent-ir';
import type { ConversationTurn } from '@/types/intent';
import type { TaskSnapshot } from '@/lib/search-tasks';
import { resolveDate } from '@/lib/resolve-date';
import { searchTasks } from '@/lib/search-tasks';

export type ResolverContext = {
  tasks: TaskSnapshot[];
  history: ConversationTurn[];
  today: string;
};

export type ResolverError = {
  kind: 'resolver_error';
  code: 'AMBIGUOUS_REF' | 'NO_MATCH' | 'MISSING_TARGET';
  message: string;
  field: string;
  candidates?: string[];
};

export type ResolvedIR = IntentIR & { _resolved: true };

function resolveDiscourseRef(
  anchor: 'that' | 'this' | 'last',
  tasks: TaskSnapshot[],
  history: ConversationTurn[],
): string | ResolverError {
  // Look through history for the last mentioned task title
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    // Check if any task title appears in the message
    for (const task of tasks) {
      if (turn.content.includes(task.title)) {
        return task.title;
      }
    }
  }

  // If only one task exists, it's unambiguous
  if (tasks.length === 1) {
    return tasks[0].title;
  }

  if (tasks.length === 0) {
    return {
      kind: 'resolver_error',
      code: 'NO_MATCH',
      message: '참조할 수 있는 작업이 없습니다.',
      field: 'taskTitle',
    };
  }

  return {
    kind: 'resolver_error',
    code: 'AMBIGUOUS_REF',
    message: '어떤 작업을 말씀하시는 건가요?',
    field: 'taskTitle',
    candidates: tasks.filter((t) => !t.deletedAt).map((t) => t.title),
  };
}

function resolveTitleRef(
  value: string,
  tasks: TaskSnapshot[],
): string | ResolverError {
  const result = searchTasks(value, tasks);

  if (result.count === 0) {
    return {
      kind: 'resolver_error',
      code: 'NO_MATCH',
      message: `"${value}"에 해당하는 작업을 찾지 못했습니다.`,
      field: 'taskTitle',
    };
  }

  if (result.count === 1) {
    return result.found[0].title;
  }

  // Multiple matches — check for exact match first
  const exact = result.found.find(
    (t) => t.title.toLowerCase() === value.toLowerCase(),
  );
  if (exact) return exact.title;

  return {
    kind: 'resolver_error',
    code: 'AMBIGUOUS_REF',
    message: `"${value}"에 해당하는 작업이 여러 개입니다.`,
    field: 'taskTitle',
    candidates: result.found.map((t) => t.title),
  };
}

function resolveTerm(
  term: Term,
  ctx: ResolverContext,
): Term | ResolverError {
  if (term.kind !== 'ref') return term;

  if (term.anchor === 'title' && term.value) {
    const resolved = resolveTitleRef(term.value, ctx.tasks);
    if (typeof resolved !== 'string') return resolved;
    return { kind: 'ref', anchor: 'title', value: resolved };
  }

  if (term.anchor === 'that' || term.anchor === 'this' || term.anchor === 'last') {
    const resolved = resolveDiscourseRef(term.anchor, ctx.tasks, ctx.history);
    if (typeof resolved !== 'string') return resolved;
    return { kind: 'ref', anchor: 'title', value: resolved };
  }

  return term;
}

export function resolve(
  ir: IntentIR,
  ctx: ResolverContext,
): ResolvedIR | ResolverError {
  // 1. Resolve time
  let resolvedTime = ir.time;
  if (ir.time) {
    const dateStr = resolveDate(ir.time.value, ctx.today);
    resolvedTime = { ...ir.time, value: dateStr };
  }

  // 2. Resolve args
  const resolvedArgs: Partial<Record<Role, Term>> = {};
  for (const [role, term] of Object.entries(ir.args) as [Role, Term][]) {
    const resolved = resolveTerm(term, ctx);
    if ('kind' in resolved && resolved.kind === 'resolver_error') {
      return resolved as ResolverError;
    }
    resolvedArgs[role] = resolved as Term;
  }

  return {
    ...ir,
    args: resolvedArgs,
    time: resolvedTime,
    _resolved: true,
  } as ResolvedIR;
}
