# TaskFlow Demo

> **TL;DR**: This is a runnable demo showing how LLMs can drive applications by emitting validated intents — without directly mutating UI state.

A demonstration web application built on top of [`@manifesto-ai/core`](https://github.com/manifesto-ai/core), showcasing an **Intent-Native runtime** architecture where LLMs emit validated intents that are executed deterministically by a runtime layer.

In this architecture, **the LLM does not mutate UI state directly**. Instead, it produces structured Intent objects that are validated, then executed by a deterministic runtime to generate Effects—which are finally applied to the application snapshot.

---

## What This Project IS

- A **working demo** of an Intent → Effect → Snapshot execution model
- A **reference implementation** of a Simple Intent API using GPT-4o-mini
- A practical example of integrating:
  - LLM (intent generation via natural language)
  - Deterministic runtime (effect execution)
  - React + Zustand UI (state projection)
  - SSE streaming (real-time feedback)
- A **runnable example** to understand Manifesto as a runtime, not just a concept
- A task management app with natural language interaction (create, update, delete, query tasks)

---

## What This Project is NOT

- **Not** the full Manifesto research architecture (e.g., ICAA, policy learning)
- **Not** a multi-agent orchestration framework
- **Not** an attempt to replace React, Zustand, or existing UI frameworks
- **Not** a production-ready task management solution
- This demo **intentionally avoids** complex policy learning, speculative autonomy, or multi-step planning

This project is scoped as a **minimal, understandable demonstration** of the core runtime concepts.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                               │
│                                                              │
│   User Input ("Add a task for tomorrow")                     │
│         │                                                    │
│         ▼                                                    │
│   ┌─────────────┐    SSE     ┌─────────────┐                │
│   │ Assistant   │ ─────────▶ │   Zustand   │                │
│   │   Panel     │   Events   │    Store    │                │
│   └─────────────┘            └──────┬──────┘                │
│                                     │                        │
│                              ┌──────▼──────┐                │
│                              │   Storage   │                │
│                              │ (IndexedDB) │                │
│                              └─────────────┘                │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ POST /api/agent/simple/stream
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                         SERVER                               │
│                                                              │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐       │
│   │  GPT-5-mini │ → │   Intent    │ → │   Runtime   │       │
│   │  (1-shot)   │   │  Validator  │   │  Executor   │       │
│   └─────────────┘   └─────────────┘   └─────────────┘       │
│                                              │               │
│                                              ▼               │
│                                       ┌─────────────┐       │
│                                       │   Effects   │       │
│                                       │ (PatchOps)  │       │
│                                       └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Input** → Natural language instruction
2. **LLM** → Generates structured Intent JSON (validated schema)
3. **Runtime** → Executes intent deterministically, produces Effects
4. **Effects** → Applied to Zustand store via patch operations
5. **Storage** → Persists to IndexedDB (with localStorage fallback)

---

## Relationship to `@manifesto-ai/core`

### What `@manifesto-ai/core` provides:

- Snapshot model and schema definitions
- Deterministic runtime semantics
- Effect application mechanics
- Domain definition DSL

### What this demo app provides:

- UI layer (React + Tailwind + shadcn/ui)
- LLM integration (OpenAI GPT-4o-mini)
- SSE streaming for real-time feedback
- Storage layer (IndexedDB / localStorage)
- Intent validation and execution pipeline

### Advanced research directions

More sophisticated architectures (e.g., ICAA—Intent-Centric Agent Architecture, multi-agent orchestration, policy learning) are explored **outside this repository**. This demo focuses on the foundational runtime pattern.

---

## Who This Demo Is For

- Engineers exploring **AI + UI + state management** patterns
- Developers curious about making **AI behavior auditable and explainable**
- People evaluating Manifesto as a **runtime for LLM-driven applications**
- Anyone interested in **Intent-Native architectures** where AI doesn't directly mutate state

---

## Key Concepts

### Intent

A structured, validated object representing "what the user wants to do":

```typescript
{
  kind: "CreateTask",
  tasks: [{ title: "Review PR", priority: "high", dueDate: "2024-12-15" }],
  confidence: 0.95,
  source: "human"
}
```

### Effect

A deterministic patch operation produced by the runtime:

```typescript
{
  type: "snapshot.patch",
  ops: [
    { op: "append", path: "data.tasks", value: { id: "task-123", ... } }
  ]
}
```

### Snapshot

The complete application state at a point in time, modified only through Effects.

---

## Supported Intent Types

| Intent | Description |
|--------|-------------|
| `CreateTask` | Create one or more tasks |
| `UpdateTask` | Modify task properties (title, assignee, etc.) |
| `ChangeStatus` | Change task status (todo → in-progress → done) |
| `DeleteTask` | Soft-delete a task |
| `SelectTask` | Select/deselect a task for viewing |
| `QueryTasks` | Ask questions about tasks |
| `ChangeView` | Switch view mode (kanban/table/todo) |
| `SetDateFilter` | Apply date-based filtering |
| `Undo` | Revert the last action |

---

## Getting Started

### Prerequisites

- Node.js 18+
- OpenAI API key

### Installation

```bash
pnpm install
```

### Configuration

Create a `.env.local` file:

```env
OPENAI_API_KEY=your-api-key-here
```

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

---

## Project Structure

```
src/
├── app/
│   ├── api/agent/simple/     # Simple Intent API (streaming + non-streaming)
│   └── page.tsx              # Main application page
├── lib/
│   ├── agents/
│   │   ├── intent.ts         # Intent types and validation
│   │   ├── runtime.ts        # Deterministic execution engine
│   │   └── types.ts          # Shared type definitions
│   └── storage/              # IndexedDB + localStorage persistence
├── store/
│   ├── useTasksStore.ts      # Zustand store
│   └── provider.tsx          # React context + storage sync
├── components/
│   ├── assistant/            # AI assistant panel
│   └── views/                # Kanban, Table, Todo views
└── domain/
    └── tasks.ts              # Task domain model
```

---

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: React 19, Tailwind CSS, shadcn/ui
- **State**: Zustand + @manifesto-ai/bridge-zustand
- **LLM**: OpenAI GPT-4o-mini
- **Storage**: IndexedDB (primary), localStorage (fallback)
- **Streaming**: Server-Sent Events (SSE)

---

## License

MIT
