# Antigravity AI 오케스트레이터 (Antigravity AI Orchestrator)

이 프로젝트는 **Google Antigravity SDK** 및 **Gemini API**를 활용하여 에이전트 기반 AI 오케스트레이션을 구현한 프로젝트입니다. 기존 Github Copilot SDK로 작성된 버전을 구글의 강력한 에이전트 추론 루프와 무중단 자동 승인 정책으로 마이그레이션 및 고도화하였습니다.

---

## 주요 기능

1. **3단계 에이전트 오케스트레이션**: 기획 및 구현 요청(Step 1), 정밀 코드 검수 및 자동 수정 가이드(Step 2), 최종 비즈니스 의도 일치 여부 재검토(Step 3)로 구성된 유기적 검수 흐름 제공
2. **무중단 자동 승인 정책 (Auto-Approval)**: Antigravity Agent 구동 시 `policies: [allowAll()]` 보안 후크를 통합하여, 파일 작성/수정 및 로컬 커맨드 실행 등의 에이전트 도구 요청을 수동 승인 절차 없이 전자동으로 가동
3. **스마트 모델 매핑**: 지시서에 포함된 기존 모델명(Claude, GPT 계열 등)을 실사용 가능한 최신 Gemini 모델군(`gemini-3.5-flash` 및 `gemini-2.5-pro` 등)으로 자동 변환해 주는 로직 기본 탑재
4. **Gemini 비전 사양 조회**: 이미지 및 멀티모달 입력을 제공하는 사용 가능 Gemini 모델 리스트와 이미지 사양 제한 정보를 직관적으로 출력해 주는 도구 제공

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

### 2. 환경 설정 (`.env`)
프로젝트 루트 디렉토리의 `.env` 파일을 구성하여 작업 타겟 경로들과 Gemini API 키를 적용합니다.
```env
# 기본 작업 대상 경로
TARGET_DEFAULT=C:\work\wecostay_home_nuxt

# Google One AI 요금제 및 Gemini 연동 API Key
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

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

### 1. 3단계 AI 오케스트레이션 구동
기획 및 검수 시나리오를 바탕으로 전체 에이전트 오케스트레이션 루프를 전자동 실행합니다.
```bash
# 기본 정의 워크플로우 실행
npm run orch:default

# 특정 인수 지정 실행
npm run orch -- --target <작업경로> --steps <워크플로우JSON경로> --output-dir <결과저장디렉토리>
```

### 2. 이미지/비전 지원 모델 조회
현재 발급된 API Key 계정에서 사용 가능한 Gemini 멀티모달 비전 모델 사양(지원 파일 크기, 형식 및 이미지 수 제한 등)을 콘솔 테이블로 이쁘게 조회합니다.
```bash
npm run vision:limits
```

---

## 디렉토리 구조

```text
├── .env                          # 환경 설정 및 API Key 기입 파일
├── workflow.default.json         # 오케스트레이션 검수 시나리오 단계 정의 파일
├── package.json                  # 프로젝트 종속 패키지 및 구동 스크립트 정의
├── src/
│   ├── orchestrate.js            # Antigravity SDK 기반 오케스트레이터 메인 소스
│   └── list-vision-model-limits.ts # Gemini 지원 비전 모델 정보 조회 도구 소스
└── runs/                         # 실행 결과 보고서(.md) 및 누적 로그 폴더 (자동 생성)
```
