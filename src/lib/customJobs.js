/**
 * 직접 추가한 공고 helper (순수 함수, 네트워크·DB 없음)
 *
 * - 사용자가 붙여넣은 공고: 회사명·공고명·본문 길이 확인 (본문은 이번 세션의 분석에만 쓰고 DB에는 저장하지 않음)
 * - AI 구조화 결과: 공고 본문에서 실제로 확인되는 값만 남김 (추측한 값은 버림)
 * - 저장용 snapshot: 비교·분석에 쓰는 사실 필드만 (savedComparisons의 toComparisonPosting 재사용)
 * - 비교에 담기: 기존 sessionStorage 비교 상태(compareIds / compareSnapshots)에 그대로 추가
 * 화면은 React가 글자로만 그리므로 HTML은 실행되지 않지만, 태그는 저장 전에 지운다.
 */

import { cleanText } from "./savedJobs.js";
import { MAX_COMPARE_POSTINGS, toComparisonPosting } from "./savedComparisons.js";
import { daysUntil, kstToday, normalizeIsoDate, normalizeWorkPeriod } from "./schedule.js";

export const CUSTOM_SOURCE = "custom";
export const CUSTOM_ID_PREFIX = "custom-";
export const LIMITS = {
  company: 100,
  title: 200,
  posting: 15000,
  listItems: 20,
  listItemLength: 300,
  keywords: 10,
  keywordLength: 40,
  shortText: 100,
};

const LIST_FIELDS = ["tasks", "required", "preferred"];
const TEXT_FIELDS = ["employmentType", "career", "location", "deadline"];

// ───── 입력 정리 ─────

/** HTML 태그·스크립트 흔적 제거 (글자는 남김) */
export function stripTags(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/javascript\s*:/gi, "");
}

const cleanField = (value, max) => cleanText(stripTags(value), max);

/** 본문: 줄바꿈은 유지하고 태그만 제거 (공백 줄 정리) */
function cleanPosting(value) {
  if (typeof value !== "string") return "";
  return stripTags(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 붙여넣은 공고 입력 확인
 * @returns {{ ok: true, company: string, title: string, posting: string } | { ok: false, error: string }}
 */
export function sanitizeCustomInput(input) {
  const raw = input && typeof input === "object" ? input : {};
  const rawPosting = typeof raw.posting === "string" ? raw.posting : "";
  if (rawPosting.length > LIMITS.posting) {
    return { ok: false, error: `공고 내용은 ${LIMITS.posting.toLocaleString()}자 이내로 넣어 주세요.` };
  }
  if (typeof raw.company === "string" && raw.company.trim().length > LIMITS.company) {
    return { ok: false, error: `회사명은 ${LIMITS.company}자 이내로 넣어 주세요.` };
  }
  if (typeof raw.title === "string" && raw.title.trim().length > LIMITS.title) {
    return { ok: false, error: `공고명은 ${LIMITS.title}자 이내로 넣어 주세요.` };
  }
  const company = cleanField(raw.company, LIMITS.company);
  const title = cleanField(raw.title, LIMITS.title);
  const posting = cleanPosting(rawPosting);
  if (!company) return { ok: false, error: "회사명을 입력해 주세요." };
  if (!title) return { ok: false, error: "공고명을 입력해 주세요." };
  if (posting.length < 20) return { ok: false, error: "공고 내용을 붙여넣어 주세요." };
  return { ok: true, company, title, posting };
}

// ───── AI 구조화 결과 정리 (추측 차단) ─────

const EMPTY_WORDS = /^(없음|해당\s*없음|미기재|정보\s*없음|명시\s*안\s*됨|명시되지\s*않음|확인\s*불가|알\s*수\s*없음|n\/?a|null|none|-)$/i;
const squash = (t) => String(t).toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

/**
 * 공고 본문에서 직접 확인되는 값인지 (AI가 일반 지식으로 채운 값 차단)
 * 글자 그대로 들어 있거나, 의미 있는 단어의 대부분(70% 이상)이 본문에 있을 때만 true
 */
export function appearsInPosting(value, posting) {
  if (typeof value !== "string" || typeof posting !== "string") return false;
  const v = squash(value);
  const p = squash(posting);
  if (!v || !p) return false;
  if (p.includes(v)) return true;
  const words = value
    .split(/[\s,·/()[\]{}「」"'“”‘’:;.!?-]+/)
    .map(squash)
    .filter((w) => w.length >= 2);
  if (words.length < 2) return false;
  const hit = words.filter((w) => p.includes(w)).length;
  return hit / words.length >= 0.7;
}

// 한 항목 안에 줄바꿈·세미콜론·글머리표(•▪)로 명확히 나뉜 조건만 나눈다 (문장 해석·단위 변경 없음)
const SAFE_SPLIT = /\r?\n+|\s*;\s*|\s+[•▪]\s+/;
const splitSafe = (item) => (typeof item === "string" ? item.split(SAFE_SPLIT) : [item]);

function cleanVerifiedList(list, posting, maxItems, maxLength) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list.flatMap(splitSafe)) {
    const v = typeof item === "string" ? cleanField(item.replace(/^\s*(?:[-*•·▪]|\d+[.)])\s*/, ""), maxLength) : "";
    if (!v || EMPTY_WORDS.test(v) || out.includes(v)) continue;
    if (!appearsInPosting(v, posting)) continue;
    out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanVerifiedText(value, posting) {
  const v = cleanField(value, LIMITS.shortText);
  if (!v || EMPTY_WORDS.test(v)) return "";
  return appearsInPosting(v, posting) ? v : "";
}

// ───── 모집 일정·근무기간 확인 (본문에 적힌 날짜·기간만) ─────

const monthDayPattern = (m, d) => `(?<!\\d)0?${m}\\s*(?:월|[./-])\\s*0?${d}(?!\\d)`;

/**
 * AI가 준 접수 날짜("YYYY-MM-DD")가 본문에 실제로 적혀 있는지 확인하고 날짜를 확정한다.
 * - 월·일이 본문에 없으면 "" (추측한 날짜 버림)
 * - 연도가 본문에 함께 적혀 있으면 그 연도, 없으면 서버가 정함: 올해(한국 날짜) 기준, 60일 넘게 지난 날짜면 내년
 */
export function verifyApplicationDate(value, posting, now = Date.now()) {
  const iso = normalizeIsoDate(value);
  if (!iso || typeof posting !== "string") return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!new RegExp(monthDayPattern(m, d)).test(posting)) return "";
  const withYear = new RegExp(`${y}\\s*(?:년|[./-])\\s*${monthDayPattern(m, d)}`);
  if (withYear.test(posting)) return iso;
  const thisYear = Number(kstToday(now).slice(0, 4));
  const mmdd = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const candidate = `${thisYear}-${mmdd}`;
  const days = daysUntil(candidate, now);
  if (days === null) return "";
  return days < -60 ? normalizeIsoDate(`${thisYear + 1}-${mmdd}`) : candidate;
}

// 마감 방식은 본문에 그 표현이 있을 때만
const CLOSE_TYPE_EVIDENCE = {
  rolling: /채용\s*시\s*(까지|마감)/,
  always: /상시\s*(채용|모집|접수)/,
  occasional: /수시\s*(채용|모집|접수)/,
};

function verifyCloseType(value, posting, hasEnd) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "deadline") return hasEnd ? "deadline" : "";
  const re = CLOSE_TYPE_EVIDENCE[v];
  return re && re.test(posting) ? v : "";
}

