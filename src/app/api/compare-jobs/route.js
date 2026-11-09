// 선택한 채용공고 2~3개의 핵심 차이를 AI로 요약하는 비교 전용 API.
// OpenRouter 호출 방식(모델, response_format, 재시도, 로그)은 /api/analyze-job과 동일하게 맞췄다.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/free";
const REQUEST_TIMEOUT_MS = 60000;
const LOG_PREVIEW_LENGTH = 300;

const MIN_JOBS = 2;
const MAX_JOBS = 3;
const MAX_TEXT = 200; // 문자열 필드 하나당 최대 길이
const MAX_ITEMS = 15; // 배열 필드 하나당 최대 개수

const stringArray = { type: "array", items: { type: "string" } };

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "job_comparison",
    strict: true,
    schema: {
      type: "object",
      properties: {
        mainDifference: { type: "string" },
        commonPoints: stringArray,
        bestFor: {
          type: "array",
          items: {
            type: "object",
            properties: {
              jobTitle: { type: "string" },
              summary: { type: "string" },
            },
            required: ["jobTitle", "summary"],
            additionalProperties: false,
          },
        },
        watchPoints: stringArray,
      },
      required: ["mainDifference", "commonPoints", "bestFor", "watchPoints"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `당신은 취업 준비생이 여러 채용공고의 차이를 빠르게 이해하도록 돕는 도우미입니다.
사용자가 고른 채용공고 2~3개의 정리된 정보를 받아, 실제 업무와 지원 조건의 차이를 짧게 요약합니다.

반드시 지킬 규칙:
1. 전달받은 공고 데이터만 근거로 비교합니다. 데이터에 없는 업무, 조건, 기술을 지어내지 않습니다.
2. 회사에 대한 외부 정보(규모, 평판, 문화, 성장성 등)를 추정하지 않습니다.
3. 연봉, 복지, 근무시간 등 전달되지 않은 정보는 언급하지 않습니다.
4. 합격 가능성이나 경쟁률을 예측하지 않습니다.
5. 특정 사람이 반드시 적합하다고 단정하지 않습니다. "~한 분께 더 잘 맞을 수 있어요"처럼 가능성으로 표현합니다.
6. 공고들의 실제 업무(주요업무)와 조건(필수조건, 우대조건, 근무형태, 경력) 차이에 집중합니다.
7. 모든 문장은 한국어 "~해요" 체로, 초보 취준생도 이해할 수 있게 짧고 쉽게 씁니다.
   "~다"·"~니다"로 끝나는 문장, "적합하다", "유리하다", "좋은 기회", "추천" 같은 단정·평가 표현은 쓰지 않습니다.

필수 / 우대 / 관심 분야 구분:
8. 필수조건(required)에 있는 내용만 "필수 조건"이라고 부르고, 우대조건(preferred)에 있는 내용은 반드시 "우대 조건"이라고 부릅니다.
   - 우대조건에 있는 기술·경험(예: SQL, GA4)을 "필수", "요구", "필요한 역량"이라고 쓰지 않습니다.
   - 필수조건과 우대조건에 있는 내용을 한데 묶어 "필수 역량", "요구 역량"처럼 쓰지 않습니다.
   - 필수와 우대가 섞여 한 문장으로 정리하기 어려우면 "공고마다 요구하거나 우대하는 역량이 달라요."처럼 중립적으로 씁니다.
9. 주요업무(tasks)는 "하게 될 일"이지 지원 조건이 아닙니다. 업무 내용을 지원자가 갖춰야 할 경험처럼 쓰지 않습니다.
10. 필수조건·우대조건·주요업무 어디에도 없는 기술, 경험, 자격을 새로 만들지 않습니다.
11. 필수조건·우대조건을 언급할 때는 공고 표현을 바꾸지 말고 그대로 옮깁니다. (예: "SQL 기본 문법을 이해"를 "SQL 사용 경험"으로 바꾸지 않음)

필드별 작성 방법:
- mainDifference: 공고들의 가장 큰 차이를 2~3문장으로 씁니다.
- commonPoints: 공고들에 공통으로 보이는 점을 1~3개 씁니다. 없으면 빈 배열로 둡니다.
- bestFor: 공고마다 하나씩, 입력된 순서대로 씁니다.
  - jobTitle에는 입력된 공고의 title을 글자 그대로 복사합니다.
  - summary에는 주요업무를 바탕으로, 어떤 업무에 관심이 있거나 어떤 일을 좋아하는 분에게 더 가까울 수 있는지 한 문장으로 씁니다.
    예: "CRM, 고객 데이터, 메시지 기획 업무에 관심 있는 분에게 더 가까울 수 있어요."
  - "~경험이 있는 분", "~을 할 줄 아는 분"처럼 지원자가 이미 특정 경험·역량을 갖춰야 한다는 식으로 쓰지 않습니다.
  - 단, 공고의 필수조건에 특정 경험·역량이 명시되어 있으면 "필수 조건으로 ~을 요구해요"처럼 사실로 따로 덧붙일 수 있습니다.
  - 합격 가능성이나 적합도를 단정하지 않고 "더 가까울 수 있어요" 정도로 표현합니다.
- watchPoints: 지원 전에 비교해서 확인하면 좋은 차이(근무형태, 경력 조건, 필수 조건, 우대 조건 등)를 0~3개 씁니다.
  필수 조건과 우대 조건을 언급할 때는 각각 어느 쪽인지 구분해서 씁니다.

출력은 JSON 객체 하나만 출력합니다. 설명 문장이나 코드블록을 붙이지 마세요.
{
  "mainDifference": "가장 큰 차이 2~3문장",
  "commonPoints": ["공통점"],
  "bestFor": [{ "jobTitle": "공고 제목 그대로", "summary": "이 공고의 업무에 관심 있는 분에게 더 가까울 수 있는 방향" }],
  "watchPoints": ["비교할 때 주의해서 볼 차이"]
}`;

const clip = (v) => (typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "");
const clipList = (v) =>
  Array.isArray(v) ? v.map(clip).filter(Boolean).slice(0, MAX_ITEMS) : [];

/** 클라이언트가 보낸 공고에서 비교에 필요한 필드만 꺼낸다. */
function sanitizeJob(job) {
  return {
    company: clip(job?.company),
    title: clip(job?.title),
    employmentType: clip(job?.employmentType),
    career: clip(job?.career),
    location: clip(job?.location),
    keywords: clipList(job?.keywords),
    tasks: clipList(job?.tasks),
    required: clipList(job?.required),
    preferred: clipList(job?.preferred),
  };
}

const list = (items) => (items.length ? items.map((t) => `  - ${t}`).join("\n") : "  - (공고에 없음)");

function formatJob(job, i) {
  return `[공고 ${i + 1}]
title: ${job.title}
회사: ${job.company || "(공고에 없음)"}
근무형태: ${job.employmentType || "(공고에 없음)"}
경력: ${job.career || "(공고에 없음)"}
지역: ${job.location || "(공고에 없음)"}
키워드: ${job.keywords.length ? job.keywords.join(", ") : "(공고에 없음)"}
주요업무(tasks, 하게 될 일):
${list(job.tasks)}
필수조건(required, 반드시 필요한 조건):
${list(job.required)}
우대조건(preferred, 있으면 좋은 조건 · 필수 아님):
${list(job.preferred)}`;
}

function buildUserPrompt(jobs) {
  const blocks = jobs.map(formatJob);
  return `아래 채용공고 ${jobs.length}개를 비교해 주세요.

${blocks.join("\n\n")}

위 데이터만 근거로 비교해 JSON 객체 하나만 출력하세요.`;
}

/** 모델 출력에서 JSON 객체를 꺼낸다. 실패하면 null. (코드블록 제거 포함) */
function parseModelJson(text) {
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
      // 다음 후보 시도
    }
  }
  return null;
}

