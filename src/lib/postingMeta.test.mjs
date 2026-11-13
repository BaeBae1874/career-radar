// 실행: node --test src/lib/postingMeta.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getEmploymentCategory,
  getEmploymentCategories,
  getSourceLabel,
  hasSaraminSource,
  matchesEmploymentFilter,
} from "./postingMeta.js";

const by = (employmentTypes) => ({ employmentTypes });

test('"정규직" → 정규직', () => {
  assert.equal(matchesEmploymentFilter(by(["정규직"]), "정규직"), true);
  assert.equal(matchesEmploymentFilter(by(["정규직 (수습기간)"]), "정규직"), true);
});

test('"계약직 (정규직 전환가능)" → 계약직 true / 정규직 false', () => {
  const p = by(["계약직 (정규직 전환가능)"]);
  assert.equal(matchesEmploymentFilter(p, "계약직"), true);
  assert.equal(matchesEmploymentFilter(p, "정규직"), false);
});

test('"인턴직 (정규직 전환가능)" → 인턴 true / 정규직 false', () => {
  const p = by(["인턴직 (정규직 전환가능)"]);
  assert.equal(matchesEmploymentFilter(p, "인턴"), true);
  assert.equal(matchesEmploymentFilter(p, "정규직"), false);
});

test('["정규직", "계약직"] → 각각 해당 필터 true, 인턴 false', () => {
  const p = by(["정규직", "계약직"]);
  assert.equal(matchesEmploymentFilter(p, "정규직"), true);
  assert.equal(matchesEmploymentFilter(p, "계약직"), true);
  assert.equal(matchesEmploymentFilter(p, "인턴"), false);
});

test("기존 샘플(employmentType 문자열)은 그대로 fallback", () => {
  for (const t of ["인턴", "정규직", "계약직"]) {
    const sample = { employmentType: t };
    for (const f of ["인턴", "정규직", "계약직"]) {
      assert.equal(matchesEmploymentFilter(sample, f), t === f, `${t} / ${f}`);
    }
    assert.equal(matchesEmploymentFilter(sample, "전체"), true);
  }
});

test("employmentTypes가 비어 있으면 employmentType으로, 쉼표 구분도 처리", () => {
  assert.deepEqual(getEmploymentCategories({ employmentTypes: [], employmentType: "정규직, 인턴직" }), ["정규직", "인턴"]);
});

test("기타 근무형태·빈 값은 어떤 필터에도 해당 없음 (전체에서만)", () => {
  assert.equal(getEmploymentCategory("파견직"), null);
  assert.equal(getEmploymentCategory("프리랜서"), null);
  assert.equal(getEmploymentCategory(""), null);
  assert.equal(getEmploymentCategory(undefined), null);
  assert.deepEqual(getEmploymentCategories({}), []);
  assert.equal(matchesEmploymentFilter({}, "정규직"), false);
  assert.equal(matchesEmploymentFilter({}, "전체"), true);
});

test("source label", () => {
  assert.equal(getSourceLabel("saramin"), "사람인");
  assert.equal(getSourceLabel("Saramin"), "사람인");
  assert.equal(getSourceLabel("sample"), "샘플 데이터");
  assert.equal(getSourceLabel("사람인"), "사람인"); // 현재 샘플 데이터의 source 값
  assert.equal(getSourceLabel("unknown-api"), "기타 출처");
  assert.equal(getSourceLabel(""), "");
  assert.equal(getSourceLabel(null), "");
});

test("attribution: source === 'saramin'이 있을 때만", () => {
  assert.equal(hasSaraminSource([{ source: "사람인" }, { source: "사람인" }]), false); // 현재 샘플
  assert.equal(hasSaraminSource([{ source: "사람인" }, { source: "saramin" }]), true);
  assert.equal(hasSaraminSource([]), false);
  assert.equal(hasSaraminSource(null), false);
});
