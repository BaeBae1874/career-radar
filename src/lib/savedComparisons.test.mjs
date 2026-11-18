import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_COMPARE_POSTINGS,
  comparisonKey,
  formatSavedDate,
  normalizeComparisonId,
  restoreCompareJobs,
  toComparisonPosting,
  toComparisonSnapshot,
  toSavedComparisonItem,
} from "./savedComparisons.js";

const job = (n, extra = {}) => ({
  id: `sample-${n}`,
  source: "sample",
  company: `회사${n}`,
  title: `직무 ${n}`,
  employmentType: "인턴",
  career: "신입",
  location: "서울",
  deadline: "D-7",
  originalUrl: `https://example.com/${n}`,
  keywords: ["CRM", "SQL"],
  tasks: ["업무 A", "업무 B"],
  required: ["필수 A"],
  preferred: ["우대 A"],
  description: "긴 공고 본문",
  ...extra,
});

test("posting: 비교에 쓰는 사실 데이터만 (본문·AI 결과 제외)", () => {
  const p = toComparisonPosting(job(1, { aiSummary: "x", score: 90, companyType: "중견기업" }));
  assert.deepEqual(p, {
    id: "sample-1",
    source: "sample",
    company: "회사1",
    title: "직무 1",
    employmentType: "인턴",
    career: "신입",
    location: "서울",
    deadline: "D-7",
    companyType: "중견기업",
    originalUrl: "https://example.com/1",
    tasks: ["업무 A", "업무 B"],
    required: ["필수 A"],
    preferred: ["우대 A"],
    keywords: ["CRM", "SQL"],
  });
  for (const k of ["description", "aiSummary", "score"]) assert.equal(k in p, false, k);
});

test("posting: 없는 값은 만들지 않는다", () => {
  assert.deepEqual(toComparisonPosting({ id: "saramin-1", title: "기획", tasks: [], required: [" "] }), {
    id: "saramin-1",
    title: "기획",
  });
});

test("posting: 목록은 문자열만·중복 제거·개수 제한, 사람인 sourceId·employmentTypes 유지", () => {
  const p = toComparisonPosting({
    id: "saramin-7",
    title: "데이터",
    sourceId: 7,
    employmentTypes: ["인턴직 (정규직 전환가능)", 3, "인턴직 (정규직 전환가능)"],
    tasks: Array.from({ length: 40 }, (_, i) => `업무 ${i}`),
    keywords: ["a", {}, "a", "b"],
  });
  assert.equal(p.sourceId, "7");
  assert.deepEqual(p.employmentTypes, ["인턴직 (정규직 전환가능)"]);
  assert.equal(p.tasks.length, 20);
  assert.deepEqual(p.keywords, ["a", "b"]);
});

test("URL: http(s)만 저장", () => {
  assert.equal(toComparisonPosting(job(1, { originalUrl: "javascript:alert(1)" })).originalUrl, undefined);
  assert.equal(toComparisonPosting(job(1, { originalUrl: "data:text/html,x" })).originalUrl, undefined);
  assert.equal(toComparisonPosting(job(1, { originalUrl: "http://a.com/x" })).originalUrl, "http://a.com/x");
});

test("snapshot: 2개·3개만 허용, 순서 유지", () => {
  const two = toComparisonSnapshot([job(2), job(1)]);
  assert.equal(two.version, 1);
  assert.deepEqual(two.postings.map((p) => p.id), ["sample-2", "sample-1"]);
  assert.equal(toComparisonSnapshot([job(1), job(2), job(3)]).postings.length, 3);
});

test("snapshot: 1개·4개·중복 공고·잘못된 공고는 거부", () => {
  assert.equal(toComparisonSnapshot([job(1)]), null);
  assert.equal(toComparisonSnapshot([job(1), job(2), job(3), job(4)]), null);
  assert.equal(MAX_COMPARE_POSTINGS, 3);
  assert.equal(toComparisonSnapshot([job(1), job(1)]), null);
  assert.equal(toComparisonSnapshot([job(1), { id: "x" }]), null);
  assert.equal(toComparisonSnapshot(null), null);
  assert.equal(toComparisonSnapshot({ 0: job(1), 1: job(2), length: 2 }), null);
});

