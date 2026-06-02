import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { Agent, LocalAgentConfig, CapabilitiesConfig, BuiltinTools, allowAll, enforce, Image } from 'unofficial-antigravity-sdk'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const DEFAULT_STEPS_PATH = './workflow.default.json'
const DEFAULT_OUTPUT_DIR = './runs'
const DEFAULT_LOG_DIR = './runs/logs'
const DEFAULT_TIMEOUT_MS = 300000
const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_BACKOFF_MS = 1500
const DEFAULT_MCP_SEARCHER_PATH = '/Users/yangsukim/data/work/house_sara/mcp-md-searcher/src/index.ts'
const DEFAULT_MCP_SEARCHER_DATA = '/Users/yangsukim/data/work/house_sara/mcp_data'

const globalAccumulatedUsage = {
  promptTokenCount: 0,
  candidatesTokenCount: 0,
  totalTokenCount: 0,
}

/**
 * 주어진 값을 1 이상의 정수로 파싱합니다.
 * @param {string|undefined|null} rawValue - 파싱할 값
 * @param {string} optionName - 옵션 이름 (에러 메시지에 사용)
 * @param {number} defaultValue - 기본값
 * @returns {number} 파싱된 정수 값
 * @throws {Error} 값이 유효하지 않은 경우
 */
function parsePositiveIntegerOption(rawValue, optionName, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue
  }

  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} 값은 1 이상의 정수여야 합니다. 입력값=${rawValue}`)
  }

  return parsed
}

/**
 * 명령줄 인수를 파싱하여 객체로 반환합니다.
 * @returns {Object} 파싱된 인수 객체
 */
function getParsedArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      target: { type: 'string', default: '' },
      'target-name': { type: 'string', default: '' },
      steps: { type: 'string', default: DEFAULT_STEPS_PATH },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'log-dir': { type: 'string', default: DEFAULT_LOG_DIR },
      'timeout-ms': { type: 'string' },
      'max-attempts': { type: 'string' },
      'backoff-ms': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: false,
  })

  return {
    target: values.target,
    targetName: values['target-name'],
    steps: values.steps,
    outputDir: values['output-dir'],
    logDir: values['log-dir'],
    timeoutMs: parsePositiveIntegerOption(values['timeout-ms'], '--timeout-ms', DEFAULT_TIMEOUT_MS),
    maxAttempts: parsePositiveIntegerOption(
      values['max-attempts'],
      '--max-attempts',
      DEFAULT_MAX_ATTEMPTS,
    ),
    backoffMs: parsePositiveIntegerOption(values['backoff-ms'], '--backoff-ms', DEFAULT_BACKOFF_MS),
    help: values.help,
  }
}

/**
 * steps 파일을 로드하고 검증합니다.
 * @param {string} filePath - steps 파일 경로
 * @returns {Promise<Array>} 로드된 steps 배열
 * @throws {Error} 파일이 없거나 형식이 잘못된 경우
 */
async function loadSteps(filePath) {
  if (!filePath) {
    throw new Error('steps 파일 경로가 필요합니다.')
  }

  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw)

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('steps 파일은 비어 있지 않은 배열이어야 합니다.')
  }

  let isMcp = false
  for (const item of parsed) {
    if (!item.name || (!item.prompt && !item.mcp)) {
      throw new Error('각 step에는 name, prompt 또는 mcp가 필요합니다.')
    }

    // mcp 구성 데이터 유효성 검증
    if (item.mcp) {
      const hasMcpTool = typeof item.mcp.tool === 'string' && item.mcp.tool.length > 0 
        && item.mcp.args && typeof item.mcp.args === 'object' && item.mcp.args.category 
        && typeof item.mcp.args.category === 'string' && item.mcp.args.category.length > 0
      if (!hasMcpTool) {
        throw new Error('step.mcp가 있을 경우 mcp.tool 문자열과 mcp.args.category 문자열이 필요합니다.')
      }
      isMcp = true
    }

    // model 또는 models 배열 유효성 검증
    const hasModel = typeof item.model === 'string' && item.model.length > 0
    const hasModelList = Array.isArray(item.models) && item.models.length > 0
    if (!hasModel && !hasModelList) {
      throw new Error('각 step에는 model 또는 models 배열이 필요합니다.')
    }
  }
  
  if (!isMcp) {
    return parsed
  }
  
  const mcpServerPath = process.env.MCP_SEARCHER_PATH || DEFAULT_MCP_SEARCHER_PATH
  const mcpServerData = process.env.MCP_SEARCHER_DATA || DEFAULT_MCP_SEARCHER_DATA
    
  const mcpClient = new McpClient({
    name: 'mcp-caller',
    version: '1.0.0',
  })

  const transport = new StdioClientTransport({
    command: "npx",
    args: ['-y', 'tsx', mcpServerPath, mcpServerData],
    cwd: process.cwd(),
    stderr: 'inherit',
  })
  
  await mcpClient.connect(transport)
  
  /**
   * 각 step에 대해 MCP 호출을 수행하여 prompt와 첨부 파일을 준비합니다.
   * - step.prompt 수정
   * - step.mcp.attachments 추가 (이미지 첨부 파일 목록)
   */
  try {
    for (const key in parsed) {
      if (!parsed[key].mcp) {
        continue
      }
      
      const mcpConfig = parsed[key].mcp
      const result = await mcpClient.callTool({
        name: mcpConfig.tool,
        arguments: mcpConfig.args || {},
      })

      const textBlock = Array.isArray(result?.content)
        ? result.content.find((block) => block?.type === 'text' && typeof block.text === 'string')
        : null

      if (!textBlock || typeof textBlock.text !== 'string') {
        throw new Error(`step ${key+1} MCP 결과에서 text 블록을 찾을 수 없습니다.`)
      }
          
      const payload = JSON.parse(textBlock.text)

      const contentText =
        typeof payload?.content === 'string' && payload.content.length > 0 ? payload.content : ''
        
      if (contentText.length === 0) {
        throw new Error(`step ${key+1} MCP 결과에서 content 텍스트가 비어 있습니다.`)
      }
        
      let attachments = []
      if (Array.isArray(payload?.images) && payload.images.length > 0) {
        attachments = await toImageAttachments(payload?.images)
      }
      
      parsed[key].prompt = contentText
      if (attachments.length > 0) {
        parsed[key].mcp.attachments = attachments
      }
    }
  } catch (error) {
    throw new Error(`MCP 처리 중 오류가 발생했습니다: ${error?.message || String(error)}`)
  } finally {
    await mcpClient.close()
  }

  return parsed
}

/**
 * 환경 변수에서 대상 워크스페이스 경로를 반환합니다.
 * @param {Object} env - 환경 변수 객체
 * @param {string} targetName - 대상 이름
 * @returns {string} 대상 경로
 */
function resolveTargetFromEnv(env, targetName) {
  if (!targetName) {
    return ''
  }

  const directKey = `TARGET_${targetName}`
  if (env[directKey]) {
    return env[directKey]
  }

  const normalizedKey = `TARGET_${targetName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
  if (env[normalizedKey]) {
    return env[normalizedKey]
  }

  return ''
}

