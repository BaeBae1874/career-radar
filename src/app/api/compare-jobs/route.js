import { requestStructured } from "@/lib/openrouter";
import { polishText } from "@/lib/polishText";

// 선택한 채용공고 2~3개의 핵심 차이를 AI로 요약하는 비교 전용 API.
// OpenRouter 호출·재시도·로그는 src/lib/openrouter.js를 /api/analyze-job과 함께 사용한다.

// attempt 1회당 최대 대기 시간. 최대 2회 → 최악의 경우에도 약 1분 안에 응답
const ATTEMPT_TIMEOUT_MS = 32000;
const MAX_ATTEMPTS = 2;

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
5. 지원자를 평가하지 않습니다. 이 서비스는 합격 가능성이나 적합성을 판단하지 않고, 공고에 적힌 차이만 설명합니다.
   다음 표현은 쓰지 않습니다: 유리하다, 불리하다, 적합하다, 잘 맞는다(더 잘 맞는다), 합격 가능성이 높다, 좋은 기회다, 경력을 쌓기 좋다, 지원하면 좋다.
   대신 공고에 명시된 사실로 씁니다.
   - ❌ "학위 소지자가 유리할 수 있어요." → ✅ "두 번째 공고는 '학사 이상'을 필수 조건으로 명시하고 있어요."
   - ❌ "CRM 경험이 있는 지원자에게 더 잘 맞아요." → ✅ "첫 번째 공고는 CRM 캠페인 운영 업무의 비중이 더 크게 나타나요."
6. 공고들의 실제 업무(주요업무)와 조건(필수조건, 우대조건, 근무형태, 경력) 차이에 집중합니다.
   - 선택한 공고가 같은 직무군일 필요는 없습니다. CRM 마케팅 ↔ 프론트엔드 개발, 콘텐츠 마케팅 ↔ 데이터 분석, 기획 ↔ 개발처럼
     서로 다른 분야여도 정상적인 비교이므로 비교를 거부하거나 "비교하기 어려워요"라고 쓰지 않습니다.
   - 이때도 실제 업무, 지원 조건, 요구 역량, 근무 조건이 어떻게 다른지를 사실 중심으로 씁니다.
   - 분야가 다르다는 이유로 어느 쪽이 더 낫다거나 누구에게 적합하다고 판단하지 않습니다.
   - 분야가 달라 의미 있는 공통점이 없으면 commonPoints는 빈 배열로 둡니다.
7. 모든 문장은 한국어 "~해요" 체로, 초보 취준생도 이해할 수 있게 짧고 쉽게 씁니다.
   "~다"·"~니다"로 끝나는 문장과 "추천" 같은 평가 표현은 쓰지 않습니다.
   - 결과 문장은 자연스러운 한국어로 씁니다. 불필요한 영어 단어를 섞지 않습니다.
   - "but", "required", "preferred", "unclear", "versus", "vs" 같은 영어 연결어·상태어는 쓰지 않습니다.
   - 영어는 CRM, SQL, GA4, ROAS처럼 그 자체가 전문용어(약어)이거나 공고 원문에 적힌 도구·기술명일 때만 씁니다.
   - 예: ❌ "REQUIRED 수준인지 여부는 unclear." → ✅ "필수 수준으로 요구되는지는 공고만으로 명확하지 않아요."

필수 / 우대 / 관심 분야 구분:
8. 필수조건(required)에 있는 내용만 "필수 조건"이라고 부르고, 우대조건(preferred)에 있는 내용은 반드시 "우대 조건"이라고 부릅니다.
   - 우대조건에 있는 기술·경험(예: SQL, GA4)을 "필수", "요구", "필요한 역량"이라고 쓰지 않습니다.
   - 필수조건과 우대조건에 있는 내용을 한데 묶어 "필수 역량", "요구 역량"처럼 쓰지 않습니다.
   - 필수와 우대가 섞여 한 문장으로 정리하기 어려우면 "공고마다 요구하거나 우대하는 역량이 달라요."처럼 중립적으로 씁니다.
9. 주요업무(tasks)는 "하게 될 일"이지 지원 조건이 아닙니다. 업무 내용을 지원자가 갖춰야 할 경험처럼 쓰지 않습니다.
10. 필수조건·우대조건·주요업무 어디에도 없는 기술, 경험, 자격을 새로 만들지 않습니다.
11. 필수조건·우대조건을 언급할 때는 공고 표현을 바꾸지 말고 그대로 옮깁니다. (예: "SQL 기본 문법을 이해"를 "SQL 사용 경험"으로 바꾸지 않음)

