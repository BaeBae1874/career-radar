/**
 * 채용 일정 helper (순수 함수, 네트워크 없음) — 검색·분석·비교·저장함·직접 추가가 함께 쓴다
 *
 * 공고 일정 필드 (모두 선택, 공고에 있을 때만):
 * - applicationStartDate: 지원 접수 시작일 "YYYY-MM-DD" (사람인 opening-timestamp)
 * - applicationEndDate:   지원 접수 마감일 "YYYY-MM-DD" (사람인 expiration-timestamp, close-type 1일 때)
 * - closeType: "deadline"(접수 마감일) | "rolling"(채용시) | "always"(상시) | "occasional"(수시)
 * - workPeriod: 실제 근무기간 — 공고에 적힌 표현 그대로 (예: "2027년 1월부터 6개월"). 모집 일정과 별개
 * - deadline: 예전 표시용 문자열("D-7", "상시채용") — 새 필드가 없을 때만 그대로 보여 준다 (기존 저장 데이터 호환)
 *
 * 날짜는 내부적으로 날짜만("YYYY-MM-DD") 보관하고, D-Day는 한국 날짜 기준으로 계산한다
 * (브라우저 시간대와 상관없이 하루 밀리지 않게, 시각을 섞지 않음)
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CLOSE_TYPES = ["deadline", "rolling", "always", "occasional"];
export const CLOSE_TYPE_LABELS = {
  deadline: "접수 마감일",
  rolling: "채용시 마감",
  always: "상시채용",
  occasional: "수시채용",
};

/** 날짜 문자열 → "YYYY-MM-DD" (실제 있는 날짜만). "2026.11.18", "2026/11/18"도 받음. 아니면 "" */
export function normalizeIsoDate(value) {
  if (typeof value !== "string") return "";
  const m = value.trim().match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/);
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return "";
  if (y < 2000 || y > 2100) return "";
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ms 시각 → 한국 날짜 "YYYY-MM-DD" (사람인 timestamp 변환용) */
export function kstDateFromMs(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 오늘(한국 날짜) "YYYY-MM-DD" */
export const kstToday = (now = Date.now()) => kstDateFromMs(now);

const dayNumber = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

/** 마감일까지 남은 날 (한국 날짜 기준, 오늘 마감 = 0, 지남 = 음수). 날짜가 잘못되면 null */
export function daysUntil(isoDate, now = Date.now()) {
  const iso = normalizeIsoDate(isoDate);
  if (!iso) return null;
  return dayNumber(iso) - dayNumber(kstToday(now));
}

/** "D-14" / "D-1" / "D-Day" / 지난 날짜 "마감" */
export function dDayLabel(days) {
  if (!Number.isInteger(days)) return "";
  if (days < 0) return "마감";
  if (days === 0) return "D-Day";
  return `D-${days}`;
}

/** 화면용 짧은 날짜: 올해면 "11.18", 다른 해면 "2027.01.05" */
export function formatShortDate(isoDate, now = Date.now()) {
  const iso = normalizeIsoDate(isoDate);
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y === kstToday(now).slice(0, 4) ? `${m}.${d}` : `${y}.${m}.${d}`;
}

/** 마감 방식 정리: 내부 값 또는 한국어 표현("채용시", "상시", "수시") → 내부 값. 모르면 "" */
export function normalizeCloseType(value) {
  if (typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  if (CLOSE_TYPES.includes(v)) return v;
  if (/채용\s*시/.test(v)) return "rolling";
  if (/상시/.test(v)) return "always";
  if (/수시/.test(v)) return "occasional";
  if (/마감일|접수\s*마감/.test(v)) return "deadline";
  return "";
}

/** 근무기간: 공고에 적힌 표현 그대로 정리 (숫자가 들어 있는 구체적인 기간만, "인턴" 같은 단어만은 제외) */
export function normalizeWorkPeriod(value) {
  if (typeof value !== "string") return "";
  const v = value.replace(/\s+/g, " ").trim().slice(0, 100);
  return /\d/.test(v) ? v : "";
}

/**
 * 공고의 모집 일정 표시
 * @returns {{ range: string, status: string, text: string, kind: "dated" | "type" | "legacy" | "none" }}
 *   range: "11.18 ~ 12.02" / "12.02 마감" / "11.18부터 접수" / "채용시 마감" …
 *   status: "D-14" / "D-Day" / "마감" (고정 마감일이 있을 때만)
 *   text: 화면에 그대로 쓰는 한 줄 ("11.18 ~ 12.02 · D-14")
 */
export function getApplicationSchedule(job, now = Date.now()) {
  const start = normalizeIsoDate(job?.applicationStartDate);
  const end = normalizeIsoDate(job?.applicationEndDate);
  const type = normalizeCloseType(job?.closeType);
  const join = (range, status = "") => [range, status].filter(Boolean).join(" · ");

  // 채용시·상시·수시: 고정 마감일이 없으므로 D-Day를 만들지 않음
  if (type && type !== "deadline") {
    const range = CLOSE_TYPE_LABELS[type];
    return { range, status: "", text: range, kind: "type" };
  }
  if (end) {
    const status = dDayLabel(daysUntil(end, now));
    const range = start
      ? `${formatShortDate(start, now)} ~ ${formatShortDate(end, now)}`
      : `${formatShortDate(end, now)} 마감`;
    return { range, status, text: join(range, status), kind: "dated" };
  }
  if (start) {
    const range = `${formatShortDate(start, now)}부터 접수`;
    return { range, status: "", text: range, kind: "dated" };
  }
  // 새 일정 필드가 없는 예전 데이터: 기존 표시 문자열 그대로
  const legacy = typeof job?.deadline === "string" ? job.deadline.trim() : "";
  if (legacy) return { range: legacy, status: "", text: legacy, kind: "legacy" };
  return { range: "", status: "", text: "", kind: "none" };
}

/** 검색 결과 한 줄: 날짜가 있으면 "모집 11.18 ~ 12.02 · D-14", 마감 방식만 있으면 "채용시 마감" */
export function scheduleLine(job, now = Date.now()) {
  const s = getApplicationSchedule(job, now);
  return s.kind === "dated" ? `모집 ${s.text}` : s.text;
}

/** 저장 snapshot에 넣을 일정 필드 (올바른 값만, 없으면 키 자체를 빼서 기존 데이터와 같은 모양) */
export function pickScheduleFields(job) {
  const out = {};
  const start = normalizeIsoDate(job?.applicationStartDate);
  const end = normalizeIsoDate(job?.applicationEndDate);
  const type = normalizeCloseType(job?.closeType);
  const work = normalizeWorkPeriod(job?.workPeriod);
  if (start) out.applicationStartDate = start;
  if (end) out.applicationEndDate = end;
  if (type) out.closeType = type;
  if (work) out.workPeriod = work;
  return out;
}

/** "YYYY-MM-DD" + n일 → "YYYY-MM-DD" (샘플 일정용). 잘못된 날짜면 "" */
export function addDaysIso(isoDate, days) {
  const iso = normalizeIsoDate(isoDate);
  if (!iso || !Number.isInteger(days)) return "";
  return kstDateFromMs((dayNumber(iso) + days) * DAY_MS - KST_OFFSET_MS);
}
