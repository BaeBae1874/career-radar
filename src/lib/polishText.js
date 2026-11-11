/**
 * AI가 만든 한국어 문장을 사용자에게 보여주기 직전에 가볍게 정리한다. (표시용 정리만, 의미·사실은 바꾸지 않음)
 *
 * 안전장치
 * - 한글이 없는 문자열(영문 도구명·약어만 있는 값)은 손대지 않는다.
 * - source(공고 원문/입력 데이터)에 실제로 등장하는 영어 단어는 바꾸지 않는다.
 *   → 공고 제목·회사명·도구명에 쓰인 표현이 손상되지 않도록
 * - 단어 경계(앞뒤가 영문자가 아닌 경우)에서만 바꾼다. (예: "vsCode", "Canvas"는 그대로)
 * - CRM, SQL, GA4, ROAS 같은 정상 약어는 대상 목록에 없으므로 그대로 둔다.
 */

const HANGUL = /[가-힣]/;

// 문장 끝 어미 중복: "있어요~해요." → "있어요." (물결로 이어 붙은 꼬리만)
const DUP_ENDING = /요\.?\s*[~∼〜]+\s*[가-힣]{0,3}요(?=\s*[.!?。]|\s*$)/g;

/**
 * 모델 토큰 깨짐: 한글 음절 바로 뒤에 영어 조각이 붙은 형태 ("글riting", "어assistant")
 * - 모든 한글+영어 조합을 지우는 일반 regex는 쓰지 않는다. (GA4 활용, Meta광고 같은 정상 표현 보호)
 * - 실제로 확인된/명백한 조합만 명시적으로 고친다.
 * - 원문(source)에 같은 문자열이 있으면 고치지 않는다.
 */
const BROKEN_TOKENS = [
  { re: /글w?riting(?![A-Za-z])/g, to: "글쓰기" },
  { re: /카피w?riting(?![A-Za-z])/g, to: "카피라이팅" },
  { re: /어assistant(?![A-Za-z])/g, to: "어시스턴트" },
  { re: /마케ting(?![A-Za-z])/g, to: "마케팅" },
];

/** 영어 filler → 자연스러운 한국어. 앞의 규칙이 먼저 적용된다. */
const FILLER_RULES = [
  // "assistant 수준"처럼 한국어 문장 속 소문자 assistant (원문에 없는 경우만)
  { word: "assistant", re: /(?<=[가-힣]|^|\s)assistant(?![A-Za-z])/g, to: "어시스턴트" },
  // 문장 끝 unclear → "명확하지 않아요", 그 밖의 unclear → "불명확한"
  { word: "unclear", re: /(?<![A-Za-z])unclear(?![A-Za-z])(?=\s*[.!?]|\s*$)/gi, to: "명확하지 않아요" },
  { word: "unclear", re: /(?<![A-Za-z])unclear(?![A-Za-z])/gi, to: "불명확한" },
  { word: "required", re: /(?<![A-Za-z])required(?![A-Za-z])/gi, to: "필수" },
  { word: "preferred", re: /(?<![A-Za-z])preferred(?![A-Za-z])/gi, to: "우대" },
  { word: "but", re: /(?<![A-Za-z])but(?![A-Za-z])/gi, to: "하지만" },
  { word: "versus", re: /\s*(?<![A-Za-z])versus(?![A-Za-z])\s*/gi, to: " ↔ " },
  { word: "vs", re: /\s*(?<![A-Za-z])vs\.?(?![A-Za-z])\s*/gi, to: " ↔ " },
];

const wordIn = (source, word) =>
  new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, "i").test(source);

/**
 * @param {string} text   AI가 만든 문장
 * @param {string} source 비교 기준 원문 (공고 본문, 비교 대상 공고 데이터 등)
 */
export function polishText(text, source = "") {
  if (typeof text !== "string") return text;
  if (!HANGUL.test(text)) return text.trim();

  let out = text.replace(DUP_ENDING, "요");
  for (const { re, to } of BROKEN_TOKENS) {
    out = out.replace(re, (m) => (source.includes(m) ? m : to));
  }
  for (const rule of FILLER_RULES) {
    if (!rule.always && wordIn(source, rule.word)) continue; // 원문에 있는 표현은 보존
    out = out.replace(rule.re, rule.to);
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

export const polishList = (list, source) =>
  Array.isArray(list) ? list.map((t) => polishText(t, source)) : list;
