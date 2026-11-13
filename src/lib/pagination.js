/**
 * 검색 결과 페이지 계산 (순수 함수).
 *
 * 지금은 /api/jobs가 전체 결과를 한 번에 주므로 클라이언트에서 나눈다.
 * 실제 API가 page/count 방식이 되면 totalCount만 서버 값으로 바꾸고
 * getPageNumbers / clampPage는 그대로 쓰면 된다.
 */

export const PAGE_SIZE = 8; // 공고 카드 정보량이 많아 한 페이지 8개
export const MAX_PAGE_BUTTONS = 5;

export const getTotalPages = (totalCount, pageSize = PAGE_SIZE) =>
  Math.max(1, Math.ceil(Math.max(0, totalCount) / pageSize));

/** 1 ~ totalPages 범위로 보정 (숫자가 아니면 1) */
export function clampPage(page, totalPages) {
  const n = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, n), Math.max(1, totalPages));
}

/** 현재 페이지에 보여 줄 항목 + 보정된 페이지 정보 */
export function paginate(items, page, pageSize = PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const totalPages = getTotalPages(list.length, pageSize);
  const current = clampPage(page, totalPages);
  const start = (current - 1) * pageSize;
  return { page: current, totalPages, items: list.slice(start, start + pageSize) };
}

/** 현재 페이지를 가운데에 두는 연속 번호 최대 maxButtons개 (예: 6/20 → [4,5,6,7,8]) */
export function getPageNumbers(current, totalPages, maxButtons = MAX_PAGE_BUTTONS) {
  const total = Math.max(1, totalPages);
  const count = Math.min(maxButtons, total);
  const page = clampPage(current, total);
  let start = page - Math.floor(count / 2);
  start = Math.max(1, Math.min(start, total - count + 1));
  return Array.from({ length: count }, (_, i) => start + i);
}
