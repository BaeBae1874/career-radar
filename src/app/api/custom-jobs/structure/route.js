import { parseModelJson, requestStructured } from "@/lib/openrouter";
import { forbiddenOrigin, isSameOrigin, json, readJsonBody } from "@/lib/apiRoute";
import { hasStructuredContent, normalizeStructured, sanitizeCustomInput } from "@/lib/customJobs";

/**
 * 직접 붙여넣은 공고 → Career Radar 공고 구조로 정리 (미리보기용, 저장하지 않음, 로그인 불필요)
 * OpenRouter 호출·무료 모델 fallback·재시도는 src/lib/openrouter.js를 그대로 사용한다.
 * AI 응답은 서버에서 다시 거른다: 공고 본문에서 직접 확인되지 않는 값은 버림 (normalizeStructured)
 */

const MAX_BODY_BYTES = 20 * 1024; // 본문 15,000자 + 회사명·공고명 여유
const TIMEOUTS_MS = [40000, 30000];

const FAIL_MESSAGE = "공고 내용을 정리하지 못했어요. 입력한 내용은 그대로 유지돼요. 다시 시도해 주세요.";

const SYSTEM_PROMPT = `당신은 사용자가 채용사이트에서 복사해 붙여넣은 채용공고를 정해진 구조로 옮겨 적는 도우미입니다.

가장 중요한 원칙:
공고에 없는 내용을 보완하거나 일반적인 직무 지식으로 채우지 마라. 입력된 공고에서 직접 확인 가능한 정보만 구조화하라.

규칙:
1. 각 항목은 공고 본문의 문장·표현을 최대한 그대로 옮깁니다. 요약하거나 다른 말로 바꾸지 않습니다. (앞의 "-", "•", 번호는 빼도 됨)
2. 본문에서 확인할 수 없는 값은 비워 둡니다. 추측하지 않습니다.
   - 근무형태(정규직·인턴·계약직 등)가 적혀 있지 않으면 employmentType은 "" , employmentTypes는 []
   - 경력 조건이 없으면 career는 ""
   - 근무 지역이 없으면 location은 ""
   - 마감일이 없으면 deadline은 ""
   - 우대조건이 없으면 preferred는 []
3. tasks에는 "주요 업무·담당 업무·하는 일"에 해당하는 내용만, required에는 "자격요건·필수"만, preferred에는 "우대사항"만 넣습니다.
   필수와 우대를 섞지 않습니다. 구분이 적혀 있지 않은 조건을 임의로 필수나 우대로 나누지 않습니다.
   필수 조건과 우대 조건에 서로 독립적인 조건이 여러 개 포함되어 있으면 의미를 바꾸지 않는 범위에서 각 조건을 별도 항목으로 분리하라.
   - 나눈 각 항목은 원문 표현을 그대로 씁니다. 수치·단위를 바꾸거나("190이상"을 "190cm 이상"으로) 말을 덧붙이지 않습니다.
   - 하나의 조건을 억지로 쪼개지 않습니다. (예: "SQL 또는 GA4 사용 경험"은 한 항목)
   - 독립 조건인지 애매하면 나누지 말고 원문 한 줄 그대로 둡니다.
   - 예) 원문 "키 190이상 몸무게 120키로이상" → ["키 190이상", "몸무게 120키로이상"]
   - 예) 원문 "태권도 9단 무에타이 9단 쿵푸 9단 달고오세요" → ["태권도 9단", "무에타이 9단", "쿵푸 9단"]
4. keywords에는 본문에 실제로 적힌 직무·도구·기술 단어만 최대 10개 넣습니다. (예: SQL, Figma, CRM) 본문에 없는 단어는 넣지 않습니다.
5. 회사 소개, 복지, 연봉, 채용 절차 안내 문구는 tasks·required·preferred에 넣지 않습니다.
6. "없음", "미기재", "정보 없음" 같은 글자를 값으로 쓰지 않습니다. 없으면 빈 값입니다.
7. 모집 일정과 근무기간은 서로 다른 정보입니다. 절대 섞지 않습니다.
   - applicationStartDate / applicationEndDate: 본문에 적힌 "지원 접수" 시작일·마감일만. "YYYY-MM-DD" 형식으로 씁니다.
     본문에 연도가 없으면 월·일만 맞게 쓰면 됩니다. 본문에 접수 날짜가 없으면 "".
     예) "접수기간: 11월 18일 ~ 12월 2일" → applicationStartDate "2026-11-18", applicationEndDate "2026-12-02"
   - closeType: 본문에 적힌 마감 방식. 접수 마감일이 적혀 있으면 "deadline", "채용시 마감"이면 "rolling",
     "상시 채용"이면 "always", "수시 채용"이면 "occasional". 적혀 있지 않으면 "".
   - workPeriod: 본문에 적힌 실제 근무기간을 원문 표현 그대로. (예: "2027년 1월부터 6개월간 근무", "3개월")
     접수 기간·게시일·지원 시작일을 근무기간으로 쓰지 않습니다.
     "인턴"이라고만 적혀 있고 기간이 없으면 "". "미정", "예상" 같은 값을 만들지 않습니다.

출력 형식 (반드시 지킬 것):
- 응답 전체가 아래 구조의 JSON 객체 하나여야 합니다. JSON 앞뒤에 다른 글자, 마크다운, 코드블록을 붙이지 않습니다.
- 모든 키를 빠짐없이 그대로 씁니다. 배열은 내용이 없어도 []입니다.
{
  "tasks": ["주요 업무 (본문 표현 그대로)"],
  "required": ["필수 자격요건 (본문 표현 그대로)"],
  "preferred": ["우대사항 (본문 표현 그대로)"],
  "keywords": ["본문에 적힌 직무·도구·기술 단어"],
  "employmentType": "본문에 적힌 근무형태 또는 \\"\\"",
  "employmentTypes": ["본문에 적힌 근무형태들"],
  "career": "본문에 적힌 경력 조건 또는 \\"\\"",
  "location": "본문에 적힌 근무 지역 또는 \\"\\"",
  "applicationStartDate": "지원 접수 시작일 YYYY-MM-DD 또는 \\"\\"",
  "applicationEndDate": "지원 접수 마감일 YYYY-MM-DD 또는 \\"\\"",
  "closeType": "deadline | rolling | always | occasional 또는 \\"\\"",
  "workPeriod": "본문에 적힌 실제 근무기간 원문 그대로 또는 \\"\\""
}`;

