/**
 * OpenRouter 호출 공통 로직 (/api/analyze-job, /api/compare-jobs 공용, 서버 전용)
 *
 * - 모델 fallback: OPENROUTER_MODELS 순서대로 모델당 1회씩만 시도 (같은 모델 재시도 없음, 총 최대 2회)
 *   메인은 저가 유료 모델, 실패하면 무료 모델 1회
 * - timeout은 모델별로 다르게 줄 수 있음 (route가 timeoutsMs 배열로 전달, 모델 순서와 같은 위치)
 * - 다음 모델로 넘어가는 실패: 429, timeout, 네트워크 오류, 일시적 HTTP 오류(408/5xx), 빈 content,
 *   JSON 파싱 실패, schema 실패 (그 밖의 HTTP 오류도 다른 모델에서는 될 수 있으므로 넘어감)
 * - 즉시 종료: 401/403 (API 키·권한 문제라 다른 모델로도 해결되지 않음)
 * - attempt마다 AbortController timeout (응답 본문 읽기까지 포함)
 * - 로그: route·모델·attempt·결과·소요시간·HTTP status·timeout·empty·length만 (API 키·공고 원문·사용자 입력은 남기지 않음)
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// 이 순서대로 시도한다 (랜덤 openrouter/free 사용 안 함). 두 route 모두 이 목록만 사용
export const OPENROUTER_MODELS = [
  "upstage/solar-mini4", // 메인: 저가 유료 (입력 $0.05 / 출력 $0.20 per 1M tokens)
  "google/gemma-4-26b-a4b-it:free", // fallback: 무료
];
// strict json_schema 대신 단순 JSON 모드만 요청한다. (무료 모델 호환 + 서버 검증 구조 유지)
// 정확한 구조는 prompt로 지시하고, 각 route가 서버에서 파싱·형식 검증·재시도한다.
const RESPONSE_FORMAT = { type: "json_object" };
const LOG_PREVIEW_LENGTH = 300;

/** JSON 파싱 실패 진단용: AI 응답 앞부분만 (공고 원문 전체는 남기지 않음) */
function logPreview(tag, model, attempt, content) {
  console.error(
    `[${tag}] model=${model} | attempt ${attempt} | raw AI response preview (${content.length} chars):`,
    JSON.stringify(content.slice(0, LOG_PREVIEW_LENGTH))
  );
}

function logAttempt(tag, { model, attempt, total, ms, status = null, timeout = false, content = null, outcome }) {
  const len = typeof content === "string" ? content.length : null;
  console.warn(
    `[${tag}] model=${model} | attempt ${attempt}/${total} | ${outcome} | ${ms}ms` +
      ` | status=${status ?? "-"} | timeout=${timeout}` +
      ` | empty=${len === null ? "-" : len === 0} | length=${len ?? "-"}`
  );
}

/**
 * OpenRouter 1회 호출.
 * @returns {Promise<{ kind: "content", content: string, status: number }
 *   | { kind: "error", outcome: string, status: number|null, timeout: boolean }>}
 */
async function attemptOnce({ apiKey, model, messages, timeoutMs, tag }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = () => ({ kind: "error", outcome: "timeout", status: null, timeout: true });
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
          model,
          messages,
          temperature: 0.2,
          // require_parameters는 쓰지 않는다: json_object를 지원하지 않는 프로바이더라도
          // 요청이 404로 막히지 않고 일반 텍스트로 응답 → 서버 검증에서 걸러 재시도
          response_format: RESPONSE_FORMAT,
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
      };
    }

    if (!res.ok) {
      // 프로바이더 오류 메시지 앞부분만 (키·공고 내용은 들어 있지 않음)
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[${tag}] model=${model} | OpenRouter HTTP ${res.status}`, JSON.stringify(detail));
      return {
        kind: "error",
        outcome: `http_${res.status}`,
        status: res.status,
        timeout: false,
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
 * 구조화된 JSON 응답을 받을 때까지 OPENROUTER_MODELS를 순서대로 모델당 1회씩 시도한다.
 * 첫 모델이 성공하면 다음 모델은 호출하지 않는다.
 *
 * @param {object} opts
 * @param {(content: string) => ({ value: any } | { failure: "parse_failed" | "schema_failed" })} opts.accept
 *        content를 결과로 바꾸는 함수. 파싱·형식 검증 실패면 failure를 돌려준다.
 * @param {number[]} opts.timeoutsMs 모델별 timeout (OPENROUTER_MODELS와 같은 순서, 부족하면 마지막 값 사용)
 * @param {string[]} [opts.models] 테스트용으로만 바꿔 쓴다 (기본: OPENROUTER_MODELS)
 * @returns {Promise<{ ok: true, value: any, model: string }
 *   | { ok: false, reason: "auth" | "rate_limit" | "timeout" | "failed" }>}
 *   reason은 마지막 모델의 실패 원인 기준 (기존 route의 error mapping 그대로 사용)
 */
export async function requestStructured({
  apiKey,
  messages,
  accept,
  tag,
  timeoutsMs,
  models = OPENROUTER_MODELS,
}) {
  const total = models.length;
  let lastReason = "failed";

  for (let i = 0; i < total; i++) {
    const model = models[i];
    const attempt = i + 1;
    const started = Date.now();
    const timeoutMs = timeoutsMs[Math.min(i, timeoutsMs.length - 1)];
    const r = await attemptOnce({ apiKey, model, messages, timeoutMs, tag });
    const ms = Date.now() - started;
    const log = (extra) => logAttempt(tag, { model, attempt, total, ms, ...extra });

    if (r.kind === "error") {
      log({ status: r.status, timeout: r.timeout, outcome: r.outcome });
      // API 키·권한 문제: 다른 모델로 넘겨도 해결되지 않으므로 즉시 종료
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "auth" };
      lastReason = r.status === 429 ? "rate_limit" : r.timeout ? "timeout" : "failed";
      continue; // 429·timeout·5xx·네트워크 등 → 다음 모델
    }

    const { content, status } = r;
    lastReason = "failed";
    if (!content.trim()) {
      log({ status, content, outcome: "empty_content" });
      continue;
    }
    let accepted;
    try {
      accepted = accept(content);
    } catch (err) {
      // 정리 코드에서 예외가 나도 요청 전체가 500으로 끝나지 않게 형식 실패로 처리
      console.error(`[${tag}] model=${model} | failed to normalize AI response`, err?.message ?? err);
      accepted = { failure: "schema_failed" };
    }
    if (accepted && "value" in accepted) {
      log({ status, content, outcome: "ok" });
      return { ok: true, value: accepted.value, model };
    }
    log({ status, content, outcome: accepted?.failure ?? "schema_failed" });
    logPreview(tag, model, attempt, content);
  }
  return { ok: false, reason: lastReason };
}
