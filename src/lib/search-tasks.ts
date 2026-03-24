export interface TaskSnapshot {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string | null;
  dueDate: string | null;
  tags: string[];
  deletedAt: string | null;
}

export interface SearchResult {
  found: TaskSnapshot[];
  count: number;
}

export function searchTasks(query: string, tasks: TaskSnapshot[]): SearchResult {
  const lower = query.toLowerCase();
  const found = tasks.filter((t) => t.title.toLowerCase().includes(lower));
  return { found, count: found.length };
}
