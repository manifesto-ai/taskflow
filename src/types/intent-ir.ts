/**
 * Intent IR — Simplified v0.2 for TaskFlow MVP
 *
 * LLM outputs this semantic structure. All downstream processing
 * (date resolution, reference resolution, MEL action mapping)
 * is deterministic.
 */

export type Force = 'DO' | 'ASK' | 'VERIFY';

export type EventClass = 'CREATE' | 'TRANSFORM' | 'DESTROY' | 'OBSERVE' | 'CONTROL';

export type Role = 'TARGET' | 'THEME' | 'SOURCE' | 'DEST' | 'INSTRUMENT' | 'BENEFICIARY';

export type Term =
  | { kind: 'literal'; value: string | number | boolean | string[] }
  | { kind: 'ref'; anchor: 'that' | 'this' | 'last' | 'title'; value?: string }
  | { kind: 'status'; value: 'todo' | 'in-progress' | 'review' | 'done' }
  | { kind: 'priority'; value: 'low' | 'medium' | 'high' }
  | { kind: 'view'; value: 'kanban' | 'todo' | 'table' | 'trash' };

export type TimeSpec = {
  role: 'DEADLINE' | 'AT';
  value: string;
};

export type IntentIR = {
  v: '0.2';
  force: Force;
  event: {
    lemma: string;
    class: EventClass;
  };
  args: Partial<Record<Role, Term>>;
  time?: TimeSpec;
};