/** 근무기간: 본문에 적힌 구체적인 기간만, 접수 날짜를 근무기간으로 잘못 넣은 경우는 버림 */
function verifyWorkPeriod(value, posting, applicationDates) {
  const v = normalizeWorkPeriod(stripTags(typeof value === "string" ? value : ""));
  if (!v || !appearsInPosting(v, posting)) return "";
  for (const iso of applicationDates.filter(Boolean)) {
    const [, m, d] = iso.split("-").map(Number);
    if (new RegExp(monthDayPattern(m, d)).test(v)) return "";
  }
  return v;
}

/**
 * AI가 정리한 결과 → 미리보기용 구조 (본문에서 확인되지 않는 값은 빈 값)
 * @returns {{ tasks: string[], required: string[], preferred: string[], keywords: string[],
 *   employmentType: string, employmentTypes: string[], career: string, location: string, deadline: string }}
 */
export function normalizeStructured(raw, posting, { now = Date.now() } = {}) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of LIST_FIELDS) {
    out[key] = cleanVerifiedList(r[key], posting, LIMITS.listItems, LIMITS.listItemLength);
  }
  out.keywords = cleanVerifiedList(r.keywords, posting, LIMITS.keywords, LIMITS.keywordLength);
  for (const key of TEXT_FIELDS) out[key] = cleanVerifiedText(r[key], posting);
  const types = cleanVerifiedList(r.employmentTypes, posting, 5, 60);
  out.employmentTypes = types.length ? types : out.employmentType ? [out.employmentType] : [];
  if (!out.employmentType && out.employmentTypes.length) out.employmentType = out.employmentTypes.join(", ");
  // 모집 일정 (지원 접수 시작·마감) — 근무기간과 섞지 않음
  out.applicationStartDate = verifyApplicationDate(r.applicationStartDate, posting, now);
  out.applicationEndDate = verifyApplicationDate(r.applicationEndDate, posting, now);
  if (out.applicationStartDate && out.applicationEndDate && out.applicationStartDate > out.applicationEndDate) {
    out.applicationStartDate = ""; // 순서가 뒤집힌 값은 시작일을 버림 (마감일 우선)
  }
  out.closeType = verifyCloseType(r.closeType, posting, Boolean(out.applicationEndDate));
  // 실제 근무기간: 본문에 기간이 적혀 있을 때만 ("인턴"이라는 단어만으로 만들지 않음)
  out.workPeriod = verifyWorkPeriod(r.workPeriod, posting, [out.applicationStartDate, out.applicationEndDate]);
  return out;
}

