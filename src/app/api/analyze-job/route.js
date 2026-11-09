const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openrouter/free";
const MAX_POSTING_LENGTH = 15000;
const REQUEST_TIMEOUT_MS = 60000;
// 파싱 실패 시 서버 로그에 남길 AI 응답 앞부분 길이
const LOG_PREVIEW_LENGTH = 300;

const stringArray = { type: "array", items: { type: "string" } };

// 기존 결과 구조와 동일한 JSON schema (프론트엔드 데이터 구조 그대로)
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "job_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        jobTitle: { type: "string" },
        simpleExplanation: { type: "string" },
        explanationEvidence: stringArray,
        actualTasks: stringArray,
        skills: stringArray,
        required: stringArray,
        preferred: stringArray,
        similarRoles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              difference: { type: "string" },
            },
            required: ["name", "difference"],
            additionalProperties: false,
          },
        },
        unclearPoints: stringArray,
      },
      required: [
        "jobTitle",
        "simpleExplanation",
        "explanationEvidence",
        "actualTasks",
        "skills",
        "required",
        "preferred",
        "similarRoles",
        "unclearPoints",
      ],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `당신은 채용공고를 분석해 취업 준비생에게 "이 직무가 실제로 하는 일"을 설명하는 도우미입니다.

반드시 지킬 규칙:
1. 사용자가 붙여넣은 채용공고 안에 있는 정보만 근거로 분석합니다.
2. 공고에 없는 경력, 자격, 기술, 업무를 지어내지 않습니다.
3. 필수 조건(자격요건)과 우대 조건(우대사항)을 절대 섞지 않습니다. 공고에서 구분이 불분명하면 unclearPoints에 적습니다.
4. 공고에 명시되지 않은 항목은 빈 배열로 둡니다. jobTitle은 공고에 직무명이 적혀 있을 때만 그대로 쓰고, 적혀 있지 않으면 추정하지 말고 "없음"으로 둡니다.
5. similarRoles는 공고 내용과 직무 맥락에서 무리 없이 추론할 수 있을 때만 최대 3개까지 작성합니다.
   - name에는 "CRM 마케터", "콘텐츠 마케터", "퍼포먼스 마케터", "데이터 분석가"처럼 업계에서 일반적으로 쓰는 직무 범주만 씁니다.
   - 회사명·서비스명·브랜드명이 들어간 직무명(예: "카카오톡 마케팅 매니저")이나 실제 존재 여부를 확인할 수 없는 구체적인 직무명은 절대 쓰지 않습니다.
   - 확신하기 어려우면 빈 배열로 둡니다.
6. 확실하지 않은 정보는 unclearPoints에 넣습니다.
7. 모든 설명은 한국어로, 초보 취준생도 이해할 수 있게 짧고 쉽게 씁니다.
8. skills에는 공고에서 확인되는 핵심 업무·기술·도구·역량 키워드(예: A/B 테스트, CRM, 데이터 분석, 스프레드시트)를 짧은 단어로 넣습니다.
9. explanationEvidence에는 simpleExplanation의 근거가 된 문장을 채용공고 원문에서 글자 그대로 복사해 1~3개만 넣습니다.
   - 문장을 요약하거나 바꾸거나 새로 만들지 않습니다. 원문에 그대로 존재하는 문장만 넣습니다.
   - 적절한 근거가 없으면 빈 배열로 둡니다.

출력은 아래 형태의 JSON 객체 하나만 출력합니다. 설명 문장이나 코드블록을 붙이지 마세요.
{
  "jobTitle": "공고에서 파악한 직무명",
  "simpleExplanation": "이 직무를 초보 취준생도 이해할 수 있게 한두 문장으로 설명",
  "explanationEvidence": ["simpleExplanation의 근거가 된 채용공고 원문 문장 (그대로 복사)"],
  "actualTasks": ["공고에서 확인되는 실제 업무"],
  "skills": ["공고에서 확인되는 핵심 업무·기술·도구·역량 키워드"],
  "required": ["필수 조건"],
  "preferred": ["우대 조건"],
  "similarRoles": [{ "name": "비슷한 직무", "difference": "차이를 짧게 설명" }],
  "unclearPoints": ["공고만으로는 명확하게 알 수 없는 부분"]
}`;

function buildUserPrompt({ interests, keyword, jobPosting }) {
  return `[사용자가 선택한 관심 분야]
${interests.length ? interests.join(", ") : "선택 안 함"}

[사용자가 궁금한 직무나 키워드]
${keyword || "입력 안 함"}

[채용공고 원문]
"""
${jobPosting}
"""

위 채용공고 원문만 근거로 분석해 JSON 객체 하나만 출력하세요.`;
}

/** 모델 출력에서 JSON 객체를 꺼낸다. 실패하면 null. */
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

