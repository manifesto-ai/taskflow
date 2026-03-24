# TaskFlow Agent Context

## What This Is

TaskFlow는 Manifesto SDK v2.0.0 위에서 동작하는 태스크 관리 앱이다. AI 에이전트가 자연어로 태스크를 생성/수정/삭제할 수 있다. Manifesto의 "AI-native domain management" 비전을 검증하는 데모 앱.

## Architecture

```
사용자 자연어
    │
    ▼
┌─────────────────────────────────────┐
│  1st LLM (GPT-5.4 Nano)            │
│  → Intent IR (의미 구조) 출력        │
│  → MEL 원문을 system prompt로 전달  │
└─────────────┬───────────────────────┘
              ▼
┌─────────────────────────────────────┐
│  Resolver (결정적)                   │
│  - 날짜: "내일" → ISO date          │
│  - 참조: "그 작업" → task title     │
│  - 재사용: resolve-date.ts,         │
│           search-tasks.ts           │
└─────────────┬───────────────────────┘
              ▼
┌─────────────────────────────────────┐
│  Lower (결정적)                      │
│  - Lexicon으로 lemma → MEL action   │
│  - θ-role → IntentResult 필드 매핑   │
└─────────────┬───────────────────────┘
              ▼
        IntentResult (기존 타입 그대로)
              │
              ▼
┌─────────────────────────────────────┐
│  Client: executeIntent()            │
│  → Manifesto SDK dispatch           │
└─────────────┬───────────────────────┘
              ▼
┌─────────────────────────────────────┐
│  2nd LLM (GPT-5.4 Nano)            │
│  → 실행 결과를 자연어 응답으로 변환   │
└─────────────────────────────────────┘
```

### 핵심 원칙

- **LLM은 의미 구조만 출력한다.** 날짜 계산, 참조 해석, MEL 매핑은 결정적 코드가 한다.
- **MEL이 source of truth.** 프롬프트 엔지니어링으로 LLM을 제어하지 않는다. MEL 원문을 그대로 전달한다.
- **Snapshot이 유일한 상태 매체.** "If it's not in Snapshot, it doesn't exist."

## File Structure

```
src/
├── app/
│   ├── api/agent/
│   │   ├── route.ts          # 1st LLM — Intent IR 파이프라인
│   │   └── respond/route.ts  # 2nd LLM — 응답 생성
│   └── page.tsx              # 메인 UI + handleAssistantSubmit
├── components/
│   ├── assistant/            # AI 채팅 패널 (Messages, Input, Header)
│   ├── views/                # Kanban, Todo, Table, Trash 뷰
│   ├── sidebar/              # TaskDetailPanel
│   ├── shared/               # TaskCard, ViewSwitcher, MobileNavigation
│   └── ui/                   # shadcn/ui 기반 컴포넌트
├── domain/
│   ├── taskflow.mel          # MEL 도메인 정의 (single source of truth)
│   └── taskflow-schema.ts    # MEL을 문자열 상수로 export
├── hooks/
│   └── useTaskFlow.ts        # Manifesto SDK 연동 (Snapshot<TaskFlowData> 제네릭)
├── lib/
│   ├── lexicon.ts            # lemma → MEL action 매핑 테이블
│   ├── resolver.ts           # 결정적 참조/날짜 해석
│   ├── lower.ts              # Intent IR → IntentResult 변환
│   ├── resolve-date.ts       # 한국어/영어 날짜 표현 → ISO
│   ├── search-tasks.ts       # 태스크 제목 퍼지 검색
│   ├── date-filter.ts        # UI 날짜 필터
│   ├── taskflow-fixtures.ts  # 시드 데이터
│   └── utils.ts              # cn() 유틸
├── types/
│   ├── intent-ir.ts          # Intent IR 타입 (v0.2 간소화)
│   ├── intent.ts             # IntentResult, AgentRequest/Response
│   ├── taskflow.ts           # Task, ViewMode, AssistantMessage
│   └── mel.d.ts              # .mel 파일 타입 선언
└── manifesto/
    └── __tests__/taskflow.test.ts  # MEL 도메인 테스트
```

