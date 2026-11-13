// 실행: node --test src/lib/saraminMapper.test.mjs
// 실제 사람인 API는 호출하지 않는다. 공식 문서의 응답 구조를 본뜬 가짜 데이터만 사용.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanLocation,
  formatDeadline,
  mapSaraminJob,
  mapSaraminJobs,
  splitList,
  toTimestampMs,
} from "./saraminMapper.js";

// 2026-11-13 12:00 KST
const NOW = Date.parse("2026-11-13T12:00:00+09:00");
const sec = (iso) => String(Math.floor(Date.parse(iso) / 1000));

const sample = (over = {}) => ({
  url: "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=12345",
  active: 1,
  company: { detail: { href: "https://www.saramin.co.kr/company", name: "가상회사(주)" } },
  position: {
    title: "CRM 마케터 (신입)",
    industry: { code: "301", name: "솔루션·SI·ERP·CRM" },
    location: { code: "101050", name: "서울 &gt; 강남구" },
    "job-type": { code: "1", name: "정규직" },
    "job-mid-code": { code: "14", name: "마케팅·홍보·조사" },
    "job-code": { code: "1406,1408", name: "CRM, 퍼포먼스마케팅" },
    "experience-level": { code: 1, min: 0, max: 0, name: "신입" },
    "required-education-level": { code: "8", name: "대학교졸업(4년)이상" },
  },
  keyword: "CRM,마케팅, 데이터분석",
  salary: { code: "99", name: "면접후 결정" },
  id: "12345",
  "posting-timestamp": sec("2026-11-01T09:00:00+09:00"),
  "opening-timestamp": sec("2026-11-01T09:00:00+09:00"),
  "expiration-timestamp": sec("2026-11-20T23:59:59+09:00"),
  "close-type": { code: "1", name: "접수마감일" },
  ...over,
});

test("정상 job 1개 → 기존 UI field 이름 그대로", () => {
  const p = mapSaraminJob(sample(), { now: NOW });
  assert.equal(p.id, "saramin-12345");
  assert.equal(p.sourceId, "12345");
  assert.equal(p.company, "가상회사(주)");
  assert.equal(p.title, "CRM 마케터 (신입)");
  assert.equal(p.employmentType, "정규직");
  assert.equal(p.career, "신입");
  assert.equal(p.location, "서울 > 강남구");
  assert.equal(p.deadline, "D-7");
  assert.deepEqual(p.keywords, ["CRM", "마케팅", "데이터분석"]);
  assert.equal(p.industry, "솔루션·SI·ERP·CRM");
  assert.equal(p.jobCategory, "마케팅·홍보·조사");
  assert.equal(p.education, "대학교졸업(4년)이상");
  assert.equal(p.salary, "면접후 결정");
  assert.equal(p.active, true);
  assert.deepEqual(p.experienceLevel, { code: "1", min: 0, max: 0 });
});

test("originalUrl 보존 + source === 'saramin'", () => {
  const p = mapSaraminJob(sample(), { now: NOW });
  assert.equal(p.originalUrl, "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=12345");
  assert.equal(p.source, "saramin");
});

test("keyword / job-code 쉼표 분리 (공백 정리, 빈 값·중복 제거, 처음 표기 유지)", () => {
  assert.deepEqual(splitList(" CRM, ,마케팅,crm , 데이터 분석,데이터분석"), ["CRM", "마케팅", "데이터 분석"]);
  assert.deepEqual(mapSaraminJob(sample(), { now: NOW }).jobCodes, ["CRM", "퍼포먼스마케팅"]);
});

test("빈 keyword / job-code 없음 → []", () => {
  const p = mapSaraminJob(sample({ keyword: "" }), { now: NOW });
  assert.deepEqual(p.keywords, []);
  const q = mapSaraminJob(sample({ keyword: undefined, position: { title: "제목만" } }), { now: NOW });
  assert.deepEqual(q.keywords, []);
  assert.deepEqual(q.jobCodes, []);
});

