/**
 * OpenRouter 호출 공통 로직 (/api/analyze-job, /api/compare-jobs 공용, 서버 전용)
 *
 * 모델: 무료 모델만 기본으로 사용 (유료 크레딧이 없어도 동작)
 * - OpenRouter `models` fallback 배열로 한 번에 요청 → 첫 모델이 rate limit·장애면 OpenRouter가 다음 모델로 넘김
 * - 마지막 순서는 `openrouter/free` (지금 쓸 수 있는 무료 모델로 자동 라우팅)
 * - OPENROUTER_MODELS 환경변수(쉼표 구분)로 목록을 바꿀 수 있다 (코드 수정 없이 모델 교체)
 *
 * 요청 횟수: 최대 2번 (첫 요청 + 조건에 맞을 때만 1번 재시도). 무한 재시도 없음
 * - 재시도함: timeout·네트워크 오류·408/5xx·생성 중 오류, 짧은 Retry-After(≤4초)가 붙은 429/503,
 *            upstream 프로바이더의 429, 응답이 비었거나 JSON·형식이 맞지 않음(다른 모델 순서로),
 *            400(파라미터 미지원 가능성 → JSON 모드 없이 한 번)
 * - 재시도 안 함: 401(API 키), 402(크레딧 — 대기형 in-flight budget 제외), 403(예산·검열),
 *               계정 단위 429(Retry-After가 길거나 없음)
 *
 * 로그: route·attempt·실제 응답 모델·결과·소요시간·status·error.code·error_type·limit_source·
 *       provider·Retry-After·응답 길이만. API 키·공고 원문·사용자 입력·AI 응답 전문은 남기지 않는다.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// 2026-11 OpenRouter 모델 목록(/api/v1/models)에서 확인한 무료 모델 (모두 response_format 지원)
export const DEFAULT_FREE_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "openrouter/free", // 무료 모델 라우터: 위 모델이 모두 막혔을 때 지금 가능한 무료 모델로
];
const MAX_MODELS = 3; // models 배열은 짧게 (요청당 fallback 단계 수 제한)
const MAX_ATTEMPTS = 2;
const MAX_RETRY_WAIT_MS = 4000; // 이보다 긴 Retry-After는 기다리지 않고 바로 실패 처리
const DEFAULT_RETRY_WAIT_MS = 800; // 일시 오류 뒤 짧은 간격
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

// strict json_schema 대신 단순 JSON 모드만 요청 (무료 모델 호환). 정확한 구조는 prompt + 서버 검증
const RESPONSE_FORMAT = { type: "json_object" };

/** 사용할 모델 목록: OPENROUTER_MODELS 환경변수(쉼표 구분, 형식이 맞는 것만) → 없으면 무료 기본 목록 */
export function getModelList(envValue = process.env.OPENROUTER_MODELS) {
  if (typeof envValue === "string" && envValue.trim()) {
    const list = [];
    for (const raw of envValue.split(",")) {
      const id = raw.trim();
      if (MODEL_ID_RE.test(id) && !list.includes(id)) list.push(id);
    }
    if (list.length) return list.slice(0, MAX_MODELS);
  }
  return [...DEFAULT_FREE_MODELS];
}

/** Retry-After: 초 숫자 또는 HTTP 날짜 → ms (없거나 이상하면 null) */
export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

const pickStr = (v, max = 80) => (typeof v === "string" && v ? v.slice(0, max) : null);

/**
 * OpenRouter 오류 → 안전하게 꺼낸 정보 (키·사용자 입력 없음)
 * 오류 형식: { error: { code, message, metadata? } } (HTTP status와 error.code가 같음, 생성 중 오류는 200에도 올 수 있음)
 */
export function parseOpenRouterError({ status, body, headers }) {
  const error = body && typeof body === "object" ? body.error : null;
  const metadata = error && typeof error.metadata === "object" && error.metadata ? error.metadata : {};
  const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : null);
  const code = Number.isFinite(Number(error?.code)) ? Number(error.code) : null;
  return {
    status: Number.isFinite(status) ? status : null,
    code,
    message: pickStr(error?.message, 160),
    limitSource: pickStr(metadata.limit_source),
    errorType: pickStr(metadata.error_type),
    providerName: pickStr(metadata.provider_name),
    retryAfterMs: parseRetryAfter(get("retry-after")),
    rateLimitRemaining: pickStr(get("x-ratelimit-remaining"), 20),
    rateLimitReset: pickStr(get("x-ratelimit-reset"), 30),
  };
}

