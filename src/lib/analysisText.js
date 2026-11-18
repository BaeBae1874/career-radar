/**
 * AI 분석 문구 정리 (순수 함수)
 * unclearPoints(확인하고 지원하세요): 모델이 규칙을 어겨도 걸러내는 좁은 안전망
 * - "불명확한 부분이 없다"는 식의 빈 항목 제거 (항목이 없으면 화면이 "발견되지 않았어요"를 보여 줌)
 * - 공고에 이미 적힌 업무·필수·우대 조건을 글자 그대로 다시 "확인 필요"로 쓴 항목 제거
 * 의미 있는 문장을 지우지 않도록 명백한 형태만 잡는다.
 */

const compact = (t) => String(t ?? "").replace(/[\s.·,]/g, "").toLowerCase();

const NOTHING_UNCLEAR = [
  /^(없음|해당\s*없음|없습니다|없어요)\.?$/,
  /(특별히|별도로|추가로)?\s*(불명확|확인(이|할)?\s*필요)한?\s*(부분|점|항목|내용)(은|이)?\s*(없|발견되지)/,
  /명확하지\s*않은\s*(부분|점)(은|이)?\s*없/,
];

// "~의 (구체적인) 수준/숙련도는 명시되지 않았어요"처럼 숙련도 세부 수준만 묻는 항목 (거의 모든 공고에 해당 → 판단에 도움이 적음)
// 기술 이름을 나열하지 않고 문장 형태로만 잡는다
const LEVEL_ONLY = /(수준|숙련도|숙련\s*정도|능숙도|이해도|활용\s*능력)[은는이가]?\s*(공고에\s*)?(명시|적혀|나와|제시|기재)[^.]{0,6}(않|없)/;
// 예외: 공고가 요구 수준 자체를 모호하게 적은 경우(고급·숙련자·실무 수준 등)는 지원 판단에 영향 → 유지
const VAGUE_LEVEL_IN_POSTING = /고급|숙련자|능숙|실무\s*수준|중급|상급|전문가\s*수준/;
// 계약·근무 조건, 채용 절차, 업무 범위처럼 중요한 내용이 함께 있으면 유지
const IMPORTANT_TOPIC = /전환|기간|위치|근무지|재택|출근|근무\s*시간|계약|절차|전형|면접|포트폴리오|필수인지|필수\s*여부|충돌|서로\s*다르|업무\s*범위/;

export function filterUnclearPoints(points, { tasks = [], required = [], preferred = [] } = {}) {
  if (!Array.isArray(points)) return [];
  const stated = new Set([...tasks, ...required, ...preferred].map(compact).filter(Boolean));
  const seen = new Set();
  return points.filter((p) => {
    if (typeof p !== "string" || !p.trim()) return false;
    const text = p.trim();
    if (NOTHING_UNCLEAR.some((re) => re.test(text))) return false;
    if (LEVEL_ONLY.test(text) && !IMPORTANT_TOPIC.test(text) && !VAGUE_LEVEL_IN_POSTING.test(text)) return false;
    const key = compact(text);
    if (stated.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ───── 비슷한 직무: 지금 직무와 사실상 같은 직무 제외 ─────

// 경력 단계·고용 형태만 다른 표현 (같은 직무로 봄)
const LEVEL_WORDS = /인턴(십)?|주니어|신입|시니어|경력(직)?|사원|담당자|어시스턴트|채용|모집|\(.*?\)|\[.*?\]/g;
// 직무명 끝의 사람 표현: 분석가 = 분석, 개발자 = 개발
const PERSON_SUFFIX = /(가|자|원|사)$/;
// 앞에 붙은 기술 스택 이름: 소문자가 섞인 영문(React, Vue.js, Node.js)만. "React 프론트엔드 개발자" = "프론트엔드 개발자"
// BI·UI·QA·CRM처럼 전부 대문자인 약어는 직무 성격을 바꾸므로 남긴다 ("BI 분석가" ≠ "분석가")
const LEADING_STACK = /^(?:[A-Za-z0-9.+#/-]*[a-z][A-Za-z0-9.+#/-]*\s+)+/;

const squash = (t) => {
  const v = t.replace(/\s/g, "").toLowerCase();
  const withoutSuffix = v.replace(PERSON_SUFFIX, "");
  return withoutSuffix.length >= 2 ? withoutSuffix : v;
};

/**
 * 직무명 → 비교용 핵심 (경력 단계·끝의 사람 표현 제거, 앞의 기술 스택 이름은 뺀 형태도 함께)
 * @returns {string[]} 이 직무를 가리키는 핵심 표현 1~2개
 */
export function roleKeys(name) {
  if (typeof name !== "string") return [];
  const base = name.replace(LEVEL_WORDS, " ").replace(/\s+/g, " ").trim();
  if (!base) return [];
  const keys = [squash(base)];
  const withoutStack = base.replace(LEADING_STACK, "").trim();
  if (withoutStack && withoutStack !== base && withoutStack.replace(/\s/g, "").length >= 2) {
    keys.push(squash(withoutStack));
  }
  return [...new Set(keys)];
}

/** 분석 입력 첫 줄의 "공고명: …" (검색 공고에서 넘어온 경우). 없으면 "" */
export function postingTitle(jobPosting) {
  if (typeof jobPosting !== "string") return "";
  const m = jobPosting.match(/^\s*공고명\s*[:：]\s*(.+)$/m);
  return m ? m[1].trim().slice(0, 100) : "";
}

/**
 * 지금 직무와 핵심이 같은 직무(예: "데이터 분석 인턴" ↔ "데이터 분석가", "프론트엔드 개발자" ↔ "React 프론트엔드 개발자") 제외.
 * 핵심 표현이 같을 때만 빼므로, 이름이 비슷해도 역할이 다른 직무(데이터 엔지니어, BI 분석가 등)는 남는다.
 */
export function filterSimilarRoles(roles, currentTitles = []) {
  if (!Array.isArray(roles)) return [];
  const current = new Set(currentTitles.flatMap(roleKeys));
  const seen = new Set();
  return roles.filter((r) => {
    const keys = roleKeys(r?.name);
    if (!keys.length || keys.some((k) => current.has(k) || seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}