필드별 작성 방법:
- mainDifference: 핵심 차이를 빠르게 이해시키는 2~3문장 (최대 3문장, 전체 150자 안팎)만 씁니다.
  - 업무 초점(주요업무가 어디에 중심이 있는지)의 차이를 먼저, 그다음 필수 조건의 차이를 씁니다.
  - 회사명·근무지를 반복하지 않습니다. 공고는 "첫 번째", "두 번째", "세 번째"로 가리킵니다.
  - 근무형태·지역·마감일처럼 30초 비교 표에서 이미 보이는 정보는 다시 나열하지 않습니다.
  - 예: "첫 번째는 고객 데이터 기반 CRM 캠페인과 메시지 운영, 두 번째는 디지털 광고 집행과 성과 분석, 세 번째는 SNS 콘텐츠 기획·제작에 중심이 있어요. 필수 조건도 졸업 시점, 학사 이상, 포트폴리오 제출처럼 서로 달라요."
- commonPoints: 사용자의 직무 선택이나 지원 판단에 실제로 도움이 되는 공통점만 0~3개 씁니다.
  - 사용자의 공고 선택이나 지원 전 판단에 도움이 되지 않는 자명한 공통점은 출력하지 않습니다.
  - 아래 우선순위에 해당하고 공고에 실제 근거가 있을 때만 씁니다.
    ① 실제 업무의 공통점 ② 사용하는 데이터·지표·도구의 공통점 ③ 성과를 확인하고 개선하는 방식의 공통점
    ④ 신입·경력 등 지원 대상의 공통점 ⑤ 명확한 필수 조건의 공통점
  - 쓰는 예: "세 공고 모두 업무 결과를 확인하고 개선하는 과정이 포함돼 있어요.", "세 공고 모두 신입 지원자를 대상으로 하고 있어요.",
    "두 공고 모두 데이터나 지표를 활용해 마케팅 성과를 확인하는 업무가 포함돼 있어요."
  - 절대 쓰지 않는 내용: 지역·근무지가 같거나 비슷하다("모두 서울과 경기 지역에 있어요"), 회사 이름이 있다, 직무 제목이 있다·명확히 제시한다,
    모두 채용공고다, 회사가 서로 다르다, 제목 형식이 비슷하다, 그 밖에 너무 자명해서 직무 선택에 도움이 안 되는 내용
  - 개수를 채우려고 쓰지 않습니다. 의미 있는 공통점이 2개면 2개, 1개면 1개, 없으면 빈 배열로 둡니다.
- bestFor: 공고마다 하나씩, 입력된 순서대로 씁니다.
  - jobTitle에는 입력된 공고의 title을 글자 그대로 복사합니다.
  - summary에는 사람을 평가하지 말고, 주요업무를 바탕으로 이 공고의 업무가 어느 방향에 비중이 있는지 1~2문장으로 씁니다.
    예: "CRM 고객 데이터를 활용해 캠페인을 기획하고 메시지를 운영하는 업무 비중이 높아요."
  - "~한 분에게 맞아요", "~경험이 있는 분", "~을 할 줄 아는 분"처럼 지원자를 주어로 쓰거나 지원자 성향을 판단하지 않습니다.
  - 단, 공고의 필수조건에 특정 경험·역량이 명시되어 있으면 "필수 조건으로 ~을 명시하고 있어요"처럼 사실로 덧붙일 수 있습니다.
- watchPoints: 지원자가 지원 전에 실제로 확인해야 할 조건 차이만 0~3개 씁니다.
  - 우선 다룰 것: 근무형태(인턴·정규직·계약직), 필수 조건, 포트폴리오 제출 여부, 학력 조건, 실제로 요구하는 도구, 우대 경험
  - 필수 조건과 우대 조건을 언급할 때는 각각 어느 쪽인지 구분해서 씁니다.
  - 쓰지 않는 것: mainDifference·bestFor에서 이미 말한 설명의 반복, 회사 이름이 다르다는 내용, 지역이 다르다는 내용만 단독으로 쓴 문장