const isMeaningful = (v) => typeof v === "string" && v.trim() !== "" && v.trim() !== "없음";
const toStringList = (v, max) =>
  Array.isArray(v) ? v.filter(isMeaningful).map((s) => s.trim()).slice(0, max) : [];
const compact = (t) => String(t).replace(/\s+/g, "").toLowerCase();

/**
 * 표시용 문장 정리 (의미·사실은 바꾸지 않음)
 * 1. 문장 끝 어미 중복 제거: "있어요~해요." → "있어요."
 *    "요" 뒤에 물결(~)로 이어 붙은 "~해요", "~요" 같은 꼬리만 지운다.
 *    ("필요해요"처럼 정상 단어를 건드리지 않도록 물결이 있는 경우만 처리)
 * 2. 독립된 versus / vs 를 "↔"로 바꿈: "A versus B" → "A ↔ B"
 */
const DUP_ENDING = /요\.?\s*[~∼〜]+\s*[가-힣]{0,3}요(?=\s*[.!?。]|\s*$)/g;
const VERSUS = /\s*(?<![A-Za-z])(?:versus|vs)\.?(?![A-Za-z])\s*/gi;

function polishText(text) {
  return text
    .replace(DUP_ENDING, "요")
    .replace(VERSUS, " ↔ ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 모델 출력이 형식을 조금 벗어나도 화면이 깨지지 않도록 정리한다. */
function normalizeResult(raw, jobs) {
  // bestFor는 입력 공고와 제목이 맞는 것만, 입력 순서대로 남긴다 (모델이 만든 가짜 공고 제거)
  const items = Array.isArray(raw.bestFor)
    ? raw.bestFor.filter((b) => b && isMeaningful(b.jobTitle) && isMeaningful(b.summary))
    : [];
  const bestFor = [];
  jobs.forEach((job, i) => {
    const key = compact(job.title);
    const match =
      items.find((b) => compact(b.jobTitle) === key) ??
      items.find((b) => key.includes(compact(b.jobTitle)) || compact(b.jobTitle).includes(key)) ??
      // 제목을 조금 바꿔 쓴 경우: 개수가 공고 수와 같으면 순서로 대응
      (items.length === jobs.length ? items[i] : null);
    // jobTitle은 원본 공고명 그대로, summary만 표시용 정리
    if (match) bestFor.push({ jobTitle: job.title, summary: polishText(match.summary) });
  });

  return {
    mainDifference: isMeaningful(raw.mainDifference) ? polishText(raw.mainDifference) : "",
    commonPoints: toStringList(raw.commonPoints, 3).map(polishText),
    bestFor,
    watchPoints: toStringList(raw.watchPoints, 3).map(polishText),
  };
}

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function callOpenRouter(apiKey, messages) {
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
        response_format: RESPONSE_FORMAT,
        // response_format을 지원하는 무료 모델/프로바이더로만 라우팅
        provider: { require_parameters: true },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === "TimeoutError") {
      throw new UpstreamError("AI 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.", 504);
    }
    throw new UpstreamError("AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
  }

  if (!res.ok) {
    console.error("[compare-jobs] OpenRouter error", res.status, await res.text().catch(() => ""));
    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError("AI 서비스 인증에 실패했어요. 서버 설정을 확인해 주세요.", 500);
    }
    if (res.status === 429) {
      throw new UpstreamError("요청이 많아 잠시 비교할 수 없어요. 조금 뒤 다시 시도해 주세요.", 429);
    }
    throw new UpstreamError("AI 비교 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.", 502);
  }

  const data = await res.json().catch(() => null);
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function POST(request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[compare-jobs] OPENROUTER_API_KEY is not set");
    return Response.json(
      { error: "서버에 AI 설정이 되어 있지 않아요. 관리자에게 문의해 주세요." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const rawJobs = Array.isArray(body?.jobs) ? body.jobs : [];
  if (rawJobs.length < MIN_JOBS || rawJobs.length > MAX_JOBS) {
    return Response.json(
      { error: `비교할 공고를 ${MIN_JOBS}~${MAX_JOBS}개 선택해 주세요.` },
      { status: 400 }
    );
  }
  const jobs = rawJobs.map(sanitizeJob);
  if (jobs.some((j) => !j.title)) {
    return Response.json({ error: "공고 정보가 올바르지 않아요. 다시 선택해 주세요." }, { status: 400 });
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(jobs) },
  ];

  try {
    // 파싱 실패 시 한 번만 재시도
    const failedPreviews = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await callOpenRouter(apiKey, messages);
      const parsed = parseModelJson(content);
      if (parsed) {
        const result = normalizeResult(parsed, jobs);
        if (result.mainDifference) return Response.json({ result });
      }
      console.warn(`[compare-jobs] invalid AI response (attempt ${attempt + 1})`);
      failedPreviews.push(content);
    }
    // 디버깅용: AI 응답 앞부분만 로그 (API 키는 남기지 않음)
    failedPreviews.forEach((content, i) => {
      const text = typeof content === "string" ? content : String(content ?? "");
      console.error(
        `[compare-jobs] raw AI response (attempt ${i + 1}, ${text.length} chars):`,
        JSON.stringify(text.slice(0, LOG_PREVIEW_LENGTH))
      );
    });
    return Response.json(
      { error: "AI 비교 결과를 정리하지 못했어요. 다시 한 번 시도해 주세요." },
      { status: 502 }
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("[compare-jobs] unexpected error", err);
    return Response.json(
      { error: "알 수 없는 오류가 발생했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
