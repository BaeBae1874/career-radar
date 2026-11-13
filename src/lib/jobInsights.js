/**
 * 공고 구조화 데이터(employmentType, career, required, preferred, tasks, keywords, location)만으로
 * 계산하는 보조 정보. AI 호출 없음, 순수 함수.
 *
 * 원칙: 문장을 "해석"하지 않는다. 명확한 패턴이 있을 때만 짧은 표현으로 옮기고,
 *       애매하면 아무것도 만들지 않는다. (잘못된 정보보다 표시하지 않는 쪽을 택함)
 */

const MAX_CHECK_POINTS = 2;
const MAX_COMPARE_POINTS = 3;

const strings = (list) =>
  Array.isArray(list) ? list.filter((t) => typeof t === "string" && t.trim()) : [];

// 우대사항에서 찾을 도구·기술 이름 (원문에 단어로 등장할 때만 "X 우대")
const PREFERRED_TOOLS = [
  "SQL",
  "Python",
  "GA4",
  "Figma",
  "TypeScript",
  "Next.js",
  "React",
  "Tableau",
  "Power BI",
  "Photoshop",
  "Illustrator",
  "Airflow",
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text, word) =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRe(word)}(?![A-Za-z0-9])`, "i").test(text);

/**
 * 자격요건(required)에서만 뽑는 짧은 조건 표현 (원문 패턴이 명확할 때만)
 * 순서: 근무 기간 → 포트폴리오 → 학력 → 졸업 예정자
 */
export function getRequiredPoints(job) {
  const required = strings(job?.required);
  const points = [];
  const add = (label) => {
    if (label && !points.includes(label)) points.push(label);
  };
  // 근무 기간: "6개월 근무 가능", "계약기간 12개월 근무" → "6개월 근무"
  for (const t of required) {
    const m = t.match(/(\d{1,2})\s*개월\s*(?:이상\s*)?근무/);
    if (m) {
      add(`${m[1]}개월 근무`);
      break;
    }
  }
  // 포트폴리오: 자격요건(필수)에 있을 때만 "포트폴리오 필수"
  if (required.some((t) => t.includes("포트폴리오"))) add("포트폴리오 필수");
  // 학력: "학사 이상" 등 원문 표현 그대로
  for (const t of required) {
    const m = t.match(/(전문학사|학사|석사|박사|초대졸|대졸)\s*이상/);
    if (m) {
      add(`${m[1]} 이상`);
      break;
    }
  }
  if (required.some((t) => /졸업\s*예정자/.test(t))) add("졸업 예정자 지원 가능");
  return points;
}

/** 우대사항(preferred)에 단어로 등장하는 도구 이름들 (목록 순서) */
export function getPreferredTools(job) {
  const preferred = strings(job?.preferred);
  return PREFERRED_TOOLS.filter((tool) => preferred.some((t) => hasWord(t, tool)));
}

/**
 * 공고 카드용 핵심 체크 포인트 (최대 2개)
 * 우선순위: ① 특별한 필수조건(근무 기간) ② 포트폴리오 ③ 학력/졸업 조건 ④ 인턴·계약직 ⑤ 우대 도구
 * @returns {string[]}
 */
export function getCheckPoints(job) {
  if (!job) return [];
  const points = [...getRequiredPoints(job)];
  if ((job.employmentType === "인턴" || job.employmentType === "계약직") && !points.includes(job.employmentType)) {
    points.push(job.employmentType);
  }
  const [tool] = getPreferredTools(job);
  if (tool) points.push(`${tool} 우대`);
  return points.slice(0, MAX_CHECK_POINTS);
}

const norm = (t) => String(t ?? "").replace(/\s+/g, "").toLowerCase();
const setKey = (list) => [...new Set(strings(list).map(norm))].sort().join("|");
const differs = (jobs, pick) => new Set(jobs.map(pick)).size > 1;

/**
 * 선택한 공고들 사이에서 값이 다른 항목 이름 (최대 3개, 억지로 채우지 않음)
 * 순서: 근무형태 → 필수조건 → 주요업무 → 경력조건 → 우대사항 → 근무지역
 * @returns {string[]}
 */
export function getComparePoints(jobs) {
  const list = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  if (list.length < 2) return [];

  // 주요업무: 업무 문장이 서로 다르고, 모든 공고에 공통인 키워드가 하나도 없을 때만 "확실히 다름"
  const tasksDiffer = differs(list, (j) => setKey(j.tasks));
  const keywordSets = list.map((j) => new Set(strings(j.keywords).map(norm)));
  const [firstKeys, ...restKeys] = keywordSets;
  const sharesKeyword = [...firstKeys].some((k) => restKeys.every((s) => s.has(k)));

  const checks = [
    ["근무형태", differs(list, (j) => norm(j.employmentType))],
    ["필수조건", differs(list, (j) => setKey(j.required))],
    ["주요업무", tasksDiffer && !sharesKeyword],
    ["경력조건", differs(list, (j) => norm(j.career))],
    ["우대사항", differs(list, (j) => setKey(j.preferred))],
    ["근무지역", differs(list, (j) => norm(j.location))],
  ];
  return checks
    .filter(([, isDifferent]) => isDifferent)
    .map(([label]) => label)
    .slice(0, MAX_COMPARE_POINTS);
}

// ───── 비교 화면: 공고별 핵심 포인트 ─────

export const MAX_HIGHLIGHTS = 3;
const MAX_HIGHLIGHT_KEYWORDS = 2;

/**
 * 선택한 공고들 사이에서 "이 공고에만 있는" 특징을 공고마다 최대 3개 (AI 없음, 단순 비교)
 * 우선순위: ① 다른 공고와 다른 근무형태 ② 이 공고에만 있는 필수조건 ③ 이 공고에만 있는 키워드(최대 2개를 한 줄로)
 *           ④ 주요업무: 문장을 줄이거나 다시 쓰지 않기 위해 사용하지 않음 (키워드로 대신)
 *           ⑤ 이 공고에만 있는 우대 도구 ("X 우대")
 * 고유성: 공백·대소문자만 무시. 의미가 비슷해도 다른 표현이면 다른 것으로 본다 ("콘텐츠" ≠ "콘텐츠 마케팅")
 * 필수(required)와 우대(preferred)는 따로 뽑으므로 섞이지 않는다.
 * @returns {{ id: string, points: { text: string, kind: "type" | "required" | "keyword" | "preferred" }[] }[]}
 */
export function getPostingHighlights(jobs) {
  const list = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  if (list.length < 2) return list.map((j) => ({ id: j.id, points: [] }));

  const types = list.map((j) => norm(j.employmentType));
  const reqSets = list.map((j) => getRequiredPoints(j));
  const kwSets = list.map((j) => strings(j.keywords));
  const toolSets = list.map((j) => getPreferredTools(j));
  // 다른 공고들에 같은 값(정규화 기준)이 하나라도 있으면 고유하지 않음
  const onlyHere = (sets, i, value) =>
    !sets.some((other, k) => k !== i && other.some((v) => norm(v) === norm(value)));

  return list.map((job, i) => {
    const points = [];
    const add = (text, kind) => {
      if (!text || points.length >= MAX_HIGHLIGHTS) return;
      if (points.some((p) => norm(p.text) === norm(text))) return; // 중복 제거
      points.push({ text, kind });
    };

    if (types[i] && types.every((t, k) => k === i || t !== types[i])) add(job.employmentType.trim(), "type");
    reqSets[i].filter((r) => onlyHere(reqSets, i, r)).forEach((r) => add(r, "required"));
    // 이 공고에만 있는 키워드 (같은 키워드가 두 번 있으면 처음 표기만)
    const uniqueKw = [];
    for (const k of kwSets[i]) {
      if (onlyHere(kwSets, i, k) && !uniqueKw.some((u) => norm(u) === norm(k))) uniqueKw.push(k.trim());
    }
    if (uniqueKw.length) add(uniqueKw.slice(0, MAX_HIGHLIGHT_KEYWORDS).join(" · "), "keyword");
    const tool = toolSets[i].find((t) => onlyHere(toolSets, i, t));
    if (tool) add(`${tool} 우대`, "preferred");

    return { id: job.id, points };
  });
}

// ───── 최근 본 공고 (저장소와 분리된 순수 로직) ─────

export const MAX_RECENT = 5;
// 다시 표시하고 분석 화면을 열 수 있는 최소 필드 (description은 분석 입력용)
const RECENT_FIELDS = [
  "id",
  "company",
  "title",
  "employmentType",
  "career",
  "location",
  "deadline",
  "originalUrl",
  "description",
];
const MAX_DESCRIPTION = 15000;

export function toRecentSnapshot(job) {
  if (!job || typeof job.id !== "string" || !job.id || typeof job.title !== "string") return null;
  const snap = {};
  for (const k of RECENT_FIELDS) snap[k] = typeof job[k] === "string" ? job[k] : "";
  snap.description = snap.description.slice(0, MAX_DESCRIPTION);
  snap.keywords = strings(job.keywords).slice(0, 10);
  return snap;
}

/** 같은 공고는 하나만 남기고 맨 앞으로, 최대 MAX_RECENT개 */
export function pushRecent(list, job) {
  const snap = toRecentSnapshot(job);
  const prev = Array.isArray(list) ? list.filter((j) => j && typeof j.id === "string") : [];
  if (!snap) return prev.slice(0, MAX_RECENT);
  // 같은 공고의 이전 기록에만 있는 값(예: 본문)은 유지 → 정보가 적은 화면에서 기록해도 손실 없음
  const old = prev.find((j) => j.id === snap.id);
  if (old) {
    for (const k of Object.keys(snap)) {
      const empty = Array.isArray(snap[k]) ? !snap[k].length : !snap[k];
      if (empty && old[k]) snap[k] = old[k];
    }
  }
  return [snap, ...prev.filter((j) => j.id !== snap.id)].slice(0, MAX_RECENT);
}