/**
 * TARGET 환경 변수 키 목록을 반환합니다.
 * @param {Object} env - 환경 변수 객체
 * @returns {Array<string>} TARGET 환경 변수 키 목록
 */
function listTargetKeys(env) {
  return Object.keys(env)
    .filter((key) => key.startsWith('TARGET_') && key !== 'TARGET_DEFAULT')
    .sort()
}

/**
 * 안전한 파일 이름을 반환합니다.
 * @param {string} input - 원본 문자열
 * @returns {string} 안전한 파일 이름
 */
function sanitizeFileName(input) {
  return input.replace(/[^a-zA-Z0-9-_]/g, '_')
}

/**
 * step에 적용할 모델 목록을 반환합니다.
 * @param {Object} step - step 객체
 * @returns {Array<string>} step 모델 목록
 */
function resolveModelCandidates(step) {
  if (Array.isArray(step.models) && step.models.length > 0) {
    return [...new Set(step.models.filter(Boolean))]
  }

  const merged = [step.model, ...(Array.isArray(step.fallbackModels) ? step.fallbackModels : [])]
  return [...new Set(merged.filter(Boolean))]
}

/**
 * step에 재시도 정책을 반환합니다.
 * @param {Object} step - step 객체
 * @param {Object} args - 명령 인수 객체
 * @returns {Object} 재시도 정책 객체
 */