## Key Design Decisions

### Intent IR (not direct MEL action output)

LLM이 MEL action JSON(`{ kind: "createTask", ... }`)을 직접 출력하면:
- 날짜를 LLM이 계산 → 틀림
- "그 작업" 해석을 LLM이 함 → 불안정
- 모델 교체 시 깨짐

Intent IR로 분리하면:
- LLM: `{ force: "DO", event: { lemma: "create" }, args: { THEME: "사과 사기" }, time: { value: "내일" } }`
- Resolver: `"내일"` → `"2026-03-25"` (결정적)
- Lower: `lemma: "create"` → `createTask` (결정적)

### Lexicon은 수작업 (아직)

`lib/lexicon.ts`는 lemma → action 매핑을 수동으로 정의한다. 자동 생성은 [manifesto-ai/core#268](https://github.com/manifesto-ai/core/issues/268)에서 추적 중. MEL LSP는 [manifesto-ai/core#269](https://github.com/manifesto-ai/core/issues/269).

### 2-LLM 분리

1st LLM은 의도 파싱만, 2nd LLM은 실행 결과를 자연어로 변환. 각 프롬프트가 짧고 단일 책임.

### SDK v2.0.0

- `Snapshot<TaskFlowData>` 제네릭 — data 접근이 타입 안전
- `dispatchAsync` SDK 내장 — 커스텀 구현 삭제
- Schema defaults 자동 적용 — 초기화 버그 원천 제거
- computed는 아직 제네릭 미지원 → `TaskFlowComputed` 타입으로 한번에 캐스트

## Dependencies

```
@manifesto-ai/sdk      ^2.0.0   # Manifesto 런타임 (createManifesto, dispatch, subscribe)
@manifesto-ai/compiler ^1.7.0   # MEL 컴파일러 (compileMelDomain — agent route에서 사용)
openai                 ^6.25.0  # GPT-5.4 Nano (1st LLM, 2nd LLM)
next                   16.x     # App Router
react                  19.x
```

## Environment

```
OPENAI_API_KEY=sk-...   # .env.local에 설정
```

## Testing

```bash
pnpm typecheck          # tsc --noEmit
pnpm build              # next build
pnpm dev                # next dev (localhost:3000)

# API 테스트
curl -s http://localhost:3000/api/agent \
  -H 'Content-Type: application/json' \
  -d '{"message":"내일 사과 사기","tasks":[],"viewMode":"kanban","history":[]}'
```

## Known Friction (from FRICTION.md)

14개 friction 항목 기록됨. SDK v2.0.0에서 주요 항목 해결:
- F-001: `dispatchAsync` 추가
- F-002: `Snapshot<T>` 제네릭
- F-003: Schema defaults 자동 적용
- F-006: 컴파일 진단에 소스 위치 포함

## LLM Agent Guidelines

- **프롬프트 엔지니어링으로 문제를 풀지 말 것.** MEL, Intent IR, Lexicon 등 Manifesto 메커니즘을 사용할 것.
- **MEL 원문을 그대로 LLM에 전달.** 풀어 쓰거나 요약하지 않는다.
- **결정적 경계를 지킬 것.** LLM이 날짜 계산이나 참조 해석을 하면 안 된다. Resolver가 한다.
- **Lexicon에 새 lemma를 추가할 때** `lib/lexicon.ts`의 `LEMMA_MAP`에 엔트리 추가.
- **pnpm 사용.** npm 아님.

## References

- [Manifesto LLM Constitution](https://github.com/manifesto-ai/core/blob/main/CLAUDE.md)
- [Intent IR SPEC v0.2.0](https://github.com/manifesto-ai/core/blob/main/docs/archive/intent-ir/SPEC-v0.2.0.md)
- [Translator SPEC v1.0.3](https://github.com/manifesto-ai/core/blob/main/docs/archive/translator/translator-SPEC-v1.0.3.md)
- [auto-Lexicon issue #268](https://github.com/manifesto-ai/core/issues/268)
- [MEL LSP issue #269](https://github.com/manifesto-ai/core/issues/269)