/** 구조화 결과가 비교·분석에 쓸 만한지 (업무·조건 중 하나라도) */
export const hasStructuredContent = (s) =>
  Boolean(s) && (s.tasks?.length > 0 || s.required?.length > 0 || s.preferred?.length > 0);

// ───── 저장용 snapshot ─────

/** 저장할 공고 snapshot: 회사명·공고명 필수, 사실 필드만, source는 custom. 원문(description)·URL은 넣지 않음 */
export function toCustomSnapshot(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) return null;
  const company = cleanField(job.company, LIMITS.company);
  const title = cleanField(job.title, LIMITS.title);
  if (!company || !title) return null;
  const strip = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? stripTags(x) : x)) : v);
  const posting = toComparisonPosting({
    id: "custom-draft",
    company,
    title,
    employmentType: stripTags(job.employmentType ?? ""),
    employmentTypes: strip(job.employmentTypes),
    career: stripTags(job.career ?? ""),
    location: stripTags(job.location ?? ""),
    deadline: stripTags(job.deadline ?? ""),
    applicationStartDate: job.applicationStartDate,
    applicationEndDate: job.applicationEndDate,
    closeType: job.closeType,
    workPeriod: stripTags(job.workPeriod ?? ""),
    tasks: strip(job.tasks),
    required: strip(job.required),
    preferred: strip(job.preferred),
    keywords: strip(job.keywords)?.slice?.(0, LIMITS.keywords),
  });
  if (!posting) return null;
  delete posting.id;
  return { ...posting, source: CUSTOM_SOURCE };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const normalizeCustomRowId = (id) =>
  typeof id === "string" && UUID_RE.test(id.trim()) ? id.trim().toLowerCase() : "";

/** 화면·비교에서 쓰는 공고 id: "custom-<row uuid>" (샘플·사람인 id와 겹치지 않음) */
export const customJobId = (rowId) => `${CUSTOM_ID_PREFIX}${rowId}`;

export const isCustomJob = (job) => job?.source === CUSTOM_SOURCE;

/** DB row → 화면용 공고 (snapshot은 읽을 때도 다시 거름). 깨진 row는 null */
export function toCustomJobItem(row, formatDate = () => "") {
  const rowId = normalizeCustomRowId(row?.id);
  if (!rowId) return null;
  const snap = toCustomSnapshot({
    ...(row.structured_snapshot && typeof row.structured_snapshot === "object" ? row.structured_snapshot : {}),
    company: row.company,
    title: row.title,
  });
  if (!snap) return null;
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";
  return { rowId, job: { id: customJobId(rowId), ...snap }, savedDate: formatDate(createdAt) };
}

// ───── 비교에 담기 (기존 sessionStorage 비교 상태 재사용) ─────

/**
 * 메인 화면의 비교 상태(page)에 공고 하나를 추가한 새 상태
 * @returns {{ status: "added" | "already" | "full" | "invalid", page: object, count: number }}
 */
export function addToCompareState(pageState, job, max = MAX_COMPARE_POSTINGS) {
  const page = pageState && typeof pageState === "object" ? pageState : {};
  const ids = Array.isArray(page.compareIds) ? page.compareIds.filter((v) => typeof v === "string") : [];
  const posting = toComparisonPosting(job);
  if (!posting) return { status: "invalid", page, count: ids.length };
  if (ids.includes(posting.id)) return { status: "already", page, count: ids.length };
  if (ids.length >= max) return { status: "full", page, count: ids.length };
  const snapshots = Array.isArray(page.compareSnapshots) ? page.compareSnapshots : [];
  return {
    status: "added",
    count: ids.length + 1,
    page: {
      ...page,
      compareIds: [...ids, posting.id],
      compareSnapshots: [...snapshots.filter((p) => p?.id !== posting.id), posting],
      // 저장한 비교를 다시 연 상태는 해제 (선택이 바뀜)
      compareFromSaved: false,
      // 공고 조합이 바뀌었으므로 이전 AI 비교 결과는 쓰지 않음
      compareSummary: null,
    },
  };
}

// ───── 로그인 전 임시 입력 (sessionStorage) ─────

