/**
 * 공고 메타 정보 helper (순수 함수, AI·네트워크 없음)
 * - 근무형태 필터 분류: 샘플("인턴")과 사람인 실데이터("인턴직 (정규직 전환가능)")를 같은 기준으로
 * - 출처 표시 이름: 내부 값("saramin")은 그대로 두고 화면에는 "사람인"
 * - 사람인 attribution 표시 여부
 */

import { SARAMIN_SOURCE } from "./saraminMapper.js";

export { SARAMIN_SOURCE };

// ───── 근무형태 ─────

// 기본 카테고리 (검색 필터 버튼과 같은 이름)
export const EMPLOYMENT_CATEGORIES = ["인턴", "정규직", "계약직"];

/**
 * 근무형태 문자열 하나 → 기본 카테고리 (해당 없으면 null)
 * 괄호 안 설명은 보지 않는다 → "계약직 (정규직 전환가능)"은 계약직, "인턴직 (정규직 전환가능)"은 인턴
 * 파견직·프리랜서·아르바이트 등은 null (전체 보기에서만 보임)
 */
export function getEmploymentCategory(type) {
  if (typeof type !== "string") return null;
  const base = type.replace(/[(（[].*?[)）\]]/g, "").replace(/\s+/g, "");
  if (!base) return null;
  if (base.includes("인턴")) return "인턴";
  if (base.includes("계약직")) return "계약직";
  if (base.includes("정규직")) return "정규직";
  return null;
}

/**
 * 공고의 근무형태 카테고리 목록 (중복 없음)
 * 사람인 mapper 결과는 employmentTypes 배열, 기존 샘플은 employmentType 문자열로 fallback
 */
export function getEmploymentCategories(posting) {
  const types =
    Array.isArray(posting?.employmentTypes) && posting.employmentTypes.length
      ? posting.employmentTypes
      : typeof posting?.employmentType === "string"
        ? posting.employmentType.split(",")
        : [];
  const out = [];
  for (const t of types) {
    const c = getEmploymentCategory(t);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 검색 필터("전체" | "인턴" | "정규직" | "계약직")에 해당하는 공고인지 */
export function matchesEmploymentFilter(posting, filter) {
  if (!filter || filter === "전체") return true;
  return getEmploymentCategories(posting).includes(filter);
}

// ───── 출처 ─────

// 내부 출처 코드 → 화면 표시 이름
const SOURCE_LABELS = {
  saramin: "사람인",
  sample: "샘플 데이터",
};

/**
 * 출처 표시 이름. 알려진 코드는 한국어 이름으로,
 * 이미 사람이 읽는 이름("사람인" 등 한글 포함)이면 그대로, 모르는 영문 코드는 개발용 문자열을 보여 주지 않도록 "기타 출처"
 */
export function getSourceLabel(source) {
  if (typeof source !== "string" || !source.trim()) return "";
  const raw = source.trim();
  const known = SOURCE_LABELS[raw.toLowerCase()];
  if (known) return known;
  if (/[가-힣]/.test(raw)) return raw;
  return "기타 출처";
}

/** 실제 사람인 데이터(source === "saramin")가 하나라도 있으면 attribution 표시 (샘플은 해당 없음) */
export const hasSaraminSource = (postings) =>
  Array.isArray(postings) && postings.some((p) => p?.source === SARAMIN_SOURCE);