function resolveRetryPolicy(step, args) {
  const maxAttempts = Number.isFinite(step?.retry?.maxAttempts)
    ? Math.max(1, Math.floor(step.retry.maxAttempts))
    : args.maxAttempts

  const backoffMs = Number.isFinite(step?.retry?.backoffMs)
    ? Math.max(1, Math.floor(step.retry.backoffMs))
    : args.backoffMs

  return { maxAttempts, backoffMs }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
  
/**
 * step 로그를 파일에 추가합니다.
 * @param {string} filePath - 로그 파일 경로
 * @param {string} message - 로그 메시지
 * @returns {Promise<void>}
 */
async function appendStepLog(filePath, message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  await fs.appendFile(filePath, line, 'utf8')
}

/**
 * 경로가 유효한지 체크
 * @param {string} rawPath - 원본 경로
 * @returns {Promise<boolean>} 경로가 존재하면 true, 그렇지 않으면 false
 */
async function isExistingPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return false
  }

  // 절대 경로 아닐 경우
  if (!path.isAbsolute(rawPath)) {
    return false
  }

  try {
    await fs.access(rawPath)
    return true
  } catch {
    return false
  }

  return false
}

/**
 * 이미지 첨부 파일 목록 생성
 * @param {Array} images - 이미지 정보 배열 (각 항목은 { path: string, alt?: string } 형태)
 * @returns {Promise<Array>} 이미지 첨부 파일 목록 (각 항목은 { type: 'file', path: string, displayName: string } 형태)
 */
async function toImageAttachments(images) {
  const list = Array.isArray(images) ? images : []
  const attachments = []

  for (const item of list) {
    if (!item?.path || typeof item.path !== 'string' || !path.isAbsolute(item.path)) {
      throw new Error(`유효하지 않은 이미지 경로: ${item?.path}`)
    }
    
    const displayName =
      typeof item?.alt && typeof item.alt === 'string' && item.alt.length > 0
        ? item.alt
        : path.basename(item.path)

    attachments.push({
      type: 'file',
      path: item.path,
      displayName,
    })
  }

  return attachments
}

/**
 * 텍스트를 마크다운 블록 인용 형식으로 변환합니다.
 * @param {string} text - 변환할 텍스트
 * @returns {string} 블록 인용 형식으로 변환된 텍스트
 */
