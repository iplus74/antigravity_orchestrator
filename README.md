# Antigravity AI 오케스트레이터 (Antigravity AI Orchestrator)

이 프로젝트는 **Google Antigravity SDK** 및 **Gemini API**를 활용하여 에이전트 기반 AI 오케스트레이션을 구현한 프로젝트입니다. 기존 Github Copilot SDK로 작성된 버전을 구글의 강력한 에이전트 추론 루프와 무중단 자동 승인 정책으로 마이그레이션 및 고도화하였습니다.

---

## 주요 기능

- 단계별 모델 지정
- 모델 fallback
- 재시도 및 백오프
- 단계별 로그 저장
- 이전 단계 결과를 다음 단계 프롬프트에 전달
- .env 기반 다중 target 선택

---

## 설치 및 셋업

### 1. 주요 필수 설치 모듈 (Dependencies)
이 프로젝트의 안정적 가동을 위해 반드시 설치되는 핵심 라이브러리 목록입니다 (`npm install` 시 자동으로 일괄 설치됩니다).

| 모듈 패키지명 (Package Name) | 설치 버전 | 주요 역할 및 용도 |
| :--- | :---: | :--- |
| **`unofficial-antigravity-sdk`** | `^1.0.2` | Antigravity 에이전트 제어 및 무중단 자동화 오케스트레이션 구동을 위한 핵심 SDK (내부에 `@google/genai`를 내장 의존성으로 포함) |
| **`@modelcontextprotocol/sdk`** | `^1.29.0` | MCP(Model Context Protocol) 기반 외부 검색 도구 및 MCP 서버들과의 공식 프로토콜 통신 연동용 SDK |
| **`tsx`** (DevDependency) | `^4.22.3` | 별도의 사전 컴파일 빌드 없이 TypeScript 파일(`.ts` 현장 조회 소스)을 네이티브 레벨로 즉시 구동 |

### 2. 패키지 설치 실행
프로젝트 루트 디렉토리에서 아래 명령어를 실행하여 명시된 모든 의존 모듈들을 자동으로 안전하게 통합 빌드 및 설치합니다.
```bash
npm install
```

### 3. 환경 설정 (`.env`)

cp .env.example .env

---

## 🔑 Gemini API Key 발급 방법

Google One AI Premium 요금제 혜택 또는 무료 티어를 바탕으로 자격 증명을 연동하려면 아래의 순서로 API Key를 즉시 발급받을 수 있습니다.