const isMeaningful = (v) =>
  typeof v === "string" && v.trim() !== "" && v.trim() !== "없음";

const toStringList = (v) =>
  Array.isArray(v) ? v.filter(isMeaningful).map((s) => s.trim()) : [];

const collapse = (t) => t.replace(/\s+/g, " ").trim();
// 원문 줄 앞의 글머리표("- ", "• ", "1. " 등)와 감싼 따옴표 제거
const stripDecor = (t) =>
  t
    .trim()
    .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, "")
    .replace(/^(?:[-*•·▪■□○●◦]|\d+[.)])\s*/, "")
    .trim();

/** 모델이 준 근거 중 채용공고 원문에 실제로 존재하는 문장만 남긴다. */
function verifyEvidence(list, jobPosting) {
  if (!Array.isArray(list)) return [];
  const source = collapse(jobPosting);
  const seen = new Set();
  const verified = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const text = collapse(stripDecor(item));
    if (text.length < 4 || seen.has(text) || !source.includes(text)) continue;
    seen.add(text);
    verified.push(text);
    if (verified.length === 3) break;
  }
  return verified;
}

/** 모델 출력이 형식을 조금 벗어나도 화면이 깨지지 않도록 정리한다. */
function normalizeResult(raw, jobPosting) {
  return {
    jobTitle: isMeaningful(raw.jobTitle) ? raw.jobTitle.trim() : "없음",
    simpleExplanation: isMeaningful(raw.simpleExplanation)
      ? raw.simpleExplanation.trim()
      : "",
    explanationEvidence: verifyEvidence(raw.explanationEvidence, jobPosting),
    actualTasks: toStringList(raw.actualTasks),
    skills: toStringList(raw.skills),
    required: toStringList(raw.required),
    preferred: toStringList(raw.preferred),
    similarRoles: Array.isArray(raw.similarRoles)
      ? raw.similarRoles
          .filter((r) => r && isMeaningful(r.name))
          .map((r) => ({
            name: r.name.trim(),
            difference: isMeaningful(r.difference) ? r.difference.trim() : "",
          }))
          .slice(0, 3)
      : [],
    unclearPoints: toStringList(raw.unclearPoints),
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
    console.error("[analyze-job] OpenRouter error", res.status, await res.text().catch(() => ""));
    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError("AI 서비스 인증에 실패했어요. 서버 설정을 확인해 주세요.", 500);
    }
    if (res.status === 429) {
      throw new UpstreamError("요청이 많아 잠시 분석할 수 없어요. 조금 뒤 다시 시도해 주세요.", 429);
    }
    throw new UpstreamError("AI 분석 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.", 502);
  }

  const data = await res.json().catch(() => null);
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function POST(request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[analyze-job] OPENROUTER_API_KEY is not set");
    return Response.json(
      { error: "서버에 AI 설정이 되어 있지 않아요. 관리자에게 문의해 주세요." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => null);
  const jobPosting = typeof body?.jobPosting === "string" ? body.jobPosting.trim() : "";
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim().slice(0, 500) : "";
  const interests = Array.isArray(body?.interests)
    ? body.interests.filter((v) => typeof v === "string").slice(0, 20)
    : [];

  if (!jobPosting) {
    return Response.json({ error: "분석할 채용공고 내용을 입력해 주세요." }, { status: 400 });
  }
  if (jobPosting.length > MAX_POSTING_LENGTH) {
    return Response.json(
      { error: `채용공고 내용이 너무 길어요. ${MAX_POSTING_LENGTH.toLocaleString()}자 이내로 줄여 주세요.` },
      { status: 400 }
    );
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt({ interests, keyword, jobPosting }) },
  ];

  try {
    // 파싱 실패 시 한 번만 재시도
    const failedPreviews = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await callOpenRouter(apiKey, messages);
      const parsed = parseModelJson(content);
      if (parsed) return Response.json({ result: normalizeResult(parsed, jobPosting) });
      console.warn(`[analyze-job] JSON parse failed (attempt ${attempt + 1})`);
      failedPreviews.push(content);
    }
    // 디버깅용: AI 응답 앞부분만 로그 (API 키·채용공고 원문은 남기지 않음)
    failedPreviews.forEach((content, i) => {
      const text = typeof content === "string" ? content : String(content ?? "");
      console.error(
        `[analyze-job] raw AI response (attempt ${i + 1}, ${text.length} chars):`,
        JSON.stringify(text.slice(0, LOG_PREVIEW_LENGTH))
      );
    });
    return Response.json(
      { error: "AI 응답을 정리하지 못했어요. 다시 한 번 시도해 주세요." },
      { status: 502 }
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("[analyze-job] unexpected error", err);
    return Response.json(
      { error: "알 수 없는 오류가 발생했어요. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
