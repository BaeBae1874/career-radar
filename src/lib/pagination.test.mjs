// 실행: node --test src/lib/pagination.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE_SIZE, clampPage, getPageNumbers, getTotalPages, paginate } from "./pagination.js";

const items = Array.from({ length: 15 }, (_, i) => i + 1);

test("기본 page size는 8", () => assert.equal(PAGE_SIZE, 8));

test("15개 / 8개씩 → 2페이지", () => {
  assert.equal(getTotalPages(15), 2);
  assert.equal(paginate(items, 1).totalPages, 2);
});

test("1페이지 → 8개, 2페이지 → 나머지 7개", () => {
  assert.deepEqual(paginate(items, 1).items, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(paginate(items, 2).items, [9, 10, 11, 12, 13, 14, 15]);
});

test("pageSize를 직접 주면 그 값으로 (예: 10개씩 → 10 + 5)", () => {
  assert.equal(getTotalPages(15, 10), 2);
  assert.equal(paginate(items, 2, 10).items.length, 5);
});

test("결과 0개 → 1페이지, 빈 목록", () => {
  assert.deepEqual(paginate([], 3), { page: 1, totalPages: 1, items: [] });
  assert.equal(getTotalPages(0), 1);
});

test("현재 페이지가 전체보다 크면 마지막 페이지로", () => {
  const r = paginate(items, 3);
  assert.equal(r.page, 2);
  assert.deepEqual(r.items, [9, 10, 11, 12, 13, 14, 15]);
  assert.equal(clampPage(9, 2), 2);
});

test("잘못된 페이지 값은 1페이지", () => {
  assert.equal(clampPage(0, 5), 1);
  assert.equal(clampPage(-3, 5), 1);
  assert.equal(clampPage(Number.NaN, 5), 1);
  assert.equal(clampPage(undefined, 5), 1);
  assert.equal(clampPage(2.7, 5), 2);
});

test("페이지 번호는 최대 5개, 현재 페이지 중심", () => {
  assert.deepEqual(getPageNumbers(1, 2), [1, 2]);
  assert.deepEqual(getPageNumbers(1, 20), [1, 2, 3, 4, 5]);
  assert.deepEqual(getPageNumbers(6, 20), [4, 5, 6, 7, 8]);
  assert.deepEqual(getPageNumbers(20, 20), [16, 17, 18, 19, 20]);
  assert.deepEqual(getPageNumbers(2, 9), [1, 2, 3, 4, 5]);
  assert.equal(getPageNumbers(50, 100).length, 5);
});

test("모바일용 3개", () => {
  assert.deepEqual(getPageNumbers(6, 20, 3), [5, 6, 7]);
  assert.deepEqual(getPageNumbers(1, 20, 3), [1, 2, 3]);
});