### [발급 순서]
1. **Google AI Studio 접속**
   * **[Google AI Studio](https://aistudio.google.com/)**(`https://aistudio.google.com/`)에 접속합니다.
   * **반드시 Google One AI 프리미엄 요금제를 구독 중인 구글 계정**으로 로그인하셔야 높은 쿼터 혜택이 정상 연동됩니다.

2. **API 키 생성 메뉴 진입**
   * 왼쪽 상단 또는 사이드바 메뉴의 **"Get API key"** 버튼을 클릭합니다.
   * **"Create API key"** 단추를 누릅니다.

3. **프로젝트 등록 오류 대처 및 키 생성**
   * **오류 상황 (새 프로젝트 생성 실패 시)**: 계정당 클라우드 생성 한도에 걸렸거나 조직 정책이 있을 경우 신규 개설(`Create API key in new project`)이 막혀 등록에 실패할 수 있습니다.
   * **우회 해결 방법**: 팝업에서 **"Create API key in existing project" (기존 프로젝트에서 API 키 생성)** 탭을 선택하고, 리스트에 있는 기존 프로젝트(예: `My First Project` 등 임의의 과거 프로젝트) 중 하나를 고른 뒤 생성 단추를 누르시면 막힘없이 즉시 생성됩니다.

4. **API 키 적용**
   * 발급된 API Key 문자열을 복사한 뒤, `.env` 파일의 `GEMINI_API_KEY` 값에 넣어 저장합니다.

---

## 실행 방법

### 1. 빠른 실행

기본 워크플로우 실행:

npm run orch:default

직접 실행:

npm run orch -- --target /절대/경로/프로젝트

### 2. .env로 여러 target 등록

예시:

TARGET_DEFAULT=/Users/yangsukim/data/work/house_sara/wecostay_home_nuxt
TARGET_WECOSTAY_HOME_NUXT=/Users/yangsukim/data/work/house_sara/wecostay_home_nuxt
TARGET_PLATFORM_API=/Users/yangsukim/data/work/house_sara/platform_api
TARGET_PLATFORM_LOBBY_API=/Users/yangsukim/data/work/house_sara/platform_lobby_api

실행 시 target 선택:

npm run orch -- --target-name WECOSTAY_HOME_NUXT
npm run orch -- --target-name PLATFORM_API

참고:
- --target-name은 TARGET_<이름> 키를 찾습니다.
- 현재 TARGET_DEFAULT는 별칭이 아니라 실제 경로를 넣는 방식입니다.

### 3. target 선택 우선순위

실행 시 target 결정 순서:

1. --target
2. --target-name으로 찾은 TARGET_<NAME>
3. TARGET_DEFAULT
4. 현재 실행 디렉터리

### 4. 실행 옵션

도움말:

npm run orch -- --help

지원 옵션:
- --target <workspacePath>
- --target-name <name>
- --steps <jsonPath>
- --output-dir <dirPath>
- --log-dir <dirPath>
- --timeout-ms <number>
- --max-attempts <number>
- --backoff-ms <number>

예시:

npm run orch -- --target-name WECOSTAY_HOME_NUXT --steps ./workflow.default.json --output-dir ./runs --log-dir ./runs/logs --timeout-ms 300000 --max-attempts 3 --backoff-ms 2000

---

## 워크플로우 파일 형식

workflow.default.json은 step 배열입니다.

각 step 필드:
- name: 단계 이름 (필수)
- prompt: 모델에게 전달할 질의 (필수)
- model: 기본 모델
- models: 모델 배열. 있으면 model보다 우선
- fallbackModels: model 실패 시 대체 모델 목록
- mcp.tool: MCP 도구 이름
- mcp.args: MCP 도구에 전달할 인자 객체
- retry.maxAttempts: 단계별 재시도 횟수 오버라이드
- retry.backoffMs: 단계별 백오프(ms) 오버라이드

* mcp 필드가 있는 경우, prompt 대신 MCP 결과를 step 프롬프트로 사용합니다.  mcp결과에 attachments 필드가 있으면 step.attachments로 변환하여 모델 입력에 포함합니다.

최소 예시:

[
  {
    "name": "step1_api",
    "model": "claude-sonnet-4.6",
    "fallbackModels": ["gpt-5"],
    "mcp": {
      "tool": "read_category_markdown",
      "args": {
        "category": "api_260526"
      }
    },
    "prompt": "mylocal MCP에서 'api_260526' 조회를 수행하고, 가져온 문서를 바탕으로 작업을 진행해 주세요."
  }
]

## 지원모델 정보 및 이미지 입력 제한 사양
   [지원모델](./models.md)
   
## 로그와 결과 파일

기본 동작:
- 실행마다 runId 디렉터리 생성
- 단계별 로그 파일 저장
- --output-dir 지정 시 결과 report-<runId>.md 저장

예시 구조:

runs/
  logs/
    2026-05-28T01-23-45-678Z/
      01-step1_api.log
      02-step2_review.log
      
  report-2026-05-28T01-23-45-678Z.md

## 실패 처리 동작

단계 실행 순서:
1. 현재 모델로 실행
2. 실패 시 maxAttempts만큼 재시도
3. 모두 실패하면 fallback 모델로 전환
4. 모든 모델 실패 시 전체 실행 중단

자동 보정 흐름:
1. Step 1 결과에 변경/생성 파일 목록이 없으면 보정 step을 추가 실행하여 파일 목록을 다시 수집
2. Step 2 검수 결과에 `[오류 발견]`이 포함되면 자동 수정 step을 추가 실행
3. Step 3는 Step 1 원래 기획 의도와 최신 Step 2 검수 결과를 함께 참고하여 최종 판단

## 트러블슈팅

1. 모델명을 찾을 수 없다는 오류

2. MCP 조회가 동작하지 않음
   - VSCODE, Antigravity IDE 등에서 MCP 설정 및 연결상태 확인 필요
   
3. target이 의도와 다르게 선택됨
   - --target, --target-name, TARGET_DEFAULT 우선순위 확인
   - .env 값에 공백, 따옴표, 오탈자 확인   
   
4. 로그는 생성되는데 결과가 비어 있음
   - 모델 응답이 비어 있는 경우가 있을 수 있으므로 timeout, retry, prompt 길이 조정   
   
## 운영 팁

- 프로젝트별로 .env의 TARGET_*를 고정해 두고 --target-name만 바꿔 사용
- 공통 옵션은 npm script로 alias 만들어 팀 표준화
- runs 폴더를 주기적으로 정리해서 저장소 용량 관리   