/** 저장된 임시 입력 → 화면 상태. 깨졌으면 null */
export function readDraft(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const draft = {
    company: text(raw.company, LIMITS.company),
    title: text(raw.title, LIMITS.title),
    posting: text(raw.posting, LIMITS.posting),
    structured: null,
  };
  if (raw.structured && typeof raw.structured === "object") {
    const s = toCustomSnapshot({ ...raw.structured, company: draft.company || "-", title: draft.title || "-" });
    if (s) {
      draft.structured = {
        tasks: s.tasks ?? [],
        required: s.required ?? [],
        preferred: s.preferred ?? [],
        keywords: s.keywords ?? [],
        employmentType: s.employmentType ?? "",
        employmentTypes: s.employmentTypes ?? [],
        career: s.career ?? "",
        location: s.location ?? "",
        deadline: s.deadline ?? "",
        applicationStartDate: s.applicationStartDate ?? "",
        applicationEndDate: s.applicationEndDate ?? "",
        closeType: s.closeType ?? "",
        workPeriod: s.workPeriod ?? "",
      };
    }
  }
  return draft.company || draft.title || draft.posting ? draft : null;
}

// ───── 분석 입력 만들기 (메인 화면 page.js와 공용) ─────

const isStrList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * 공고 → 분석 입력칸에 채울 글
 * 본문(description)이 있으면 그대로, 없으면(저장한 비교·직접 추가한 공고 등) 저장된 주요업무·자격요건·우대사항으로 채운다
 */
export function toPostingText(job) {
  let body = typeof job.description === "string" ? job.description.trim() : "";
  if (!body) {
    body = [
      ["주요 업무", job.tasks],
      ["자격요건", job.required],
      ["우대사항", job.preferred],
    ]
      .filter(([, list]) => isStrList(list) && list.length)
      .map(([label, list]) => `${label}\n${list.map((t) => `- ${t}`).join("\n")}`)
      .join("\n\n");
  }
  return `공고명: ${job.title}\n회사명: ${job.company ?? ""}\n\n${body}`.trim();
}

/** 분석 입력이 원문 없이 저장된 구조화 데이터로만 만들어지는지 (화면에서 "원문 추출" 대신 "저장된 공고 정보"로 표시) */
export const isStructuredOnly = (job) =>
  Boolean(job) &&
  !(typeof job.description === "string" && job.description.trim()) &&
  ["tasks", "required", "preferred"].some((k) => isStrList(job[k]) && job[k].length > 0);

// ───── 미리보기 편집 (CustomJobForm과 공용) ─────

/** 공고에서 확인되지 않은 칸의 안내 (placeholder 전용, 값으로 저장하지 않음) */
export const PREVIEW_EMPTY_HINT = "공고에서 확인되지 않았어요. 필요하면 직접 입력할 수 있어요.";

const toLines = (list) => (Array.isArray(list) ? list.join("\n") : "");
const fromLines = (text) =>
  String(text ?? "")
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
const fromCommas = (text) =>
  String(text ?? "")
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);

/** 정리 결과 → 편집 칸 값 (목록은 한 줄에 하나, 키워드는 쉼표). 빈 값은 빈 칸 그대로 */
export const toPreviewEdit = (s) => ({
  tasks: toLines(s?.tasks),
  required: toLines(s?.required),
  preferred: toLines(s?.preferred),
  keywords: (s?.keywords ?? []).join(", "),
  employmentType: s?.employmentType ?? "",
  career: s?.career ?? "",
  location: s?.location ?? "",
  deadline: s?.deadline ?? "",
  applicationStartDate: s?.applicationStartDate ?? "",
  applicationEndDate: s?.applicationEndDate ?? "",
  closeType: s?.closeType ?? "",
  workPeriod: s?.workPeriod ?? "",
});

/** 편집 칸 값 → 저장할 구조 (빈 칸은 빈 문자열·빈 배열, 안내 문구는 들어가지 않음) */
export const fromPreviewEdit = (e) => ({
  tasks: fromLines(e.tasks),
  required: fromLines(e.required),
  preferred: fromLines(e.preferred),
  keywords: fromCommas(e.keywords),
  employmentType: e.employmentType.trim(),
  employmentTypes: e.employmentType.trim() ? fromCommas(e.employmentType) : [],
  career: e.career.trim(),
  location: e.location.trim(),
  deadline: (e.deadline ?? "").trim(),
  // 날짜는 "2026-12-02"·"2026.12.02" 모두 받아 저장 시 "YYYY-MM-DD"로 (잘못된 값은 빈 값)
  applicationStartDate: normalizeIsoDate(e.applicationStartDate ?? ""),
  applicationEndDate: normalizeIsoDate(e.applicationEndDate ?? ""),
  closeType: e.closeType ?? "",
  workPeriod: (e.workPeriod ?? "").trim(),
});

/** 미리보기의 날짜 칸이 비었거나 올바른 날짜인지 (저장 전 확인용) */
export const isValidDateInput = (value) => !String(value ?? "").trim() || Boolean(normalizeIsoDate(String(value)));
