import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FREE_MODELS,
  classifyFailure,
  getModelList,
  parseOpenRouterError,
  parseRetryAfter,
  requestStructured,
} from "./openrouter.js";
import { getCheckPoints, getComparePoints, getPostingHighlights } from "./jobInsights.js";

const API_KEY = "sk-or-test-SECRET-should-never-be-logged";
const MODELS = ["vendor/model-a:free", "vendor/model-b:free", "openrouter/free"];
const GOOD = JSON.stringify({ mainDifference: "차이" });

// ───── 테스트 도구: 가짜 fetch / 로그 수집 ─────

function okResponse(content, model = MODELS[0]) {
  return new Response(JSON.stringify({ model, choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status, { metadata, headers = {}, message = "err" } = {}) {
  return new Response(JSON.stringify({ error: { code: status, message, ...(metadata ? { metadata } : {}) } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** 호출 순서대로 응답을 돌려주는 fetch. 요청 본문을 기록 */
function fakeFetch(responders) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers, signal: init.signal });
    const r = responders[Math.min(calls.length - 1, responders.length - 1)];
    return typeof r === "function" ? r(init) : r;
  };
  return { impl, calls };
}

const accept = (content) => {
  try {
    const v = JSON.parse(content);
    return v.mainDifference ? { value: v } : { failure: "schema_failed" };
  } catch {
    return { failure: "parse_failed" };
  }
};

let logs = [];
const original = { warn: console.warn, error: console.error };
beforeEach(() => {
  logs = [];
  console.warn = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
});
afterEach(() => {
  console.warn = original.warn;
  console.error = original.error;
});

function run(responders, extra = {}) {
  const { impl, calls } = fakeFetch(responders);
  const sleeps = [];
  const promise = requestStructured({
    apiKey: API_KEY,
    messages: [{ role: "user", content: "공고 원문 비밀 내용" }],
    accept,
    tag: "test",
    timeoutsMs: [1000, 1000],
    models: MODELS,
    fetchImpl: impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return promise.then((outcome) => ({ outcome, calls, sleeps }));
}

const assertNoSecretsLogged = () => {
  const all = logs.join("\n");
  assert.equal(all.includes(API_KEY), false, "API key leaked to logs");
  assert.equal(all.includes("공고 원문 비밀 내용"), false, "user input leaked to logs");
};

// ───── 모델 목록 ─────

test("기본 모델 목록: 무료 모델만 (유료 primary 없음), openrouter/free 포함", () => {
  const list = getModelList(undefined);
  assert.deepEqual(list, DEFAULT_FREE_MODELS);
  assert.ok(list.every((m) => m.endsWith(":free") || m === "openrouter/free"));
  assert.ok(list.includes("openrouter/free"));
  assert.equal(list.includes("upstage/solar-mini4"), false);
});

test("OPENROUTER_MODELS 환경변수: 형식 맞는 id만, 최대 3개", () => {
  assert.deepEqual(getModelList(" a/b:free, bad id ,c/d , a/b:free, e/f, g/h "), ["a/b:free", "c/d", "e/f"]);
  assert.deepEqual(getModelList("   "), DEFAULT_FREE_MODELS);
  assert.deepEqual(getModelList("no-slash"), DEFAULT_FREE_MODELS);
});

// ───── 성공 ─────

test("AI 정상 성공: 요청 1번, models fallback 배열 + JSON 모드", async () => {
  const { outcome, calls } = await run([okResponse(GOOD)]);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.value, { mainDifference: "차이" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, MODELS[0]);
  assert.deepEqual(calls[0].body.models, MODELS);
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assertNoSecretsLogged();
});

test("첫 모델 실패 → OpenRouter가 다음 모델로 넘겨 성공 (응답 model로 확인)", async () => {
  const { outcome, calls } = await run([okResponse(GOOD, MODELS[1])]);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.model, MODELS[1]);
  assert.equal(calls.length, 1);
});

test("첫 모델이 형식 틀린 JSON → 그 모델을 뒤로 보내고 1번 더 → 성공", async () => {
  const { outcome, calls } = await run([okResponse("이건 JSON이 아님", MODELS[0]), okResponse(GOOD, MODELS[1])]);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.models, [MODELS[1], MODELS[2], MODELS[0]]);
  assertNoSecretsLogged();
});

// ───── 실패 ─────

test("모든 AI 모델 실패(502 연속): 최대 2번만 요청하고 실패", async () => {
  const { outcome, calls } = await run([errorResponse(502), errorResponse(502), errorResponse(502)]);
  assert.deepEqual(outcome, { ok: false, reason: "failed" });
  assert.equal(calls.length, 2);
  assertNoSecretsLogged();
});

test("잘못된 JSON 응답이 계속되면 2번 후 실패 (빈 응답 포함)", async () => {
  const { outcome, calls } = await run([okResponse("{not json"), okResponse("")]);
  assert.deepEqual(outcome, { ok: false, reason: "failed" });
  assert.equal(calls.length, 2);
});

test("429 (계정 단위, Retry-After 없음): 재시도하지 않음", async () => {
  const { outcome, calls, sleeps } = await run([errorResponse(429), okResponse(GOOD)]);
  assert.deepEqual(outcome, { ok: false, reason: "rate_limit" });
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("429 + 짧은 Retry-After: 그만큼 기다렸다 1번만 재시도", async () => {
  const { outcome, calls, sleeps } = await run([
    errorResponse(429, { headers: { "retry-after": "2" } }),
    okResponse(GOOD, MODELS[1]),
  ]);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("429 + 긴 Retry-After: 기다리지 않고 바로 실패", async () => {
  const { outcome, calls, sleeps } = await run([errorResponse(429, { headers: { "retry-after": "60" } })]);
  assert.deepEqual(outcome, { ok: false, reason: "rate_limit" });
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("429 upstream 프로바이더 제한: 다른 모델 순서로 1번, 계속 429면 끝 (무한 재시도 없음)", async () => {
  const upstream = () => errorResponse(429, { metadata: { provider_name: "SomeProvider" } });
  const { outcome, calls } = await run([upstream(), upstream(), upstream()]);
  assert.deepEqual(outcome, { ok: false, reason: "rate_limit" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.models[0], MODELS[1]);
});

test("402 크레딧 부족: 재시도하지 않고 unavailable", async () => {
  const { outcome, calls } = await run([errorResponse(402, { metadata: { limit_source: "account_credits" } })]);
  assert.deepEqual(outcome, { ok: false, reason: "unavailable" });
  assert.equal(calls.length, 1);
});

test("402 동시 요청 예산(in-flight) + 짧은 Retry-After: 1번만 재시도", async () => {
  const { outcome, calls, sleeps } = await run([
    errorResponse(402, { metadata: { limit_source: "openrouter_in_flight_budget" }, headers: { "retry-after": "1" } }),
    okResponse(GOOD),
  ]);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [1000]);
});

test("401: API 키 문제는 즉시 종료 (auth)", async () => {
  const { outcome, calls } = await run([errorResponse(401), okResponse(GOOD)]);
  assert.deepEqual(outcome, { ok: false, reason: "auth" });
  assert.equal(calls.length, 1);
  assertNoSecretsLogged();
});

test("400: JSON 모드 없이 1번 더 (response_format 미지원 모델 대비)", async () => {
  const { outcome, calls } = await run([errorResponse(400), okResponse(GOOD)]);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
  assert.equal("response_format" in calls[1].body, false);
});

test("200인데 본문에 error (생성 중 오류): 오류로 보고 1번 재시도", async () => {
  const midError = new Response(JSON.stringify({ error: { code: 502, message: "provider died" } }), { status: 200 });
  const { outcome, calls } = await run([midError, okResponse(GOOD)]);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
});

test("timeout: 요청마다 timeout, 최대 2번 후 timeout으로 실패", async () => {
  const hang = (init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const { outcome, calls } = await run([hang, hang], { timeoutsMs: [20, 20] });
  assert.deepEqual(outcome, { ok: false, reason: "timeout" });
  assert.equal(calls.length, 2);
});

test("네트워크 오류 → 1번 재시도 후 성공", async () => {
  const boom = () => Promise.reject(new TypeError("fetch failed"));
  const { outcome, calls } = await run([boom, okResponse(GOOD)]);
  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
});

// ───── 오류 정보 파싱 ─────

test("오류 정보: status·error.code·limit_source·error_type·provider·Retry-After", () => {
  const headers = new Headers({ "retry-after": "3", "x-ratelimit-remaining": "0" });
  const info = parseOpenRouterError({
    status: 429,
    body: {
      error: {
        code: 429,
        message: "Rate limit exceeded upstream",
        metadata: { limit_source: "provider", error_type: "rate_limit", provider_name: "Prov", raw: "x".repeat(5000) },
      },
    },
    headers,
  });
  assert.equal(info.status, 429);
  assert.equal(info.code, 429);
  assert.equal(info.limitSource, "provider");
  assert.equal(info.errorType, "rate_limit");
  assert.equal(info.providerName, "Prov");
  assert.equal(info.retryAfterMs, 3000);
  assert.equal(info.rateLimitRemaining, "0");
  assert.equal("raw" in info, false); // 프로바이더 원문 payload는 꺼내지 않음
  assert.ok(info.message.length <= 160);
});

test("오류 정보: 본문이 비었거나 이상해도 안전", () => {
  const info = parseOpenRouterError({ status: 503, body: null, headers: null });
  assert.equal(info.status, 503);
  assert.equal(info.code, null);
  assert.equal(info.retryAfterMs, null);
});

test("Retry-After: 초·HTTP 날짜·이상한 값", () => {
  assert.equal(parseRetryAfter("1.5"), 1500);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(parseRetryAfter("soon"), null);
  assert.equal(parseRetryAfter(undefined), null);
});

test("재시도 판단 표: 재시도는 조건부 1번, 결제·권한 문제는 재시도 안 함", () => {
  assert.equal(classifyFailure({ status: 401 }).retry, false);
  assert.equal(classifyFailure({ status: 402 }).retry, false);
  assert.equal(classifyFailure({ status: 403, limitSource: "budget" }).reason, "unavailable");
  assert.equal(classifyFailure({ status: 429, retryAfterMs: null }).retry, false);
  assert.equal(classifyFailure({ status: 503, retryAfterMs: 120000 }).retry, false);
  assert.equal(classifyFailure({ status: 503, retryAfterMs: null }).retry, true);
  assert.equal(classifyFailure({ timeout: true }).reason, "timeout");
});

// ───── AI가 전부 실패해도 사실 기반 비교는 그대로 ─────

const JOBS = [
  {
    id: "a",
    company: "회사A",
    title: "CRM 마케터",
    employmentType: "인턴",
    career: "신입",
    location: "서울",
    keywords: ["CRM", "SQL"],
    tasks: ["캠페인 운영"],
    required: ["포트폴리오 제출"],
    preferred: ["GA4 사용 경험"],
  },
  {
    id: "b",
    company: "회사B",
    title: "퍼포먼스 마케터",
    employmentType: "정규직",
    career: "경력",
    location: "부산",
    keywords: ["광고", "SQL"],
    tasks: ["광고 집행"],
    required: ["학사 이상"],
    preferred: [],
  },
];

test("모든 AI 모델 실패 후에도 사실 기반 비교 데이터는 정상 (AI와 무관)", async () => {
  const { outcome } = await run([errorResponse(503), errorResponse(503)]);
  assert.equal(outcome.ok, false);
  // 30초 비교·지원 전 먼저 확인·이 공고만의 포인트에 쓰이는 규칙 기반 데이터
  assert.ok(getComparePoints(JOBS).length > 0);
  const highlights = getPostingHighlights(JOBS);
  assert.equal(highlights.length, 2);
  assert.ok(highlights[0].points.length > 0);
  assert.ok(getCheckPoints(JOBS[0]).length > 0);
});

test("비교 화면 구조: AI 요청은 'Career Radar 비교 요약'(CompareSummary) 안에서만", () => {
  const src = readFileSync(new URL("../app/JobCompare.js", import.meta.url), "utf8");
  const calls = [...src.matchAll(/fetch\("\/api\/compare-jobs"/g)];
  assert.equal(calls.length, 1);
  const start = src.indexOf("function CompareSummary(");
  const end = src.indexOf("\nfunction ", start + 1);
  assert.ok(start > 0 && calls[0].index > start && (end === -1 || calls[0].index < end));
  // 실패 안내: 원인(402·429·OpenRouter)을 보여 주지 않고 짧은 안내
  assert.match(src, /AI 요약을 잠시 불러오지 못했어요\./);
  assert.match(src, /공고 비교 내용은 정상적으로 확인할 수 있어요\./);
  // 서버 오류 문구(error)를 화면에 그대로 그리지 않음 (network 여부 판단에만 사용)
  assert.doesNotMatch(src, /\{error\}/);
  assert.doesNotMatch(src, /\{data\.error\}/);
});