/**
 * 실패 1건 → 다음 행동
 * @returns {{ retry: boolean, waitMs: number, reason: "auth"|"unavailable"|"rate_limit"|"timeout"|"failed", jsonMode?: boolean }}
 */
export function classifyFailure(f) {
  // 생성 중 오류는 HTTP 200에 error.code로 오므로, 그때는 error.code 기준
  const status = f.status && f.status !== 200 ? f.status : f.code ?? f.status ?? null;
  const shortWait = f.retryAfterMs !== null && f.retryAfterMs !== undefined && f.retryAfterMs <= MAX_RETRY_WAIT_MS;

  if (f.timeout) return { retry: true, waitMs: 0, reason: "timeout" };
  if (f.network) return { retry: true, waitMs: DEFAULT_RETRY_WAIT_MS, reason: "failed" };
  if (status === 401) return { retry: false, waitMs: 0, reason: "auth" };
  if (status === 402) {
    // 크레딧 부족은 기다려도 해결되지 않음. 동시 요청 예산(in-flight)만 짧게 기다렸다 1번
    if (f.limitSource === "openrouter_in_flight_budget" && shortWait) {
      return { retry: true, waitMs: f.retryAfterMs, reason: "unavailable" };
    }
    return { retry: false, waitMs: 0, reason: "unavailable" };
  }
  if (status === 403) return { retry: false, waitMs: 0, reason: "unavailable" };
  if (status === 429) {
    if (shortWait) return { retry: true, waitMs: f.retryAfterMs, reason: "rate_limit" };
    // upstream 프로바이더의 rate limit → 다른 모델 순서로 1번 (계정 단위 제한은 재시도해도 같음)
    if (f.providerName && f.retryAfterMs === null) return { retry: true, waitMs: 0, reason: "rate_limit" };
    return { retry: false, waitMs: 0, reason: "rate_limit" };
  }
  if (status === 503 || status === 502 || status === 500 || status === 408) {
    if (f.retryAfterMs !== null && f.retryAfterMs !== undefined && !shortWait) {
      return { retry: false, waitMs: 0, reason: "failed" };
    }
    return { retry: true, waitMs: shortWait ? f.retryAfterMs : DEFAULT_RETRY_WAIT_MS, reason: "failed" };
  }
  // 400: 일부 무료 모델이 response_format을 지원하지 않는 경우 → JSON 모드 없이 1번
  if (status === 400) return { retry: true, waitMs: 0, reason: "failed", jsonMode: false };
  return { retry: false, waitMs: 0, reason: "failed" };
}

