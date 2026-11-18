/**
 * AI 비교 요약 문구 정리 (순수 함수)
 * mainDifference: 공고마다 한 줄씩 "키워드 · 키워드" 형식 (화면에서 A/B/C를 붙여 보여 줌)
 */

// mainDifference: 최대 3문장까지만 (긴 문단 방지, 모델이 줄 형식을 어겼을 때의 fallback)
const MAX_DIFF_SENTENCES = 3;
const limitSentences = (text) => {
  const parts = text.match(/[^.!?]+[.!?]+["')]*\s*|[^.!?]+$/g) ?? [text];
  return parts.slice(0, MAX_DIFF_SENTENCES).join("").trim();
};

// mainDifference 한 줄 정리: 앞의 번호·이름("첫 번째는", "A:", "1.")과 끝의 마침표·"중심" 어미 제거
const MAX_DIFF_LINE = 60;
const DIFF_LABEL = /^\s*(?:[-*•·]\s*)?(?:(?:첫|두|세)\s*번째\s*(?:공고)?\s*(?:는|은)?|[ABC][.:)]|[123][.:)]|공고\s*[ABC123])\s*[:：-]?\s*/;
const cleanDiffLine = (line) =>
  line
    .replace(DIFF_LABEL, "")
    .replace(/\s*(?:중심|위주)?\s*[.。]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DIFF_LINE)
    .trim();

/**
 * mainDifference → 공고별 키워드 줄 (공고 수와 줄 수가 같을 때만, 줄바꿈으로 연결)
 * 모델이 한 문단으로 쓰면 기존처럼 최대 3문장 요약으로 둔다 (화면은 줄 수로 표시 방식을 고름)
 */
export function normalizeMainDifference(text, jobCount) {
  if (typeof text !== "string" || !text.trim()) return "";
  const byNewline = text.split(/\r?\n/).map(cleanDiffLine).filter(Boolean);
  if (byNewline.length === jobCount) return byNewline.join("\n");
  const bySlash = text.split(/\s+\/\s+/).map(cleanDiffLine).filter(Boolean);
  if (bySlash.length === jobCount) return bySlash.join("\n");
  return limitSentences(text.replace(/\s*\n+\s*/g, " ").trim());
}
