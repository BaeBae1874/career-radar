/**
 * OpenRouter 호출 공통 로직 (/api/analyze-job, /api/compare-jobs 공용, 서버 전용)
 *
 * - attempt마다 AbortController timeout (응답 본문 읽기까지 포함)
 * - 재시도: 빈 content, JSON 파싱 실패, schema 실패, timeout, 네트워크 오류, 일시적 HTTP 오류
 * - 재시도 안 함: 401/403(인증), 429(요청 과다)
 * - 로그: attempt·소요시간·HTTP status·timeout·empty·length·실패 유형만 (API 키·공고 원문·사용자 입력은 남기지 않음)
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/free";
const LOG_PREVIEW_LENGTH = 300;

export const RETRYABLE_HTTP = new Set([408, 500, 502, 503, 504, 520, 522, 524, 529]);

/** JSON 파싱 실패 진단용: AI 응답 앞부분만 (공고 원문 전체는 남기지 않음) */
function logPreview(tag, attempt, content) {
  console.error(
    `[${tag}] raw AI response preview (attempt ${attempt}, ${content.length} chars):`,
    JSON.stringify(content.slice(0, LOG_PREVIEW_LENGTH))
  );
}

function logAttempt(tag, maxAttempts, { attempt, ms, status = null, timeout = false, content = null, outcome }) {
  const len = typeof content === "string" ? content.length : null;
  console.warn(
    `[${tag}] attempt ${attempt}/${maxAttempts}: ${outcome}` +
      ` | ${ms}ms | status=${status ?? "-"} | timeout=${timeout}` +
      ` | empty=${len === null ? "-" : len === 0} | length=${len ?? "-"}`
  );
}

/**
 * OpenRouter 1회 호출.
 * @returns {Promise<{ kind: "content", content: string, status: number }
 *   | { kind: "error", outcome: string, status: number|null, timeout: boolean, retryable: boolean }>}
 */
async function attemptOnce({ apiKey, messages, responseFormat, timeoutMs, tag }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = () => ({ kind: "error", outcome: "timeout", status: null, timeout: true, retryable: true });
  try {
    let res;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Career Radar",
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.2,
          response_format: responseFormat,
          // response_format을 지원하는 무료 모델/프로바이더로만 라우팅
          provider: { require_parameters: true },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return timedOut();
      return {
        kind: "error",
        outcome: `network:${err?.name ?? "error"}`,
        status: null,
        timeout: false,
        retryable: true,
      };
    }

    if (!res.ok) {
      // 프로바이더 오류 메시지 앞부분만 (키·공고 내용은 들어 있지 않음)
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[${tag}] OpenRouter HTTP ${res.status}`, JSON.stringify(detail));
      return {
        kind: "error",
        outcome: `http_${res.status}`,
        status: res.status,
        timeout: false,
        retryable: RETRYABLE_HTTP.has(res.status),
      };
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      if (controller.signal.aborted) return timedOut();
      // 본문이 JSON이 아님 → 빈 content로 보고 재시도
    }
    const content = data?.choices?.[0]?.message?.content;
    return { kind: "content", content: typeof content === "string" ? content : "", status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 구조화된 JSON 응답을 받을 때까지 최대 maxAttempts회 시도한다.
 *
 * @param {object} opts
 * @param {(content: string) => ({ value: any } | { failure: "parse_failed" | "schema_failed" })} opts.accept
 *        content를 결과로 바꾸는 함수. 파싱·형식 검증 실패면 failure를 돌려준다.
 * @returns {Promise<{ ok: true, value: any }
 *   | { ok: false, reason: "auth" | "rate_limit" | "timeout" | "failed" }>}
 */
export async function requestStructured({
  apiKey,
  messages,
  responseFormat,
  accept,
  tag,
  timeoutMs,
  maxAttempts = 2,
}) {
  let lastTimeout = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    const r = await attemptOnce({ apiKey, messages, responseFormat, timeoutMs, tag });
    const ms = Date.now() - started;

    if (r.kind === "error") {
      logAttempt(tag, maxAttempts, { attempt, ms, status: r.status, timeout: r.timeout, outcome: r.outcome });
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "auth" };
      if (r.status === 429) return { ok: false, reason: "rate_limit" };
      if (!r.retryable) return { ok: false, reason: "failed" };
      lastTimeout = r.timeout;
      continue;
    }

    const { content, status } = r;
    lastTimeout = false;
    if (!content.trim()) {
      logAttempt(tag, maxAttempts, { attempt, ms, status, content, outcome: "empty_content" });
      continue;
    }
    let accepted;
    try {
      accepted = accept(content);
    } catch (err) {
      // 정리 코드에서 예외가 나도 요청 전체가 500으로 끝나지 않게 형식 실패로 처리
      console.error(`[${tag}] failed to normalize AI response`, err?.message ?? err);
      accepted = { failure: "schema_failed" };
    }
    if (accepted && "value" in accepted) {
      logAttempt(tag, maxAttempts, { attempt, ms, status, content, outcome: "ok" });
      return { ok: true, value: accepted.value };
    }
    logAttempt(tag, maxAttempts, { attempt, ms, status, content, outcome: accepted?.failure ?? "schema_failed" });
    logPreview(tag, attempt, content);
  }
  return { ok: false, reason: lastTimeout ? "timeout" : "failed" };
}
