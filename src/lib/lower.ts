/**
 * Lower — deterministic IntentIR → IntentResult conversion.
 *
 * Uses Lexicon to map semantic roles to MEL action fields.
 * Output matches the existing IntentResult type exactly.
 */

import type { IntentIR, Term, Role } from '@/types/intent-ir';
import type { IntentResult } from '@/types/intent';
import { lookupAction } from '@/lib/lexicon';

export type LowerError = {
  kind: 'lower_error';
  message: string;
};

function extractValue(term: Term): unknown {
  switch (term.kind) {
    case 'literal':
      return term.value;
    case 'ref':
      return term.value;
    case 'status':
      return term.value;
    case 'priority':
      return term.value;
    case 'view':
      return term.value;
  }
}

export function lower(ir: IntentIR & { _resolved: true }): IntentResult | LowerError {
  const mapping = lookupAction(ir.event.lemma);
  if (!mapping) {
    return { kind: 'lower_error', message: `Unknown lemma: ${ir.event.lemma}` };
  }

  const { intentKind, roleMap, timeField } = mapping;

  switch (intentKind) {
    case 'createTask': {
      const task: Record<string, unknown> = {};
      for (const [role, fieldName] of Object.entries(roleMap)) {
        const term = ir.args[role as Role];
        if (term) task[fieldName] = extractValue(term);
      }
      // Collect extra args not in roleMap
      for (const [role, term] of Object.entries(ir.args) as [Role, Term][]) {
        if (role in roleMap) continue;
        if (term.kind === 'priority') task.priority = term.value;
        if (term.kind === 'status') task.status = term.value;
        if (term.kind === 'literal' && role === 'INSTRUMENT') task.description = term.value;
        if (term.kind === 'literal' && role === 'SOURCE') task.tags = Array.isArray(term.value) ? term.value : [term.value];
      }
      if (timeField && ir.time) task[timeField] = ir.time.value;
      return { kind: 'createTask', task } as IntentResult;
    }

    case 'updateTask': {
      const taskTitle = extractValue(ir.args.TARGET!) as string;
      const fields: Record<string, unknown> = {};
      for (const [role, term] of Object.entries(ir.args) as [Role, Term][]) {
        if (role === 'TARGET') continue;
        if (term.kind === 'priority') fields.priority = term.value;
        else if (term.kind === 'status') fields.status = term.value;
        else if (role === 'BENEFICIARY') fields.assignee = extractValue(term);
        else if (role === 'THEME') fields.title = extractValue(term);
        else if (role === 'INSTRUMENT') fields.description = extractValue(term);
        else if (role === 'SOURCE') {
          const v = extractValue(term);
          fields.tags = Array.isArray(v) ? v : [v];
        }
      }
      if (timeField && ir.time) fields[timeField] = ir.time.value;
      return { kind: 'updateTask', taskTitle, fields } as IntentResult;
    }

    case 'moveTask': {
      const taskTitle = extractValue(ir.args.TARGET!) as string;
      const dest = ir.args.DEST;
      const newStatus = dest ? extractValue(dest) as string : undefined;
      if (!newStatus) return { kind: 'lower_error', message: 'moveTask requires DEST (newStatus)' };
      return { kind: 'moveTask', taskTitle, newStatus } as IntentResult;
    }

    case 'softDeleteTask':
    case 'restoreTask':
    case 'permanentlyDeleteTask':
    case 'selectTask': {
      const target = ir.args.TARGET;
      const taskTitle = target ? extractValue(target) as string : null;
      return { kind: intentKind, taskTitle } as IntentResult;
    }

    case 'emptyTrash':
      return { kind: 'emptyTrash' } as IntentResult;

    case 'changeView': {
      const theme = ir.args.THEME;
      const viewMode = theme ? extractValue(theme) as string : undefined;
      if (!viewMode) return { kind: 'lower_error', message: 'changeView requires THEME (viewMode)' };
      return { kind: 'changeView', viewMode } as IntentResult;
    }

    case 'query': {
      const theme = ir.args.THEME;
      const question = theme ? extractValue(theme) as string : ir.event.lemma;
      return { kind: 'query', question } as IntentResult;
    }

    default:
      return { kind: 'lower_error', message: `Unhandled intent kind: ${intentKind}` };
  }
}