const buildUserPrompt = ({ company, title, posting }) => `[회사명] ${company}
[공고명] ${title}

[채용공고 본문]
"""
${posting}
"""

위 본문만 근거로 JSON 객체 하나만 출력하세요. 본문에 없는 값은 비워 두세요.`;

export async function POST(request) {
  if (!isSameOrigin(request)) return forbiddenOrigin();
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body) return json({ error: "공고 내용이 너무 길거나 올바르지 않아요." }, 400);

  const input = sanitizeCustomInput(body);
  if (!input.ok) return json({ error: input.error }, 400);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[custom-jobs/structure] OPENROUTER_API_KEY is not set");
    return json({ error: FAIL_MESSAGE, aiUnavailable: true }, 503);
  }

  const outcome = await requestStructured({
    apiKey,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
    tag: "custom-jobs/structure",
    timeoutsMs: TIMEOUTS_MS,
    accept: (content) => {
      const parsed = parseModelJson(content);
      if (!parsed) return { failure: "parse_failed" };
      const result = normalizeStructured(parsed, input.posting);
      // 업무·조건이 하나도 확인되지 않으면 형식 실패로 보고 (제한적으로) 다시 시도
      return hasStructuredContent(result) ? { value: result } : { failure: "schema_failed" };
    },
  });

  if (outcome.ok) return json({ result: outcome.value });
  // 원인(402·429·OpenRouter 등)은 서버 로그에만. 화면에는 짧은 안내 (입력은 브라우저에 그대로 남아 있음)
  const status = outcome.reason === "rate_limit" ? 429 : outcome.reason === "timeout" ? 504 : 503;
  return json({ error: FAIL_MESSAGE, aiUnavailable: true }, status);
}
