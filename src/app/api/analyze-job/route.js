import { requestStructured } from "@/lib/openrouter";
import { polishList, polishText } from "@/lib/polishText";
import { filterSimilarRoles, filterUnclearPoints, postingTitle } from "@/lib/analysisText";

const MAX_POSTING_LENGTH = 15000;
// 요청별 최대 대기 시간 (첫 요청, 조건부 재시도 1번). 분석은 응답이 길어 비교보다 여유. 모델 목록은 src/lib/openrouter.js
// 최악의 경우 약 45 + 4(대기) + 35 = 84초
const MODEL_TIMEOUTS_MS = [45000, 35000];

const SYSTEM_PROMPT = `당신은 채용공고를 분석해 취업 준비생에게 "이 직무가 실제로 하는 일"을 설명하는 도우미입니다.

반드시 지킬 규칙:
1. 사용자가 붙여넣은 채용공고 안에 있는 정보만 근거로 분석합니다.
2. 공고에 없는 경력, 자격, 기술, 업무를 지어내지 않습니다.
3. 필수 조건(자격요건)과 우대 조건(우대사항)을 절대 섞지 않습니다. 공고에서 구분이 불분명하면 unclearPoints에 적습니다.
4. 공고에 명시되지 않은 항목은 빈 배열로 둡니다. jobTitle은 공고에 직무명이 적혀 있을 때만 그대로 쓰고, 적혀 있지 않으면 추정하지 말고 "없음"으로 둡니다.
5. similarRoles는 공고 내용과 직무 맥락에서 무리 없이 추론할 수 있을 때만 최대 3개까지 작성합니다.
   - name에는 "CRM 마케터", "콘텐츠 마케터", "퍼포먼스 마케터", "데이터 분석가"처럼 업계에서 일반적으로 쓰는 직무 범주만 씁니다.
   - 회사명·서비스명·브랜드명이 들어간 직무명(예: "카카오톡 마케팅 매니저")이나 실제 존재 여부를 확인할 수 없는 구체적인 직무명은 절대 쓰지 않습니다.
   - 이 공고 직무와 헷갈리기 쉬운 "인접 직무"를 고릅니다. 지금 직무와 같거나 사실상 같은 직무는 넣지 않습니다.
     인턴·주니어·신입·시니어처럼 경력 단계만 다르거나, 기술명만 붙인 같은 직무도 제외합니다.
     예) 지금 직무가 "데이터 분석 인턴" → ✅ 데이터 엔지니어, BI 분석가, 데이터 사이언티스트 / ❌ 데이터 분석가, 주니어 데이터 분석가
     예) 지금 직무가 "프론트엔드 개발자" → ✅ 웹 개발자, 백엔드 개발자, UI 엔지니어 / ❌ React 프론트엔드 개발자, 주니어 프론트엔드 개발자
     직무명이 비슷해 보여도 공고상 실제 역할이 분명히 다르면 의미 기준으로 판단해 넣어도 됩니다.
   - 확신하기 어려우면 빈 배열로 둡니다.
6. unclearPoints에는 지원 판단에 실제로 영향을 주는데 공고에 명시되지 않은 것만 넣습니다. (아래 "확인할 점" 참고)
7. 모든 설명은 한국어로, 초보 취준생도 이해할 수 있게 짧고 쉽게 씁니다.
   - 한 문장에는 한 가지 정보만 담습니다. 여러 내용을 쉼표로 길게 잇지 않습니다.
   - 전문용어는 공고에 적힌 것만 쓰고, 필요하면 쉬운 말로 풀어 씁니다.
   - 같은 내용을 여러 항목에서 반복하지 않습니다. (예: actualTasks에 쓴 업무를 simpleExplanation·unclearPoints에서 다시 나열하지 않음)
   - 결과 문장은 자연스러운 한국어로 씁니다. 불필요한 영어 단어를 섞지 않습니다.
   - "but", "required", "preferred", "unclear", "versus", "vs" 같은 영어 연결어·상태어는 쓰지 않습니다.
   - 영어는 CRM, SQL, GA4, ROAS처럼 그 자체가 전문용어(약어)이거나 공고 원문에 적힌 도구·기술명일 때만 씁니다.
   - 예: ❌ "REQUIRED 수준인지 여부는 unclear." → ✅ "필수 수준으로 요구되는지는 공고만으로 명확하지 않아요."
8. skills에는 공고에서 확인되는 핵심 업무·기술·도구·역량 키워드(예: A/B 테스트, CRM, 데이터 분석, 스프레드시트)를 짧은 단어로 넣습니다.
   - 중요한 순서로 넣습니다: ① 실제 업무를 대표하는 키워드 → ② 핵심 역량 → ③ 주요 도구·지표. 화면에는 앞의 6개가 먼저 보여요.
   - 거의 같은 뜻의 키워드는 하나로 합칩니다. (예: "오픈율", "전환율" → "오픈율·전환율") 공고에 없는 키워드는 만들지 않습니다.
9. 직무 범위를 단정하지 않습니다. (simpleExplanation, similarRoles.difference 공통)
   - "항상", "오직", "~만 담당", "반드시" 같은 표현을 쓰지 않습니다. (공고의 필수 조건을 그대로 옮길 때의 "필수"는 괜찮음)
   - 직무의 일반적인 경향은 "일반적으로", "주로", "~에 더 초점을 두는 경우가 많습니다"처럼 씁니다.
   - 회사·팀마다 업무 범위가 다를 수 있다는 것을 전제로 쓰되, 그런 안내 문장을 매번 덧붙이지는 않습니다.
   - ❌ "프론트엔드 개발자는 사용자 인터페이스와 상호작용하는 부분만을 담당합니다."
   - ✅ "프론트엔드 개발자는 일반적으로 사용자가 직접 접하는 화면과 상호작용 구현에 더 초점을 두는 경우가 많습니다."
10. explanationEvidence에는 simpleExplanation의 근거가 된 문장을 채용공고 원문에서 글자 그대로 복사해 1~3개만 넣습니다.
   - 문장을 요약하거나 바꾸거나 새로 만들지 않습니다. 원문에 그대로 존재하는 문장만 넣습니다.
   - 적절한 근거가 없으면 빈 배열로 둡니다.

확인할 점 (unclearPoints):
- 공고에 적혀 있지 않아서, 지원 전에 확인하면 판단에 도움이 되는 것만 0~3개 씁니다.
- 항목마다 "무엇이 공고에 명시되지 않았는지" + "지원 전에 무엇을 확인하면 좋은지"를 짧게 씁니다.
  ✅ "정규직 전환 여부가 공고에 명시되지 않았어요. 지원 전에 전환 조건을 확인해보세요."
  ✅ "근무 기간이 공고에 적혀 있지 않아요. 인턴 기간과 전환 여부를 확인해보세요."
- 공고에 이미 적힌 내용(업무·필수·우대 조건·근무형태 등)을 다시 "확인 필요"로 쓰지 않습니다.
- 공고 내용만으로 근거가 없는 위험이나 문제를 추측해서 만들지 않습니다. (예: "업무 강도가 높을 수 있음" 같은 추측 금지)
- 단순히 기술 숙련도의 세부 수준이 적혀 있지 않다는 이유만으로 확인 필요 항목을 만들지 않습니다.
  지원 여부, 계약·근무 조건, 채용 절차, 실제 업무 범위에 영향을 줄 수 있는 정보가 비어 있을 때 우선적으로 씁니다.
  - 우선: 정규직 전환 여부, 근무 기간, 근무 위치, 재택·출근 방식, 근무 시간, 계약 형태, 채용 절차,
    포트폴리오 제출 여부·방식, 특정 도구가 실제 필수인지, 공고 내용끼리 서로 충돌하거나 모호한 조건
  - 쓰지 않음: SQL·Python·React·Excel 등의 구체적인 숙련도, 커뮤니케이션 능력 수준, 일반적인 기술 이해도의 세부 수준
    ❌ "SQL 기본 문법의 구체적인 수준은 공고에 명시되지 않았어요. 지원 전에 요구 수준을 확인해보세요."
  - 예외: 공고가 "고급 수준", "숙련자", "실무 수준"처럼 요구 수준을 모호하게 적어 지원 판단에 실제로 영향을 줄 때만 허용합니다.
- 확인할 점이 없으면 억지로 채우지 말고 빈 배열 []로 둡니다.

출력 형식 (반드시 지킬 것):
- 응답 전체가 아래 구조의 JSON 객체 하나여야 합니다. 첫 글자는 "{", 마지막 글자는 "}"입니다.
- JSON 앞뒤에 인사말, 설명, 마크다운, 코드블록(\`\`\`)을 절대 붙이지 않습니다.
- 아래의 모든 키를 빠짐없이, 키 이름 그대로 씁니다. 키를 추가하거나 이름을 바꾸지 않습니다.
- 문자열은 큰따옴표로 감싸고, 배열 필드는 내용이 없어도 빈 배열 []로 둡니다.
{
  "jobTitle": "공고에서 파악한 직무명",
  "simpleExplanation": "이 직무를 초보 취준생도 이해할 수 있게 짧은 한두 문장으로 설명 (단정 표현 없이)",
  "explanationEvidence": ["simpleExplanation의 근거가 된 채용공고 원문 문장 (그대로 복사)"],
  "actualTasks": ["공고에서 확인되는 실제 업무"],
  "skills": ["공고에서 확인되는 핵심 업무·기술·도구·역량 키워드"],
  "required": ["필수 조건"],
  "preferred": ["우대 조건"],
  "similarRoles": [{ "name": "비슷한 직무", "difference": "일반적인 경향으로, 단정하지 않고 한 문장" }],
  "unclearPoints": ["공고에 명시되지 않은 것 + 지원 전에 확인할 것 (없으면 빈 배열)"]
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
  const actualTasks = polishList(toStringList(raw.actualTasks), jobPosting);
  const required = polishList(toStringList(raw.required), jobPosting);
  const preferred = polishList(toStringList(raw.preferred), jobPosting);
  return {
    jobTitle: isMeaningful(raw.jobTitle) ? polish(raw.jobTitle.trim()) : "없음",
    simpleExplanation: isMeaningful(raw.simpleExplanation)
      ? polish(raw.simpleExplanation.trim())
      : "",
    explanationEvidence: verifyEvidence(raw.explanationEvidence, jobPosting),
    actualTasks,
    skills: toStringList(raw.skills),
    required,
    preferred,
    // 지금 직무와 사실상 같은 직무(경력 단계·기술명만 다른 것)는 제외
    similarRoles: Array.isArray(raw.similarRoles)
      ? filterSimilarRoles(
          raw.similarRoles
            .filter((r) => r && isMeaningful(r.name))
            .map((r) => ({
              name: polish(r.name.trim()),
              difference: isMeaningful(r.difference) ? polish(r.difference.trim()) : "",
            })),
          [isMeaningful(raw.jobTitle) ? raw.jobTitle : "", postingTitle(jobPosting)]
        ).slice(0, 3)
      : [],
    // "불명확한 부분 없음" 같은 빈 항목·공고에 이미 적힌 조건의 반복은 제외 (없으면 화면이 "발견되지 않았어요")
    unclearPoints: filterUnclearPoints(polishList(toStringList(raw.unclearPoints), jobPosting), {
      tasks: actualTasks,
      required,
      preferred,
    }),
  };
}

export async function POST(request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[analyze-job] OPENROUTER_API_KEY is not set");
    return failureResponse("auth");
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

// 실패 응답 (형태는 기존과 같은 { error }). 사용자에게는 원인(402·429·OpenRouter 등)을 보이지 않고 짧은 안내만
// status로만 구분: rate_limit 429 / timeout 504 / 그 밖 503. 자세한 원인은 서버 로그(openrouter.js)에만
function failureResponse(reason) {
  if (reason === "auth") console.error("[analyze-job] OpenRouter authentication failed");
  const status = reason === "rate_limit" ? 429 : reason === "timeout" ? 504 : 503;
  return Response.json({ error: "AI 분석을 잠시 불러오지 못했어요. 공고에 적힌 내용은 그대로 확인할 수 있어요.", aiUnavailable: true }, { status });
}
