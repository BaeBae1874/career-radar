import { requestStructured } from "@/lib/openrouter";
import { polishList, polishText } from "@/lib/polishText";

const MAX_POSTING_LENGTH = 15000;
// 모델별 최대 대기 시간 (OPENROUTER_MODELS 순서: Solar Mini 4 → Gemma free). 분석은 응답이 길어 비교보다 여유. 최악의 경우 약 80초
const MODEL_TIMEOUTS_MS = [35000, 45000];

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
   - 결과 문장은 자연스러운 한국어로 씁니다. 불필요한 영어 단어를 섞지 않습니다.
   - "but", "required", "preferred", "unclear", "versus", "vs" 같은 영어 연결어·상태어는 쓰지 않습니다.
   - 영어는 CRM, SQL, GA4, ROAS처럼 그 자체가 전문용어(약어)이거나 공고 원문에 적힌 도구·기술명일 때만 씁니다.
   - 예: ❌ "REQUIRED 수준인지 여부는 unclear." → ✅ "필수 수준으로 요구되는지는 공고만으로 명확하지 않아요."
8. skills에는 공고에서 확인되는 핵심 업무·기술·도구·역량 키워드(예: A/B 테스트, CRM, 데이터 분석, 스프레드시트)를 짧은 단어로 넣습니다.
   - 중요한 순서로 넣습니다: ① 실제 업무를 대표하는 키워드 → ② 핵심 역량 → ③ 주요 도구·지표. 화면에는 앞의 6개가 먼저 보여요.
   - 거의 같은 뜻의 키워드는 하나로 합칩니다. (예: "오픈율", "전환율" → "오픈율·전환율") 공고에 없는 키워드는 만들지 않습니다.
9. explanationEvidence에는 simpleExplanation의 근거가 된 문장을 채용공고 원문에서 글자 그대로 복사해 1~3개만 넣습니다.
   - 문장을 요약하거나 바꾸거나 새로 만들지 않습니다. 원문에 그대로 존재하는 문장만 넣습니다.
   - 적절한 근거가 없으면 빈 배열로 둡니다.

출력 형식 (반드시 지킬 것):
- 응답 전체가 아래 구조의 JSON 객체 하나여야 합니다. 첫 글자는 "{", 마지막 글자는 "}"입니다.
- JSON 앞뒤에 인사말, 설명, 마크다운, 코드블록(\`\`\`)을 절대 붙이지 않습니다.
- 아래의 모든 키를 빠짐없이, 키 이름 그대로 씁니다. 키를 추가하거나 이름을 바꾸지 않습니다.
- 문자열은 큰따옴표로 감싸고, 배열 필드는 내용이 없어도 빈 배열 []로 둡니다.
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

위 채용공고 원문만 근거로 분석해 JSON 객체 하나만 출력하세요. JSON 외의 글자는 한 글자도 쓰지 마세요.`;
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
  // 표시 직전 문장 정리: 영어 filler·깨진 단어만 다듬고, 공고 원문에 있는 표현은 보존
  // (explanationEvidence는 원문 그대로 검증된 문장, skills는 도구·기술명이라 손대지 않음)
  const polish = (t) => polishText(t, jobPosting);
  return {
    jobTitle: isMeaningful(raw.jobTitle) ? polish(raw.jobTitle.trim()) : "없음",
    simpleExplanation: isMeaningful(raw.simpleExplanation)
      ? polish(raw.simpleExplanation.trim())
      : "",
    explanationEvidence: verifyEvidence(raw.explanationEvidence, jobPosting),
    actualTasks: polishList(toStringList(raw.actualTasks), jobPosting),
    skills: toStringList(raw.skills),
    required: polishList(toStringList(raw.required), jobPosting),
    preferred: polishList(toStringList(raw.preferred), jobPosting),
    similarRoles: Array.isArray(raw.similarRoles)
      ? raw.similarRoles
          .filter((r) => r && isMeaningful(r.name))
          .map((r) => ({
            name: polish(r.name.trim()),
            difference: isMeaningful(r.difference) ? polish(r.difference.trim()) : "",
          }))
          .slice(0, 3)
      : [],
    unclearPoints: polishList(toStringList(raw.unclearPoints), jobPosting),
  };
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

  // 재시도·timeout·로그는 compare-jobs와 같은 공통 로직 사용
  const outcome = await requestStructured({
    apiKey,
    messages,
    tag: "analyze-job",
    timeoutsMs: MODEL_TIMEOUTS_MS,
    accept: (content) => {
      const parsed = parseModelJson(content);
      if (!parsed) return { failure: "parse_failed" };
      const result = normalizeResult(parsed, jobPosting);
      // 핵심 필드(30초 설명)가 비어 있으면 형식 실패로 보고 재시도
      return result.simpleExplanation ? { value: result } : { failure: "schema_failed" };
    },
  });
  if (outcome.ok) return Response.json({ result: outcome.value });
  return failureResponse(outcome.reason);
}

// 실패 응답 (형태는 기존과 같은 { error })
function failureResponse(reason) {
  if (reason === "auth") {
    console.error("[analyze-job] OpenRouter authentication failed");
    return Response.json(
      { error: "AI 서비스 인증에 실패했어요. 서버 설정을 확인해 주세요." },
      { status: 500 }
    );
  }
  if (reason === "rate_limit") {
    return Response.json(
      { error: "요청이 많아 잠시 분석할 수 없어요. 조금 뒤 다시 시도해 주세요." },
      { status: 429 }
    );
  }
  return Response.json(
    { error: "공고 분석을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
    { status: reason === "timeout" ? 504 : 502 }
  );
}