출력은 JSON 객체 하나만 출력합니다. 설명 문장이나 코드블록을 붙이지 마세요.
{
  "mainDifference": "업무 초점과 필수 조건의 핵심 차이 2~3문장",
  "commonPoints": ["공통점"],
  "bestFor": [{ "jobTitle": "공고 제목 그대로", "summary": "이 공고의 업무가 비중을 두는 방향" }],
  "watchPoints": ["지원 전에 확인할 조건 차이"]
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

/** 모델 출력이 형식을 조금 벗어나도 화면이 깨지지 않도록 정리한다. */
// prompt를 어겨도 걸러내는 안전망: 공고 형식상 당연한(선택에 도움이 안 되는) 공통점
// 의미 있는 문장을 지우지 않도록 명백한 형태만 좁게 잡는다
// watchPoints: 회사가 다르다는 내용, 지역 차이만 단독으로 말하는 문장 제거
const COMPANY_DIFF = /서로\s*다른\s*회사|회사(명|\s*이름)?(이|가)\s*(서로\s*)?(달라|다르|다릅)/;
const REGION_DIFF = /(지역|근무지)[^.]{0,10}(달라|다르|다릅|차이)/;
const CONDITION_WORD = /근무형태|인턴|정규직|계약직|필수|우대|경력|신입|학력|학사|포트폴리오|도구|경험|조건/;
const isTrivialWatch = (t) =>
  COMPANY_DIFF.test(t) || (REGION_DIFF.test(t) && !CONDITION_WORD.test(t));

// mainDifference: 최대 3문장까지만 (긴 문단 방지)
const MAX_DIFF_SENTENCES = 3;
const limitSentences = (text) => {
  const parts = text.match(/[^.!?]+[.!?]+["')]*\s*|[^.!?]+$/g) ?? [text];
  return parts.slice(0, MAX_DIFF_SENTENCES).join("").trim();
};

const TRIVIAL_COMMON = [
  /회사\s*(이름|명).{0,12}(직무|제목)/, // "회사 이름과 직무 제목을 제시"
  /(직무명|직무\s*제목|공고\s*제목|제목).{0,10}(적혀|제시|명시|표시)/, // "제목에 직무명이 적혀 있어요"
  /^(모두|모든 공고|각 공고|두 공고 모두|세 공고 모두)[^.]{0,8}채용\s*공고(예요|이에요|입니다)/, // "모두 채용공고예요"
  /(한국|국내)\s*(지역)?에\s*(있|위치)/, // "모두 한국 지역에 있어요"
  /(지역|근무지)[^.]{0,6}(에\s*(있|위치)|(이|가)\s*(비슷|같))/, // "모두 서울과 경기 지역에 있어요"
  /제목\s*형식/, // "제목 형식이 비슷해요"
  /서로\s*다른\s*회사/, // "서로 다른 회사에서 모집"
];

function normalizeResult(raw, jobs) {
  // 표시 직전 문장 정리 (공고 데이터에 실제로 있는 영어 표현은 보존)
  const source = JSON.stringify(jobs);
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
    if (match) bestFor.push({ jobTitle: job.title, summary: polishText(match.summary, source) });
  });

  return {
    mainDifference: isMeaningful(raw.mainDifference)
      ? limitSentences(polishText(raw.mainDifference, source))
      : "",
    commonPoints: toStringList(raw.commonPoints, 3)
      .filter((t) => !TRIVIAL_COMMON.some((re) => re.test(t)))
      .map((t) => polishText(t, source)),
    bestFor,
    watchPoints: toStringList(raw.watchPoints, 3)
      .filter((t) => !isTrivialWatch(t))
      .map((t) => polishText(t, source)),
  };
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

  const outcome = await requestStructured({
    apiKey,
    messages,
    responseFormat: RESPONSE_FORMAT,
    tag: "compare-jobs",
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    maxAttempts: MAX_ATTEMPTS,
    accept: (content) => {
      const parsed = parseModelJson(content);
      if (!parsed) return { failure: "parse_failed" };
      const result = normalizeResult(parsed, jobs);
      return result.mainDifference ? { value: result } : { failure: "schema_failed" };
    },
  });
  if (outcome.ok) return Response.json({ result: outcome.value });
  return failureResponse(outcome.reason);
}

// 실패 응답 (형태는 기존과 같은 { error })
function failureResponse(reason) {
  if (reason === "auth") {
    console.error("[compare-jobs] OpenRouter authentication failed");
    return Response.json(
      { error: "AI 서비스 인증에 실패했어요. 서버 설정을 확인해 주세요." },
      { status: 500 }
    );
  }
  if (reason === "rate_limit") {
    return Response.json(
      { error: "요청이 많아 잠시 비교할 수 없어요. 조금 뒤 다시 시도해 주세요." },
      { status: 429 }
    );
  }
  return Response.json(
    { error: "AI 비교 요약을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
    { status: reason === "timeout" ? 504 : 502 }
  );
}
