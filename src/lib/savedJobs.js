/**
 * 관심 공고 저장 helper (순수 함수, 네트워크·DB 없음)
 * - 저장할 공고 요약(job_snapshot) 만들기: 화면에 다시 보여 줄 최소 정보만, 없는 값은 만들지 않음
 * - job_id / 조회용 id 목록 검증
 * - 비로그인 저장 클릭 → 로그인 경로
 * 브라우저(저장 요청 전)와 서버(DB 저장 직전) 양쪽에서 같은 함수를 쓴다. 서버는 클라이언트 값을 믿지 않고 다시 거른다.
 */

import { getSafeNextPath } from "./authForm.js";
import { pickScheduleFields } from "./schedule.js";

export const MAX_JOB_ID_LENGTH = 200;
/** 저장 상태를 한 번에 조회할 수 있는 공고 수 (검색 결과 1페이지보다 넉넉하게) */
export const MAX_STATUS_IDS = 100;
export const MAX_SNAPSHOT_KEYWORDS = 10;

const TEXT_LIMITS = {
  source: 40,
  sourceId: 100,
  company: 100,
  title: 200,
  employmentType: 100,
  career: 100,
  location: 100,
  deadline: 60,
};
const MAX_KEYWORD_LENGTH = 40;
const MAX_TASK_LENGTH = 300;
const MAX_URL_LENGTH = 2000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** 앞뒤 공백 제거, 줄바꿈 등은 공백 하나로. 문자열이 아니거나 비면 "" */
export function cleanText(value, max) {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

/** 저장 키로 쓸 공고 id. 올바르지 않으면 "" */
export function normalizeJobId(id) {
  if (typeof id !== "string") return "";
  const value = id.trim();
  if (!value || value.length > MAX_JOB_ID_LENGTH || CONTROL_CHARS.test(value)) return "";
  return value;
}

/** 저장 상태 조회용 id 목록: 올바른 id만, 중복 없이, 최대 MAX_STATUS_IDS개 */
export function normalizeJobIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const v = normalizeJobId(id);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_STATUS_IDS) break;
  }
  return out;
}

/** 원문 링크: http(s) 주소만 (javascript: 등은 저장하지 않음) */
export function cleanUrl(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function cleanKeywords(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const k of list) {
    const v = typeof k === "string" ? cleanText(k, MAX_KEYWORD_LENGTH) : "";
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_SNAPSHOT_KEYWORDS) break;
  }
  return out;
}

/** 저장함 row의 "하는 일": 이미 요약된 firstTask가 있으면 그것, 아니면 tasks의 첫 번째 */
function pickFirstTask(job) {
  const own = cleanText(job.firstTask, MAX_TASK_LENGTH);
  if (own) return own;
  if (!Array.isArray(job.tasks)) return "";
  for (const t of job.tasks) {
    const v = cleanText(t, MAX_TASK_LENGTH);
    if (v) return v;
  }
  return "";
}

/**
 * 공고 객체 → 저장용 최소 요약 (job_snapshot)
 * 본문(description)·자격요건 전체 등은 넣지 않는다. 값이 없는 항목은 아예 빼고, 임의로 채우지 않는다.
 * id 또는 직무명이 없으면 null (저장 불가)
 */
export function toSavedSnapshot(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) return null;
  const id = normalizeJobId(job.id);
  const title = cleanText(job.title, TEXT_LIMITS.title);
  if (!id || !title) return null;

  const snapshot = { id };
  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    const v = key === "title" ? title : cleanText(job[key], max);
    if (v) snapshot[key] = v;
  }
  const originalUrl = cleanUrl(job.originalUrl);
  if (originalUrl) snapshot.originalUrl = originalUrl;
  const keywords = cleanKeywords(job.keywords);
  if (keywords.length) snapshot.keywords = keywords;
  const firstTask = pickFirstTask(job);
  if (firstTask) snapshot.firstTask = firstTask;
  // 모집 일정·근무기간: 있을 때만 (없으면 키를 넣지 않아 예전 저장 데이터와 같은 모양)
  Object.assign(snapshot, pickScheduleFields(job));
  return snapshot;
}

/**
 * DB row → 화면용 저장 공고. snapshot은 DB에서 읽은 값도 다시 거른다.
 * job_id와 snapshot이 맞지 않거나 깨진 row는 null (화면에서 제외)
 */
export function toSavedItem(row) {
  const jobId = normalizeJobId(row?.job_id);
  if (!jobId) return null;
  const raw = row.job_snapshot && typeof row.job_snapshot === "object" ? row.job_snapshot : {};
  const snapshot = toSavedSnapshot({ ...raw, id: jobId });
  if (!snapshot) return null;
  return {
    jobId,
    job: snapshot,
    savedAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** Postgres unique 위반(이미 저장됨) */
export const isUniqueViolation = (error) => error?.code === "23505";

/** 비로그인 저장 클릭 → 로그인 후 지금 화면으로 돌아오는 경로 (외부 주소는 "/"로) */
export function buildLoginHref(currentPath) {
  const next = getSafeNextPath(currentPath, "/");
  return `/login?next=${encodeURIComponent(next)}`;
}
