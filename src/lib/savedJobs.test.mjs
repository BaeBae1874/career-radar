import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SNAPSHOT_KEYWORDS,
  MAX_STATUS_IDS,
  buildLoginHref,
  cleanUrl,
  isUniqueViolation,
  normalizeJobId,
  normalizeJobIds,
  toSavedItem,
  toSavedSnapshot,
} from "./savedJobs.js";

const FULL_JOB = {
  id: "sample-1",
  company: "오렌지커머스",
  title: "  선물하기 서비스 CRM 마케팅 어시스턴트 ",
  employmentType: "인턴",
  career: "신입",
  companyType: "중견기업",
  location: "서울 강남구",
  deadline: "D-7",
  source: "sample",
  originalUrl: "https://example.com/jobs/1",
  keywords: ["CRM", "SQL", "CRM", "  ", 3],
  description: "아주 긴 공고 본문 …",
  tasks: ["", "  고객 데이터를 분석해\n타깃 캠페인을 기획합니다. "],
  required: ["데이터 기반 문제 해결"],
  preferred: ["SQL 경험"],
};

test("snapshot: 화면에 필요한 최소 정보만 남긴다 (본문·자격요건·companyType 제외)", () => {
  const s = toSavedSnapshot(FULL_JOB);
  assert.deepEqual(s, {
    id: "sample-1",
    source: "sample",
    company: "오렌지커머스",
    title: "선물하기 서비스 CRM 마케팅 어시스턴트",
    employmentType: "인턴",
    career: "신입",
    location: "서울 강남구",
    deadline: "D-7",
    originalUrl: "https://example.com/jobs/1",
    keywords: ["CRM", "SQL"],
    firstTask: "고객 데이터를 분석해 타깃 캠페인을 기획합니다.",
  });
  for (const k of ["description", "tasks", "required", "preferred", "companyType"]) {
    assert.equal(k in s, false, k);
  }
});

test("snapshot: 없는 값은 만들지 않는다", () => {
  const s = toSavedSnapshot({ id: "saramin-1", title: "데이터 분석", tasks: [] });
  assert.deepEqual(s, { id: "saramin-1", title: "데이터 분석" });
});

test("snapshot: 사람인 sourceId(숫자)는 문자열로", () => {
  const s = toSavedSnapshot({ id: "saramin-42", title: "기획", source: "saramin", sourceId: 42 });
  assert.equal(s.sourceId, "42");
});

test("snapshot: id나 직무명이 없으면 저장 불가", () => {
  assert.equal(toSavedSnapshot(null), null);
  assert.equal(toSavedSnapshot([]), null);
  assert.equal(toSavedSnapshot({ id: "a" }), null);
  assert.equal(toSavedSnapshot({ title: "기획" }), null);
  assert.equal(toSavedSnapshot({ id: "  ", title: "기획" }), null);
});

test("snapshot: 긴 값·많은 키워드는 잘라낸다", () => {
  const s = toSavedSnapshot({
    id: "x",
    title: "가".repeat(500),
    keywords: Array.from({ length: 30 }, (_, i) => `k${i}`),
    firstTask: "나".repeat(1000),
  });
  assert.equal(s.title.length, 200);
  assert.equal(s.keywords.length, MAX_SNAPSHOT_KEYWORDS);
  assert.equal(s.firstTask.length, 300);
});

test("snapshot: 이미 요약된 snapshot을 다시 걸러도 같다 (서버 재검증)", () => {
  const once = toSavedSnapshot(FULL_JOB);
  assert.deepEqual(toSavedSnapshot(once), once);
});

test("url: http(s)만 허용", () => {
  assert.equal(cleanUrl("https://www.saramin.co.kr/a?b=1"), "https://www.saramin.co.kr/a?b=1");
  assert.equal(cleanUrl("javascript:alert(1)"), "");
  assert.equal(cleanUrl("data:text/html,hi"), "");
  assert.equal(cleanUrl("/relative"), "");
  assert.equal(cleanUrl(42), "");
  assert.equal(toSavedSnapshot({ id: "a", title: "b", originalUrl: "javascript:x" }).originalUrl, undefined);
});

test("job id: 문자열·길이·제어문자 확인", () => {
  assert.equal(normalizeJobId(" sample-1 "), "sample-1");
  assert.equal(normalizeJobId(""), "");
  assert.equal(normalizeJobId(1), "");
  assert.equal(normalizeJobId("a".repeat(201)), "");
  assert.equal(normalizeJobId("a\nb"), "");
});

test("상태 조회 id 목록: 중복 제거·잘못된 값 제외·최대 개수", () => {
  assert.deepEqual(normalizeJobIds(["a", "a", "", null, "b"]), ["a", "b"]);
  assert.deepEqual(normalizeJobIds("a"), []);
  const many = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  assert.equal(normalizeJobIds(many).length, MAX_STATUS_IDS);
});

test("DB row → 화면용: job_id 기준, snapshot 다시 거르기", () => {
  const item = toSavedItem({
    job_id: "sample-1",
    job_snapshot: { id: "other", title: "기획", originalUrl: "javascript:x", extra: "x" },
    created_at: "2026-11-14T00:00:00Z",
  });
  assert.deepEqual(item, {
    jobId: "sample-1",
    job: { id: "sample-1", title: "기획" },
    savedAt: "2026-11-14T00:00:00Z",
  });
  assert.equal(toSavedItem({ job_id: "a", job_snapshot: {} }), null);
  assert.equal(toSavedItem({ job_id: "", job_snapshot: { title: "a" } }), null);
  assert.equal(toSavedItem(null), null);
});

test("unique 위반(이미 저장됨) 구분", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: "42501" }), false);
  assert.equal(isUniqueViolation(null), false);
});

test("비로그인 저장 → 로그인 경로 (내부 경로만)", () => {
  assert.equal(buildLoginHref("/"), "/login?next=%2F");
  assert.equal(buildLoginHref("/saved"), "/login?next=%2Fsaved");
  assert.equal(buildLoginHref("/?a=1&b=2"), "/login?next=%2F%3Fa%3D1%26b%3D2");
  assert.equal(buildLoginHref("//evil.com"), "/login?next=%2F");
  assert.equal(buildLoginHref("https://evil.com"), "/login?next=%2F");
  assert.equal(buildLoginHref(undefined), "/login?next=%2F");
});