test("salary / education / location / industry 누락 → null 또는 '' (undefined 없음)", () => {
  const p = mapSaraminJob({ id: 1, position: { title: "제목만" } }, { now: NOW });
  assert.equal(p.salary, null);
  assert.equal(p.education, null);
  assert.equal(p.industry, null);
  assert.equal(p.jobCategory, null);
  assert.equal(p.location, "");
  assert.deepEqual(p.locations, []);
  assert.equal(p.company, "");
  assert.equal(p.employmentType, "");
  assert.equal(p.career, "");
  assert.equal(p.deadline, "");
  assert.equal(p.originalUrl, "");
  assert.equal(p.experienceLevel, null);
  assert.equal(p.expirationTimestamp, null);
  for (const [k, v] of Object.entries(p)) assert.notEqual(v, undefined, `${k} is undefined`);
});

test("close-type 2 / 3 / 4 → 문구, 원본 정보 보존", () => {
  const cases = [
    ["2", "채용시 마감"],
    ["3", "상시채용"],
    ["4", "수시채용"],
  ];
  for (const [code, label] of cases) {
    const p = mapSaraminJob(sample({ "close-type": { code, name: "x" } }), { now: NOW });
    assert.equal(p.deadline, label);
    assert.equal(p.closeType, code);
    assert.equal(p.closeTypeName, label);
    assert.ok(p.expirationTimestamp > 0); // 원본 마감 시각은 그대로 보존
  }
});

test("close-type 1 → D-day (KST 기준), 당일 '오늘 마감', 지나면 '마감'", () => {
  const exp = (iso) => toTimestampMs(sec(iso));
  assert.equal(formatDeadline({ closeType: "1", expirationMs: exp("2026-11-14T00:30:00+09:00"), now: NOW }), "D-1");
  assert.equal(formatDeadline({ closeType: "1", expirationMs: exp("2026-11-13T23:59:59+09:00"), now: NOW }), "오늘 마감");
  assert.equal(formatDeadline({ closeType: "1", expirationMs: exp("2026-11-12T23:59:59+09:00"), now: NOW }), "마감");
  assert.equal(formatDeadline({ closeType: null, expirationMs: null, now: NOW }), "");
});

test("expiration-date 문자열(+0900)도 처리", () => {
  const p = mapSaraminJob(
    sample({ "expiration-timestamp": undefined, "expiration-date": "2026-11-20T23:59:59+0900" }),
    { now: NOW }
  );
  assert.equal(p.deadline, "D-7");
  assert.equal(p.expirationTimestamp, Date.parse("2026-11-20T23:59:59+09:00"));
});

test("상세 tasks / required / preferred / description을 만들지 않음", () => {
  const p = mapSaraminJob(sample(), { now: NOW });
  assert.equal(p.description, "");
  assert.deepEqual(p.tasks, []);
  assert.deepEqual(p.required, []);
  assert.deepEqual(p.preferred, []);
});

test("지역: entity 해제 + '>' 주변 공백만 정리, 여러 지역은 쉼표로", () => {
  assert.equal(cleanLocation("경기&gt;성남시 분당구"), "경기 > 성남시 분당구");
  const p = mapSaraminJob(
    sample({ position: { ...sample().position, location: { name: "서울 &gt; 강남구,서울 &gt; 서초구" } } }),
    { now: NOW }
  );
  assert.equal(p.location, "서울 > 강남구, 서울 > 서초구");
  assert.deepEqual(p.locations, ["서울 > 강남구", "서울 > 서초구"]);
});

test("근무형태 여러 개 → 표시는 쉼표, 배열도 보존", () => {
  const p = mapSaraminJob(
    sample({ position: { ...sample().position, "job-type": { code: "1,4", name: "정규직,인턴직" } } }),
    { now: NOW }
  );
  assert.equal(p.employmentType, "정규직, 인턴직");
  assert.deepEqual(p.employmentTypes, ["정규직", "인턴직"]);
});

test("mapSaraminJobs: 응답 객체·배열·단일 객체, 변환 불가 항목 제외", () => {
  const ok = sample();
  assert.equal(mapSaraminJobs({ jobs: { count: 2, job: [ok, { id: "x" }] } }, { now: NOW }).length, 1);
  assert.equal(mapSaraminJobs([ok], { now: NOW }).length, 1);
  assert.equal(mapSaraminJobs({ jobs: { job: ok } }, { now: NOW }).length, 1);
  assert.deepEqual(mapSaraminJobs(null), []);
  assert.deepEqual(mapSaraminJobs({}), []);
});
