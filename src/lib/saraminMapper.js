/**
 * 사람인 Job Search API 응답 → Career Radar posting 구조 변환 (순수 함수, 네트워크 호출 없음)
 *
 * 사람인 API 승인 전에는 어디에서도 호출하지 않는다. (/api/jobs는 계속 sampleJobs 사용)
 * 승인 후: /api/jobs의 fetchJobs()에서 사람인 응답을 받아 mapSaraminJobs(response)만 거치면
 *          기존 검색·비교·분석 UI가 기대하는 field 그대로 쓸 수 있다.
 *
 * 원칙
 * - 사람인 응답에 없는 정보는 만들지 않는다.
 *   상세 본문(description)과 그 본문에서 나오는 tasks / required / preferred는 API에 없으므로 빈 값.
 * - 기존 UI가 문자열로 읽는 field(company, title, employmentType, career, location, deadline 등)는
 *   값이 없으면 "" (기존 UI는 빈 문자열을 숨기거나 "-"로 표시한다). 표시 문구는 UI에서 처리.
 * - 사람인에만 있는 추가 field(salary, education, industry 등)는 값이 없으면 null, 목록은 [].
 * - 응답 형태가 조금 달라도({ code, name } 객체 / 문자열) 깨지지 않게 방어한다.
 */

export const SARAMIN_SOURCE = "saramin";

