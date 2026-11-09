/**
 * 채용공고 본문(description)에서 비교용 구조화 필드(tasks / required / preferred)를 뽑아낸다.
 * 사람인 API 연동 후에도 본문 텍스트만 있으면 같은 방식으로 재사용할 수 있다.
 */
const SECTION_HEADINGS = {
  tasks: ["주요업무", "담당업무", "업무내용"],
  required: ["자격요건", "지원자격", "필수조건"],
  preferred: ["우대사항", "우대조건"],
};

const toHeadingKey = (line) => {
  const compact = line.replace(/[\s[\]【】:：■□●○▶·]/g, "");
  return Object.keys(SECTION_HEADINGS).find((key) => SECTION_HEADINGS[key].includes(compact));
};

export function extractSections(description) {
  const sections = { tasks: [], required: [], preferred: [] };
  let current = null;
  for (const raw of String(description ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = toHeadingKey(line);
    if (heading) {
      current = heading;
      continue;
    }
    if (current) {
      const item = line.replace(/^(?:[-*•·▪]|\d+[.)])\s*/, "").trim();
      if (item) sections[current].push(item);
    }
  }
  return sections;
}