function logAttempt(tag, info) {
  const fields = Object.entries(info)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`)
    .join(" | ");
  console.warn(`[${tag}] ${fields}`);
}

const rotate = (list, usedModel) => {
  // 이미 응답한(형식이 틀린) 모델은 뒤로 → 다른 모델이 먼저 시도되게
  if (!usedModel || !list.includes(usedModel)) return [...list.slice(1), list[0]];
  return [...list.filter((m) => m !== usedModel), usedModel];
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** OpenRouter 1회 호출 */
async function attemptOnce({ apiKey, models, messages, timeoutMs, jsonMode, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Career Radar",
        },
        body: JSON.stringify({
          // model을 비우면 계정 기본 모델이 쓰일 수 있어 첫 모델을 명시하고, 나머지는 models fallback
          model: models[0],
          models,
          messages,
          temperature: 0.2,
          ...(jsonMode ? { response_format: RESPONSE_FORMAT } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return { kind: "error", timeout: true, status: null };
      return { kind: "error", network: true, status: null, errName: pickStr(err?.name, 40) };
    }

    let body = null;
    let bodyRead = true;
    try {
      body = await res.json();
    } catch {
      if (controller.signal.aborted) return { kind: "error", timeout: true, status: res.status };
      bodyRead = false;
    }

    // HTTP 오류, 또는 200인데 생성 중 오류가 본문에 온 경우
    if (!res.ok || (body && body.error)) {
      return { kind: "error", ...parseOpenRouterError({ status: res.status, body, headers: res.headers }) };
    }
    const content = body?.choices?.[0]?.message?.content;
    return {
      kind: "content",
      status: res.status,
      content: typeof content === "string" ? content : "",
      routedModel: pickStr(body?.model, 120),
      bodyRead,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 구조화된 JSON 응답을 받을 때까지 최대 2번 요청한다.
 *
 * @param {object} opts
 * @param {(content: string) => ({ value: any } | { failure: "parse_failed" | "schema_failed" })} opts.accept
 *        content를 결과로 바꾸는 함수. 파싱·형식 검증 실패면 failure를 돌려준다.
 * @param {number[]} opts.timeoutsMs 요청별 timeout (첫 요청, 재시도). 부족하면 마지막 값 사용
 * @param {string[]} [opts.models] 기본: getModelList()
 * @param {typeof fetch} [opts.fetchImpl] 테스트용
 * @param {(ms: number) => Promise<void>} [opts.sleep] 테스트용
 * @returns {Promise<{ ok: true, value: any, model: string | null }
 *   | { ok: false, reason: "auth" | "unavailable" | "rate_limit" | "timeout" | "failed" }>}
 */
export async function requestStructured({
  apiKey,
  messages,
  accept,
  tag,
  timeoutsMs,
  models = getModelList(),
  fetchImpl = fetch,
  sleep = defaultSleep,
}) {
  let list = models.slice(0, MAX_MODELS);
  let jsonMode = true;
  let lastReason = "failed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    const timeoutMs = timeoutsMs[Math.min(attempt - 1, timeoutsMs.length - 1)];
    const r = await attemptOnce({ apiKey, models: list, messages, timeoutMs, jsonMode, fetchImpl });
    const base = { attempt: `${attempt}/${MAX_ATTEMPTS}`, models: list.length, ms: Date.now() - started };

    if (r.kind === "error") {
      const next = classifyFailure(r);
      logAttempt(tag, {
        ...base,
        outcome: r.timeout ? "timeout" : r.network ? `network:${r.errName ?? "error"}` : "http_error",
        status: r.status,
        code: r.code,
        error_type: r.errorType,
        limit_source: r.limitSource,
        provider: r.providerName,
        retry_after_ms: r.retryAfterMs,
        ratelimit_remaining: r.rateLimitRemaining,
        message: r.message,
        next: next.retry && attempt < MAX_ATTEMPTS ? "retry" : "stop",
      });
      lastReason = next.reason;
      if (!next.retry || attempt >= MAX_ATTEMPTS) return { ok: false, reason: lastReason };
      if (next.jsonMode === false) jsonMode = false;
      list = rotate(list, null);
      if (next.waitMs > 0) await sleep(next.waitMs);
      continue;
    }

    // 응답은 왔음 → 형식 확인
    const { content, routedModel } = r;
    lastReason = "failed";
    let accepted = null;
    if (content.trim()) {
      try {
        accepted = accept(content);
      } catch (err) {
        // 정리 코드에서 예외가 나도 요청 전체가 500으로 끝나지 않게 형식 실패로 처리
        console.error(`[${tag}] failed to normalize AI response`, pickStr(err?.message, 120) ?? "error");
        accepted = { failure: "schema_failed" };
      }
    }
    const outcome = !content.trim() ? "empty_content" : accepted && "value" in accepted ? "ok" : accepted?.failure ?? "schema_failed";
    logAttempt(tag, { ...base, outcome, status: r.status, model: routedModel, length: content.length });
    if (outcome === "ok") return { ok: true, value: accepted.value, model: routedModel };
    // 형식이 틀린 응답: 그 모델을 뒤로 보내고 1번 더
    list = rotate(list, routedModel);
  }
  return { ok: false, reason: lastReason };
}

/** 모델 출력에서 JSON 객체 하나를 꺼낸다 (코드블록·앞뒤 글자 허용). 실패하면 null */
export function parseModelJson(text) {
  if (typeof text !== "string") return null;
  const candidates = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // 다음 후보
    }
  }
  return null;
}