function toBlockquote(text) {
  if (!text || typeof text !== 'string') {
    return '> (없음)'
  }

  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

/**
 * 최종 마크다운 보고서 문자열을 생성합니다.
 * @param {Object} params - 보고서 생성에 필요한 매개변수 객체
 * @param {string} params.targetAbs - 대상 워크스페이스 절대경로
 * @param {string} params.ranAt - 실행 시각
 * @param {string} params.logDir - 로그 디렉토리 경로
 * @param {Array} params.results - 실행된 step 결과 배열
 * @returns {string} 최종 마크다운 보고서 문자열
 */
function buildFinalMarkdownReport({ targetAbs, ranAt, logDir, results }) {
  const lines = [
    '# Orchestration Result',
    '',
    `- Target: ${targetAbs}`,
    `- Ran At: ${ranAt}`,
    `- Log Dir: ${logDir}`,
    `- Step Count: ${results.length}`,
    '',
    '## Steps',
    '',
  ]

  for (const [index, step] of results.entries()) {
    lines.push(`### ${index + 1}. ${step.name}`)
    lines.push('')
    lines.push(`- Model: ${step.model || '(없음)'}`)
    lines.push('- Prompt: ')
    lines.push('~~~');
    lines.push(`${step.sendPrompt}`)
    lines.push('~~~');
    
    if (step.attachments && step.attachments.length > 0) {
      lines.push('- Attachments:')
      for (const attachment of step.attachments) {
        lines.push(`  - ${attachment.path} (${attachment.displayName})`)
      }
    }
    lines.push(`- Completed At: ${step.completedAt || '(없음)'}`)
    if (step?.attempts) {
      lines.push(
        `- Attempt: ${step.attempts.try || '(없음)'} / ${step.attempts.maxAttempts || '(없음)'}`,
      )
    }
    if (step.usage) {
      lines.push(`- Usage: Prompt ${step.usage.promptTokenCount}, Candidates ${step.usage.candidatesTokenCount}, Total ${step.usage.totalTokenCount}`)
    }
    if (step.accumulatedUsage) {
      lines.push(`- Accumulated Usage: Prompt ${step.accumulatedUsage.promptTokenCount}, Candidates ${step.accumulatedUsage.candidatesTokenCount}, Total ${step.accumulatedUsage.totalTokenCount}`)
    }
    lines.push('')
    lines.push('#### Output')
    lines.push('')
    lines.push(toBlockquote(step.output))
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 텍스트에 코드 또는 파일 관련 정보가 포함되어 있는지 판단합니다.
 * @param {string} text - 검사할 텍스트
 * @returns {boolean} 코드와 유사한 내용이 포함되어 있으면 true, 그렇지 않으면 false
 */
function hasCodeLikeContent(text) {
  if (!text || typeof text !== 'string') {
    return false
  }

  const codeMarkers = [
    /```[\s\S]*?```/,
    /^diff --git /m,
    /^\+\+\+\s/m,
    /^---\s/m,
    /^@@\s/m,
    /\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bvar\b/,
    /\bpackage\b|\bimport\b|\bfunc\b|\btype\b|\bstruct\b/,
  ]

  const hasCodeMarkers = codeMarkers.some((regex) => regex.test(text))
  if (hasCodeMarkers) {
    return true
  }

  const hasFilePathLikeText = /(?:^|\s|['"`*])(?:\.?\/?[\w-]+\/)+[\w-]+\.[a-zA-Z0-9]+\b/.test(text)
  const hasFileListSignal = /(파일 목록|변경\/생성|생성된 파일|수정된 파일|changed files|modified files)/i.test(
    text,
  )

  return hasFilePathLikeText && hasFileListSignal
}

/**
 * prompt 생성 : 각 step의 prompt는 고정 지시사항 + (이전 step 결과 및 컨텍스트)로 구성됩니다.
 * @param {Object} step    현재 실행 중인 step 객체
 * @param {number} index   현재 step의 인덱스
 * @param {Array} results 이전 step들의 실행 결과 배열
 * @param {Object} context 오케스트레이션 컨텍스트 객체, context.reviewSourceOutput (Step 1 결과 재수집본), context.targetAbs (대상 워크스페이스 절대경로) 포함
 * @returns {string} 생성된 prompt 문자열
 */
function buildPrompt(step, index, results, context = {}) {
  if (index === 0) {
    return step.prompt
  }

  if (index === 1) {
    const step1Result = results[0]
    const reviewSourceOutput = context.reviewSourceOutput || step1Result.output
    const targetAbs = context.targetAbs || ''
    return [
      step.prompt,
      '',
      '[오케스트레이션 전달 컨텍스트]',
      `반드시 target workspace(${targetAbs})의 실제 파일을 직접 조회하여 검수해 주세요.`,
      '아래 제공된 Step 1 결과는 참고 자료이며, 요약문일 수 있으므로 그대로 신뢰하지 마세요.',
      '실제 파일 기준으로 버그/구문/로직 이슈를 검수하고 근거 파일 경로를 반드시 제시해 주세요.',
      '',
      '--- [Step 1 결과 참고 자료] ---',
      reviewSourceOutput,
    ].join('\n')
  }

  if (index === 2) {
    const step1Result = results[0]
    const targetAbs = context.targetAbs || ''
    const latestStep2Result = [...results].reverse().find((item) => item.name.startsWith('step2_'))
    return [
      step.prompt,
      '',
      '[오케스트레이션 전달 컨텍스트]',
      `반드시 target workspace(${targetAbs})의 현재 실제 코드 상태를 직접 확인해 주세요.`,
      '실제 파일 근거 없이 추정으로 판단하지 말고, 파일 경로/핵심 근거를 포함해 주세요.',
      '',
      '--- [원래 기획 의도 (Step 1 지시사항)] ---',
      step1Result.prompt,
      '',
      '--- [최신 Step 2 검수 결과] ---',
      latestStep2Result?.output || '(없음)',
    ].join('\n')
  }

  return step.prompt
}

/**
 * 입력 모델명을 Gemini 호환 모델로 매핑합니다.
 * @param {string} rawModel - 원래 지정된 모델명
 * @returns {string} 매핑된 Gemini 모델명
 */
function mapToGeminiModel(rawModel) {
  if (!rawModel) {
    return 'gemini-3.5-flash'
  }
  
  const lower = rawModel.toLowerCase()
  if (
    lower.includes('sonnet') || 
    lower.includes('pro') || 
    lower.includes('gpt-5.4') || 
    lower.includes('codex')
  ) {
    return 'gemini-2.5-pro'
  }

  return 'gemini-3.5-flash'
}

/**
 * 주어진 step을 모델 후보군과 재시도 정책에 따라 실행합니다.
 * @param {Object} step - 실행할 step 객체
 * @param {string} prompt - prompt
 * @param {string} stepLogFile - step 실행 로그를 기록할 파일 경로
 * @param {Object} args - 명령 인수 객체 (재시도 정책 기본값 포함)
 * @param {string} targetAbs - 대상 워크스페이스 절대경로
 * @returns {Promise<Object>} 실행된 step 결과 객체
 */
async function runStepWithRetry(step, prompt, stepLogFile, args, targetAbs) {
  const modelCandidates = resolveModelCandidates(step)
  const retryPolicy = resolveRetryPolicy(step, args)

  await appendStepLog(stepLogFile, `step=${step.name}`)
  await appendStepLog(stepLogFile, `models=${modelCandidates.join(',')}`)
  await appendStepLog(
    stepLogFile,
    `retry.maxAttempts=${retryPolicy.maxAttempts} retry.backoffMs=${retryPolicy.backoffMs}`,
  )

  const capabilities = new CapabilitiesConfig({
    enableSubagents: true,
    enabledTools: [
      BuiltinTools.LIST_DIR,
      BuiltinTools.SEARCH_DIR,
      BuiltinTools.FIND_FILE,
      BuiltinTools.VIEW_FILE,
      BuiltinTools.CREATE_FILE,
      BuiltinTools.EDIT_FILE,
      BuiltinTools.RUN_COMMAND,
      BuiltinTools.ASK_QUESTION,
      BuiltinTools.START_SUBAGENT,
      BuiltinTools.GENERATE_IMAGE
    ]
  })

  const decideHook = enforce([allowAll()])
  
  const errors = []
  let succeededStepResult = null

  for (const model of modelCandidates) {
    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      console.log(`\n[RUN] ${step.name} model=${model} attempt=${attempt}/${retryPolicy.maxAttempts}`)
      await appendStepLog(stepLogFile, `[RUN] model=${model} attempt=${attempt}`)

      let tempAgent = null
      try {
        const tempConfig = new LocalAgentConfig({
          apiKey: process.env.GEMINI_API_KEY,
          workspaces: [targetAbs],
          capabilities: capabilities,
          hooks: [decideHook],
          model
        })

        tempAgent = new Agent(tempConfig)
        await tempAgent.start()

        const promptContents = [prompt]
        if (step.mcp && Array.isArray(step.mcp.attachments) && step.mcp.attachments.length > 0) {
          for (const attachment of step.mcp.attachments) {
            try {
              const img = Image.fromFile(attachment.path, attachment.displayName)
              promptContents.push(img)
            } catch (err) {
              await appendStepLog(stepLogFile, `[WARN] 이미지 로드 실패: ${attachment.path} - ${err?.message || String(err)}`)
            }
          }
        }

        // Antigravity SDK chat API 호출
        const response = await tempAgent.chat(promptContents)
        const output = await response.text()
        
        const rawUsage = response.usageMetadata || response.usage_metadata || {}
        const currentUsage = {
          promptTokenCount: rawUsage.promptTokenCount ?? rawUsage.prompt_token_count ?? 0,
          candidatesTokenCount: rawUsage.candidatesTokenCount ?? rawUsage.candidates_token_count ?? 0,
          totalTokenCount: rawUsage.totalTokenCount ?? rawUsage.total_token_count ?? 0,
        }

        if (globalAccumulatedUsage) {
          globalAccumulatedUsage.promptTokenCount += currentUsage.promptTokenCount
          globalAccumulatedUsage.candidatesTokenCount += currentUsage.candidatesTokenCount
          globalAccumulatedUsage.totalTokenCount += currentUsage.totalTokenCount
        }

        const stepResult = {
          name: step.name,
          model,
          prompt: step.prompt,
          sendPrompt: prompt,
          attachments: step.mcp?.attachments || [],
          output,
          attempts: {
            model,
            try: attempt,
            maxAttempts: retryPolicy.maxAttempts,
          },
          usage: currentUsage,
          accumulatedUsage: { ...globalAccumulatedUsage },
          completedAt: new Date().toISOString(),
        }

        succeededStepResult = stepResult
        await appendStepLog(stepLogFile, `[DONE] model=${model} outputLength=${output.length} tokens=${currentUsage.totalTokenCount} accumulatedTokens=${globalAccumulatedUsage.totalTokenCount}`)
        console.log(`[DONE] ${step.name} model=${model} output=${output.length} chars (tokens: ${currentUsage.totalTokenCount}, accumulated: ${globalAccumulatedUsage.totalTokenCount})`)
        break
      } catch (error) {
        const message = error?.message || String(error)
        errors.push({ model, attempt, message })
        await appendStepLog(stepLogFile, `[FAIL] model=${model} attempt=${attempt} message=${message}`)

        if (attempt < retryPolicy.maxAttempts) {
          const waitMs = retryPolicy.backoffMs * attempt
          await appendStepLog(stepLogFile, `[WAIT] ${waitMs}ms before retry`)
          await sleep(waitMs)
        }
      } finally {
        if (tempAgent) {
          await tempAgent.stop()
        }
      }
    }

    if (succeededStepResult) {
      break
    }

    await appendStepLog(stepLogFile, `[MODEL_FALLBACK] next model`)
  }

  if (!succeededStepResult) {
    const compactError = errors
      .map((item) => `model=${item.model} attempt=${item.attempt} message=${item.message}`)
      .join(' | ')
    throw new Error(`step 실패: ${step.name} - ${compactError}`)
  }

  return succeededStepResult
}

async function main() {
  const args = getParsedArgs() // 명령줄 인수 파싱

  // 도움말 표시
  if (args.help) {
    console.log(
      `Usage: node src/orchestrate.js [--target <workspacePath> | --target-name <name>] [--steps <jsonPath>] [--output-dir <dirPath>] [--log-dir <dirPath>] [--timeout-ms <number>] [--max-attempts <number>] [--backoff-ms <number>]\nDefaults: steps=${DEFAULT_STEPS_PATH}, output-dir=${DEFAULT_OUTPUT_DIR}, logDir=${DEFAULT_LOG_DIR}, timeoutMs=${DEFAULT_TIMEOUT_MS}, maxAttempts=${DEFAULT_MAX_ATTEMPTS}, backoffMs=${DEFAULT_BACKOFF_MS}`,
    )
    process.exit(0)
  }

  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(path.resolve('.env')) // .env 파일 로드
    }
  } catch {
    // ignore missing .env
  }
  const mergedEnv = process.env
  const targetFromName = resolveTargetFromEnv(mergedEnv, args.targetName) // --target-name (TARGET_{NAME})을 통한 대상 경로 
  /**
   * 작업 대상 경로
   * 우선순위: --target > --target-name > TARGET_DEFAULT 환경 변수 > 현재 작업 디렉토리
   */
  const target = args.target || targetFromName || mergedEnv.TARGET_DEFAULT || process.cwd() 
  const targetAbs = path.resolve(target) // 대상 절대 경로
  const stepsPath = path.resolve(args.steps || DEFAULT_STEPS_PATH) // 작업 정의 파일 경로
  const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT_DIR) // 출력 파일이 위치할 디렉토리 경로
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const logRootDir = path.resolve(args.logDir || DEFAULT_LOG_DIR, runId)

  const steps = await loadSteps(stepsPath)
  if (steps.length !== 3) {
    throw new Error('워크플로우는 반드시 정확히 3개의 단계로 구성되어야 합니다.')
  }

  await fs.mkdir(logRootDir, { recursive: true })

  console.log(`[CONFIG] target=${targetAbs}`)
  if (args.targetName) {
    console.log(`[CONFIG] targetName=${args.targetName}`)
  }
  const targetKeys = listTargetKeys(mergedEnv)
  if (targetKeys.length > 0) {
    console.log(`[CONFIG] availableTargets=${targetKeys.join(', ')}`)
  }

  const results = []
  const timestamp = Date.now()
  
  // step 1 작업요청
  const step1 = steps[0]
  const step1LogFile = path.join(logRootDir, `01-${sanitizeFileName(step1.name)}-${timestamp}.log`)
  const step1Prompt = buildPrompt(step1, 0, results)
  const step1Result = await runStepWithRetry(step1, step1Prompt, step1LogFile, args, targetAbs)
  results.push(step1Result)

  let reviewSourceOutput = step1Result.output
  // step 1 결과에 파일정보가 없을 경우
  if (!hasCodeLikeContent(step1Result.output)) {
    console.log('\n[PREPARE] Step 1 결과가 요약문으로 판단되어 코드 본문 재수집을 진행합니다.')

    const materializeLogFile = path.join(
      logRootDir,
      `01-${sanitizeFileName(step1.name)}-materialize-${timestamp}.log`,
    )
    const materializePrompt = [
      '직전 작업 결과가 요약문 중심으로 반환되어 코드 검수가 불가능합니다.',
      `target workspace(${targetAbs})의 실제 변경 파일을 다시 조회한 뒤, 응답 본문에 아래 항목을 반드시 모두 포함해 주세요.`,
      '',
      '[필수 포함 항목]',
      '1) **변경/생성한 파일 목록** (경로 포함)',
      '',
      '[주의]',
      '- 요약문만 출력하지 마세요.',
      '- 항목 외 추가 설명은 가능하지만, 파일 목록 누락은 실패로 간주됩니다.'
    ].join('\n')

    const materializeStep = {
      name: `${step1.name}_materialize_code`,
      model: step1.model,
      models: step1.models,
      fallbackModels: step1.fallbackModels,
      prompt: materializePrompt,
      retry: step1.retry,
    }
          
    const materializeResult = await runStepWithRetry(
      materializeStep,
      materializePrompt,
      materializeLogFile,
      args,
      targetAbs
    )
    results.push(materializeResult)
    reviewSourceOutput = materializeResult.output
  }

  // step 2 코드 검수
  const step2 = steps[1]
  const step2LogFile = path.join(logRootDir, `02-${sanitizeFileName(step2.name)}-${timestamp}.log`)
  
  const step2Prompt = buildPrompt(step2, 1, results, { reviewSourceOutput, targetAbs })
  const step2Result = await runStepWithRetry(step2, step2Prompt, step2LogFile, args, targetAbs)
  results.push(step2Result)

  // Step 2 검수 중 오류 감지 및 자동 수정 진행
  if (step2Result.output.includes('[오류 발견]')) {
    console.log('\n[CORRECTION] Step 2 검수 중 오류가 감지되어 코드 자동 수정을 진행합니다.')

    const correctionLogFile = path.join(logRootDir, `02-${sanitizeFileName(step2.name)}-correction-${timestamp}.log`)
    const correctionPrompt = [
      `Step 2 코드 검수에서 아래와 같은 오류가 지적되었습니다. 제시된 수정 가이드라인 및 버그 내용을 분석하고`,
      `target workspace(${targetAbs})에서 **수정대상 파일 목록**을 직접 조회하여 수정 작업을 수행해 주세요.`,
      `응답 본문에 Step 2 결과물에 있는 **최종 파일 목록**과 **수정된 파일 목록**을 병합하여 **최종 파일 목록** (경로 포함)을 추가해 주세요`,
      '',
      '--- [Step2 결과물 (검수 지적 사항)] ---',
      step2Result.output,
    ].join('\n')

    const correctionStep = {
      name: `${step2.name}_correction`,
      model: step2.model,
      models: step2.models,
      fallbackModels: step2.fallbackModels,
      prompt: correctionPrompt,
      retry: step2.retry
    }
          
    const correctionResult = await runStepWithRetry(correctionStep, correctionPrompt, correctionLogFile, args, targetAbs)
    results.push(correctionResult)
  } else {
    console.log('\n[CORRECTION] Step 2 검수 결과 오류가 발견되지 않았습니다. (자동 수정 건너뜀)')
  }

  // step 3 기획 의도 재검토 및 최종 판단
  const step3 = steps[2]
  const step3LogFile = path.join(logRootDir, `03-${sanitizeFileName(step3.name)}-${timestamp}.log`)
  
  const step3Prompt = buildPrompt(step3, 2, results, { targetAbs })    
  const step3Result = await runStepWithRetry(step3, step3Prompt, step3LogFile, args, targetAbs)
  results.push(step3Result)
  // 결과 저장
  if (outputDir) {
    const ranAt = new Date().toISOString()
    await fs.mkdir(outputDir, { recursive: true })

    const markdownHistoryOutputPath = path.join(outputDir, `report-${runId}.md`)
    const markdownReport = buildFinalMarkdownReport({
      targetAbs,
      ranAt,
      logDir: logRootDir,
      results,
    })
    await fs.writeFile(markdownHistoryOutputPath, markdownReport, 'utf8')

    console.log(`[WRITE] ${markdownHistoryOutputPath}`)
  }

  console.log('\n[COMPLETE] orchestration finished')
}

main().catch((error) => {
  console.error('[ERROR]', error?.stack || error)
  process.exit(1)
})