// 사람인 close-type 코드 → 표시 문구 (1은 접수 마감일 → 날짜로 D-day 계산)
export const CLOSE_TYPE_LABELS = {
  1: "접수 마감일",
  2: "채용시 마감",
  3: "상시채용",
  4: "수시채용",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ───── 작은 정리 함수들 ─────

const HTML_ENTITIES = { "&gt;": ">", "&lt;": "<", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decodeEntities = (s) => s.replace(/&(gt|lt|amp|quot|#39|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);

/** 문자열이면 entity 해제 + 공백 정리, 아니면 "" */
export const cleanText = (v) =>
  typeof v === "string" || typeof v === "number"
    ? decodeEntities(String(v)).replace(/\s+/g, " ").trim()
    : "";

/** { code, name } 객체 또는 문자열에서 표시 이름 */
const nameOf = (v) => (v && typeof v === "object" ? cleanText(v.name) : cleanText(v));
const codeOf = (v) => (v && typeof v === "object" ? cleanText(v.code) : "");

/**
 * "CRM,마케팅, 데이터분석" → ["CRM", "마케팅", "데이터분석"]
 * 앞뒤 공백 제거, 빈 값 제거, 중복 제거(공백·대소문자 무시, 처음 표기 유지)
 */
export function splitList(value) {
  const raw = Array.isArray(value) ? value.flatMap((v) => cleanText(v).split(",")) : cleanText(value).split(",");
  const seen = new Set();
  const out = [];
  for (const part of raw) {
    const text = part.trim();
    const key = text.replace(/\s+/g, "").toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** "서울 &gt; 강남구" / "서울>강남구" → "서울 > 강남구" (그 외 가공 없음) */
export const cleanLocation = (s) => cleanText(s).replace(/\s*>\s*/g, " > ");

/** 사람인 timestamp(초 단위 문자열/숫자) 또는 날짜 문자열 → ms (없거나 잘못되면 null) */
export function toTimestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n; // 초 단위면 ms로
  }
  // "2026-11-30T23:59:59+0900" 같은 날짜 문자열 (+0900 → +09:00로 맞춤)
  const iso = String(value).trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** 한국 시간 기준 날짜 차이 (마감일 - 오늘) */
const kstDayIndex = (ms) => Math.floor((ms + KST_OFFSET_MS) / DAY_MS);

/**
 * 마감 표시 문구 (기존 sample과 같은 형식: "D-7", "상시채용")
 * - close-type 2/3/4 → "채용시 마감" / "상시채용" / "수시채용"
 * - close-type 1(또는 없음) + 마감 시각 → "D-n" / 당일 "오늘 마감" / 지남 "마감"
 * - 판단할 정보가 없으면 ""
 */
export function formatDeadline({ closeType, expirationMs, now = Date.now() }) {
  const code = Number(closeType);
  if (code === 2 || code === 3 || code === 4) return CLOSE_TYPE_LABELS[code];
  if (expirationMs === null || expirationMs === undefined) return "";
  const days = kstDayIndex(expirationMs) - kstDayIndex(now);
  if (days < 0) return "마감";
  if (days === 0) return "오늘 마감";
  return `D-${days}`;
}

// ───── 공고 하나 / 목록 변환 ─────

/**
 * 사람인 job 1개 → Career Radar posting
 * @param {object} job 사람인 응답의 jobs.job[i]
 * @param {{ now?: number }} [opts] now: D-day 계산 기준 시각 (테스트용)
 * @returns {object|null} id나 title이 없으면 null (목록에서 제외)
 */
export function mapSaraminJob(job, { now = Date.now() } = {}) {
  if (!job || typeof job !== "object") return null;
  const sourceId = cleanText(job.id);
  const position = job.position && typeof job.position === "object" ? job.position : {};
  const title = nameOf(position.title);
  if (!sourceId || !title) return null;

  const closeTypeCode = codeOf(job["close-type"]) || cleanText(job["close-type"]) || null;
  const expirationMs =
    toTimestampMs(job["expiration-timestamp"]) ?? toTimestampMs(job["expiration-date"]);
  const locations = splitList(nameOf(position.location)).map(cleanLocation);
  const employmentTypes = splitList(nameOf(position["job-type"]));
  const experience = position["experience-level"];

  return {
    // ── 기존 UI가 쓰는 field (이름 그대로) ──
    id: `${SARAMIN_SOURCE}-${sourceId}`, // 샘플 id(sample-1 등)·최근 본 공고와 섞여도 겹치지 않게
    company: nameOf(job.company?.detail ?? job.company),
    title,
    employmentType: employmentTypes.join(", "),
    career: nameOf(experience),
    location: locations.join(", "),
    deadline: formatDeadline({ closeType: closeTypeCode, expirationMs, now }),
    keywords: splitList(job.keyword),
    originalUrl: cleanText(job.url),
    source: SARAMIN_SOURCE,
    companyType: "", // 사람인 응답에 없음 → UI에서 표시 안 함

    // 사람인 API에는 상세 본문이 없다. 제목·키워드로 추측해서 만들지 않는다.
    description: "",
    tasks: [],
    required: [],
    preferred: [],

    // ── 사람인 추가 정보 (없으면 null / []) ──
    sourceId,
    active: job.active === undefined ? null : Number(job.active) === 1,
    employmentTypes,
    locations,
    industry: nameOf(position.industry) || null,
    jobCategory: nameOf(position["job-mid-code"]) || null,
    jobCodes: splitList(nameOf(position["job-code"])),
    experienceLevel:
      experience && typeof experience === "object"
        ? {
            code: cleanText(experience.code) || null,
            min: Number.isFinite(Number(experience.min)) && experience.min !== "" ? Number(experience.min) : null,
            max: Number.isFinite(Number(experience.max)) && experience.max !== "" ? Number(experience.max) : null,
          }
        : null,
    education: nameOf(position["required-education-level"]) || null,
    salary: nameOf(job.salary) || null,
    closeType: closeTypeCode,
    closeTypeName: closeTypeCode ? (CLOSE_TYPE_LABELS[Number(closeTypeCode)] ?? nameOf(job["close-type"]) ?? null) : null,
    postingTimestamp: toTimestampMs(job["posting-timestamp"]) ?? toTimestampMs(job["posting-date"]),
    openingTimestamp: toTimestampMs(job["opening-timestamp"]),
    expirationTimestamp: expirationMs,
  };
}

/**
 * 사람인 응답 전체 또는 job 배열 → posting 배열 (변환할 수 없는 항목은 제외)
 * 사람인 응답 형태: { jobs: { count, start, total, job: [...] } }
 */
export function mapSaraminJobs(response, opts) {
  const list = Array.isArray(response)
    ? response
    : Array.isArray(response?.jobs?.job)
      ? response.jobs.job
      : response?.jobs?.job && typeof response.jobs.job === "object"
        ? [response.jobs.job] // 결과 1건일 때 객체로 오는 경우 대비
        : [];
  return list.map((job) => mapSaraminJob(job, opts)).filter(Boolean);
}
