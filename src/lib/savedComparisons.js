/**
 * 비교 결과 저장 helper (순수 함수, 네트워크·DB 없음)
 *
 * 저장하는 것: A/B/C 비교 화면을 다시 그리는 데 필요한 "사실" 데이터만 (공고 snapshot 2~3개, 순서 그대로)
 * 저장하지 않는 것: AI 비교 요약, 공고 본문(description), 점수 등 만들어 낸 값
 * 브라우저(요청 전)와 서버(DB 저장 직전·DB에서 읽은 뒤) 모두 같은 함수로 거른다.
 */

import { cleanText, cleanUrl, normalizeJobId } from "./savedJobs.js";
import { pickScheduleFields } from "./schedule.js";

export const MIN_COMPARE_POSTINGS = 2;
export const MAX_COMPARE_POSTINGS = 3;
export const SNAPSHOT_VERSION = 1;

const TEXT_FIELDS = {
  source: 40,
  sourceId: 100,
  company: 100,
  title: 200,
  employmentType: 100,
  career: 100,
  location: 100,
  deadline: 60,
  companyType: 40,
};
// 비교표가 쓰는 목록 필드: [최대 개수, 항목 최대 길이]
const LIST_FIELDS = {
  tasks: [20, 300],
  required: [20, 300],
  preferred: [20, 300],
  keywords: [15, 40],
  employmentTypes: [5, 60], // 사람인 근무형태 목록 (근무형태 분류에 사용)
};

function cleanList(list, maxItems, maxLength) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const v = typeof item === "string" ? cleanText(item, maxLength) : "";
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 공고 1개 → 비교용 snapshot. 값이 없는 항목은 빼고 만들지 않는다.
 * id 또는 공고 제목이 없으면 null
 */
export function toComparisonPosting(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) return null;
  const id = normalizeJobId(job.id);
  const title = cleanText(job.title, TEXT_FIELDS.title);
  if (!id || !title) return null;

  const posting = { id };
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    const v = key === "title" ? title : cleanText(job[key], max);
    if (v) posting[key] = v;
  }
  const originalUrl = cleanUrl(job.originalUrl);
  if (originalUrl) posting.originalUrl = originalUrl;
  for (const [key, [maxItems, maxLength]] of Object.entries(LIST_FIELDS)) {
    const list = cleanList(job[key], maxItems, maxLength);
    if (list.length) posting[key] = list;
  }
  // 모집 일정·근무기간 (있을 때만, 비교표의 모집기간·근무기간 행에 사용)
  Object.assign(posting, pickScheduleFields(job));
  return posting;
}

/**
 * 비교 중인 공고 목록 → 저장할 비교 snapshot { version, postings }
 * 2~3개, 서로 다른 공고만. 하나라도 저장할 수 없으면 null (일부만 저장하지 않음)
 */
export function toComparisonSnapshot(jobs) {
  if (!Array.isArray(jobs)) return null;
  if (jobs.length < MIN_COMPARE_POSTINGS || jobs.length > MAX_COMPARE_POSTINGS) return null;
  const postings = jobs.map(toComparisonPosting);
  if (postings.some((p) => !p)) return null;
  const ids = postings.map((p) => p.id);
  if (new Set(ids).size !== ids.length) return null;
  return { version: SNAPSHOT_VERSION, postings };
}

/**
 * 같은 공고 조합인지 판단하는 키: 순서와 상관없이 같은 공고들이면 같은 값
 * (A/B/C 순서만 다른 비교는 같은 비교로 취급 → DB unique 제약에 사용)
 */
export function comparisonKey(ids) {
  if (!Array.isArray(ids)) return "";
  const list = ids.map(normalizeJobId);
  if (list.some((id) => !id)) return "";
  const unique = [...new Set(list)].sort();
  if (unique.length !== list.length) return "";
  if (unique.length < MIN_COMPARE_POSTINGS || unique.length > MAX_COMPARE_POSTINGS) return "";
  return JSON.stringify(unique);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 저장한 비교 id (uuid)만 허용. 올바르지 않으면 "" */
export function normalizeComparisonId(id) {
  return typeof id === "string" && UUID_RE.test(id.trim()) ? id.trim().toLowerCase() : "";
}

/** 저장 날짜 표시: 한국 시간 기준 "2026. 11. 16." (서버·브라우저 어디서 그려도 같은 값) */
export function formatSavedDate(value) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * DB row → 화면용 저장한 비교. snapshot은 DB에서 읽은 값도 다시 거른다. 깨진 row는 null
 * @returns {{ id: string, postings: object[], savedAt: string, savedDate: string } | null}
 */
export function toSavedComparisonItem(row) {
  const id = normalizeComparisonId(row?.id);
  if (!id) return null;
  const snapshot = toComparisonSnapshot(row.comparison_snapshot?.postings);
  if (!snapshot) return null;
  const savedAt = typeof row.created_at === "string" ? row.created_at : "";
  return { id, postings: snapshot.postings, savedAt, savedDate: formatSavedDate(savedAt) };
}

/**
 * 저장한 비교 → 비교 화면에 넣을 공고 목록 (저장 당시 순서 그대로)
 * 비교 내용은 저장된 snapshot을 그대로 쓰고, 지금 공고 목록에 같은 공고가 있으면
 * 분석 화면에 넘길 본문(description)만 빌려 온다. 공고가 없어져도 비교는 그대로 열린다.
 */
export function restoreCompareJobs(postings, pool = []) {
  const snapshot = toComparisonSnapshot(postings);
  if (!snapshot) return [];
  const live = Array.isArray(pool) ? pool : [];
  return snapshot.postings.map((posting) => {
    const match = live.find((j) => j && j.id === posting.id);
    const description = typeof match?.description === "string" ? match.description : "";
    return description ? { ...posting, description } : posting;
  });
}