test("같은 공고 조합 키: A/B/C 순서와 상관없이 같은 값", () => {
  const k1 = comparisonKey(["sample-2", "sample-1", "sample-3"]);
  const k2 = comparisonKey(["sample-3", "sample-2", "sample-1"]);
  assert.equal(k1, k2);
  assert.equal(k1, JSON.stringify(["sample-1", "sample-2", "sample-3"]));
  assert.notEqual(comparisonKey(["sample-1", "sample-2"]), k1);
  assert.equal(comparisonKey(["sample-1"]), "");
  assert.equal(comparisonKey(["a", "a"]), "");
  assert.equal(comparisonKey(["a", "b", "c", "d"]), "");
  assert.equal(comparisonKey(["a", ""]), "");
  assert.equal(comparisonKey("a,b"), "");
});

test("저장한 비교 id: uuid만", () => {
  assert.equal(
    normalizeComparisonId(" 3F2504E0-4F89-11D3-9A0C-0305E82C3301 "),
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
  );
  assert.equal(normalizeComparisonId("1 or 1=1"), "");
  assert.equal(normalizeComparisonId(1), "");
});

test("DB row → 화면용: snapshot 다시 거르고, 깨진 row는 제외", () => {
  const row = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    comparison_snapshot: { version: 1, postings: [job(1, { originalUrl: "javascript:x" }), job(2)] },
    created_at: "2026-11-15T16:30:00Z",
  };
  const item = toSavedComparisonItem(row);
  assert.equal(item.postings.length, 2);
  assert.equal(item.postings[0].originalUrl, undefined);
  assert.equal("description" in item.postings[0], false);
  assert.equal(item.savedDate, formatSavedDate("2026-11-15T16:30:00Z"));
  assert.equal(toSavedComparisonItem({ ...row, id: "nope" }), null);
  assert.equal(toSavedComparisonItem({ ...row, comparison_snapshot: { postings: [job(1)] } }), null);
  assert.equal(toSavedComparisonItem({ ...row, comparison_snapshot: null }), null);
});

test("저장 날짜: 한국 시간 기준 (UTC 저녁 → 다음 날)", () => {
  assert.match(formatSavedDate("2026-11-15T16:30:00Z"), /2026\. 11\. 16\./);
  assert.equal(formatSavedDate("not a date"), "");
  assert.equal(formatSavedDate(undefined), "");
});

test("snapshot → 비교 상태 복원: 저장 당시 순서, 지금 목록에 없어도 열림, 본문만 빌려 옴", () => {
  const saved = toComparisonSnapshot([job(3), job(1)]).postings;
  // 지금 목록에 sample-1만 있고 내용이 바뀐 경우
  const pool = [{ ...job(1), title: "바뀐 제목", description: "지금 본문" }];
  const restored = restoreCompareJobs(saved, pool);
  assert.deepEqual(restored.map((j) => j.id), ["sample-3", "sample-1"]);
  assert.equal(restored[1].title, "직무 1"); // 비교 내용은 저장 당시 그대로
  assert.equal(restored[1].description, "지금 본문"); // 분석용 본문만
  assert.equal("description" in restored[0], false); // 목록에 없는 공고도 snapshot으로
  assert.deepEqual(restoreCompareJobs(saved, null).map((j) => j.id), ["sample-3", "sample-1"]);
  assert.deepEqual(restoreCompareJobs([saved[0]], pool), []);
});

test("migration: RLS 켜짐, anon 권한 없음, 본인 row만 조회·추가·삭제", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20261116000000_career_saved_comparisons.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /alter table public\.career_saved_comparisons enable row level security/);
  assert.match(sql, /revoke all on table public\.career_saved_comparisons from anon/);
  assert.match(sql, /grant select, insert, delete on table public\.career_saved_comparisons to authenticated/);
  assert.doesNotMatch(sql, /grant[^;]*update/i);
  for (const action of ["select", "delete"]) {
    assert.match(
      sql,
      new RegExp(`for ${action}\\s+to authenticated\\s+using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`)
    );
  }
  assert.match(sql, /for insert\s+to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /unique \(user_id, job_key\)/);
  assert.match(sql, /cardinality\(job_ids\) between 2 and 3/);
});
