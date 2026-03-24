/**
 * Lexicon — lemma → MEL action mapping table.
 *
 * Pure data. No IO. Derived from TaskFlow MEL domain.
 * Each entry maps semantic roles (θ-roles) to IntentResult fields.
 */

import type { Role } from '@/types/intent-ir';
import type { IntentResult } from '@/types/intent';

type RoleMapping = {
  intentKind: IntentResult['kind'];
  roleMap: Partial<Record<Role, string>>;
  timeField?: string;
};

const LEMMA_MAP: Record<string, RoleMapping> = {
  create: {
    intentKind: 'createTask',
    roleMap: {
      THEME: 'title',
      BENEFICIARY: 'assignee',
    },
    timeField: 'dueDate',
  },
  update: {
    intentKind: 'updateTask',
    roleMap: {
      TARGET: 'taskTitle',
    },
    timeField: 'dueDate',
  },
  move: {
    intentKind: 'moveTask',
    roleMap: {
      TARGET: 'taskTitle',
      DEST: 'newStatus',
    },
  },
  delete: {
    intentKind: 'softDeleteTask',
    roleMap: { TARGET: 'taskTitle' },
  },
  restore: {
    intentKind: 'restoreTask',
    roleMap: { TARGET: 'taskTitle' },
  },
  destroy: {
    intentKind: 'permanentlyDeleteTask',
    roleMap: { TARGET: 'taskTitle' },
  },
  empty: {
    intentKind: 'emptyTrash',
    roleMap: {},
  },
  select: {
    intentKind: 'selectTask',
    roleMap: { TARGET: 'taskTitle' },
  },
  show: {
    intentKind: 'changeView',
    roleMap: { THEME: 'viewMode' },
  },
  change: {
    intentKind: 'changeView',
    roleMap: { THEME: 'viewMode' },
  },
  switch: {
    intentKind: 'changeView',
    roleMap: { THEME: 'viewMode' },
  },
  query: {
    intentKind: 'query',
    roleMap: { THEME: 'question' },
  },
};

export function lookupAction(lemma: string): RoleMapping | undefined {
  return LEMMA_MAP[lemma.toLowerCase()];
}
