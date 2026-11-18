import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysIso,
  dDayLabel,
  daysUntil,
  formatShortDate,
  getApplicationSchedule,
  kstDateFromMs,
  normalizeCloseType,
  normalizeIsoDate,
  normalizeWorkPeriod,
  pickScheduleFields,
  scheduleLine,
} from "./schedule.js";
import { mapSaraminJob } from "./saraminMapper.js";
import { toSavedSnapshot, toSavedItem } from "./savedJobs.js";
import { toComparisonPosting, toComparisonSnapshot, toSavedComparisonItem } from "./savedComparisons.js";
import { getSampleJobs } from "../app/api/jobs/sampleJobs.js";

// 기준 시각: 한국 2026-11-18 12:00 (UTC 03:00)
const NOW = Date.parse("2026-11-18T03:00:00Z");

// ───── D-Day ─────

test("미래 마감 D-14, 내일 D-1, 당일 D-Day, 지난 날짜 마감", () => {
  assert.equal(dDayLabel(daysUntil("2026-12-02", NOW)), "D-14");
  assert.equal(dDayLabel(daysUntil("2026-11-19", NOW)), "D-1");
  assert.equal(dDayLabel(daysUntil("2026-11-18", NOW)), "D-Day");
  assert.equal(dDayLabel(daysUntil("2026-11-17", NOW)), "마감");
});

test("KST·날짜 기준: 한국 자정 직후·직전에도 하루 밀리지 않음", () => {
  const justAfterMidnightKst = Date.parse("2026-11-17T15:00:30Z"); // 한국 11-18 00:00:30
  const justBeforeMidnightKst = Date.parse("2026-11-18T14:59:30Z"); // 한국 11-18 23:59:30
  for (const now of [justAfterMidnightKst, justBeforeMidnightKst]) {
    assert.equal(daysUntil("2026-11-18", now), 0);
    assert.equal(daysUntil("2026-12-02", now), 14);
  }
  // UTC로는 아직 11-17이지만 한국은 11-18 → 11-17 마감은 이미 지남
  assert.equal(dDayLabel(daysUntil("2026-11-17", justAfterMidnightKst)), "마감");
  assert.equal(kstDateFromMs(Date.parse("2026-11-30T15:30:00Z")), "2026-12-01");
});

test("채용시·상시·수시: D-Day를 만들지 않음 (마감일이 있어도)", () => {
  for (const [type, text] of [
    ["rolling", "채용시 마감"],
    ["always", "상시채용"],
    ["occasional", "수시채용"],
  ]) {
    const s = getApplicationSchedule({ closeType: type, applicationEndDate: "2026-12-02" }, NOW);
    assert.equal(s.text, text);
    assert.equal(s.status, "");
    assert.equal(scheduleLine({ closeType: type }, NOW), text);
  }
});

test("모집 시작+마감 / 마감만 / 시작만 표시", () => {
  const both = { applicationStartDate: "2026-11-18", applicationEndDate: "2026-12-02", closeType: "deadline" };
  assert.equal(getApplicationSchedule(both, NOW).text, "11.18 ~ 12.02 · D-14");
  assert.equal(scheduleLine(both, NOW), "모집 11.18 ~ 12.02 · D-14");
  assert.equal(getApplicationSchedule({ applicationEndDate: "2026-12-02" }, NOW).text, "12.02 마감 · D-14");
  assert.equal(getApplicationSchedule({ applicationStartDate: "2026-11-20" }, NOW).text, "11.20부터 접수");
  assert.equal(getApplicationSchedule({ applicationStartDate: "2026-11-01", applicationEndDate: "2026-11-10" }, NOW).text, "11.01 ~ 11.10 · 마감");
  // 다른 해는 연도까지
  assert.equal(formatShortDate("2027-01-05", NOW), "2027.01.05");
});

test("잘못된 날짜·값은 안전하게 무시, 아무 정보도 없으면 예전 마감 문구 또는 빈 값", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "내일", "", null, 20261202, "2026-12-02T00:00:00Z"]) {
    assert.equal(normalizeIsoDate(bad), "", String(bad));
  }
  assert.equal(normalizeIsoDate("2026.12.2"), "2026-12-02");
  assert.equal(daysUntil("nope", NOW), null);
  assert.equal(dDayLabel(null), "");
  assert.equal(getApplicationSchedule({ applicationEndDate: "2026-02-30" }, NOW).text, "");
  assert.equal(getApplicationSchedule({ deadline: "D-7" }, NOW).text, "D-7"); // 예전 저장 데이터
  assert.equal(getApplicationSchedule({}, NOW).text, "");
  assert.equal(getApplicationSchedule(null, NOW).text, "");
  assert.equal(normalizeCloseType("상시 채용"), "always");
  assert.equal(normalizeCloseType("unknown"), "");
  assert.equal(addDaysIso("2026-11-30", 2), "2026-12-02");
});

test("근무기간: 구체적인 기간만 ('인턴' 같은 단어만은 제외)", () => {
  assert.equal(normalizeWorkPeriod("2027년 1월부터 6개월"), "2027년 1월부터 6개월");
  assert.equal(normalizeWorkPeriod("인턴"), "");
  assert.equal(normalizeWorkPeriod("미정"), "");
  assert.equal(normalizeWorkPeriod("6개월 " + "x".repeat(300)).length, 100);
});

// ───── 사람인 mapper ─────

const OPENING = Math.floor(Date.parse("2026-11-17T15:00:00Z") / 1000); // 한국 11-18 00:00
const EXPIRATION = Math.floor(Date.parse("2026-12-02T14:59:59Z") / 1000); // 한국 12-02 23:59:59
const POSTED = Math.floor(Date.parse("2026-11-10T00:00:00Z") / 1000);
const saraminJob = (closeCode) => ({
  id: "123",
  position: { title: "데이터 분석 인턴" },
  "posting-timestamp": String(POSTED),
  "opening-timestamp": String(OPENING),
  "expiration-timestamp": String(EXPIRATION),
  ...(closeCode ? { "close-type": { code: String(closeCode), name: "x" } } : {}),
});

test("사람인: opening → 접수 시작일, expiration → 접수 마감일 (close-type 1), 게시일은 쓰지 않음", () => {
  const p = mapSaraminJob(saraminJob(1), { now: NOW });
  assert.equal(p.applicationStartDate, "2026-11-18");
  assert.equal(p.applicationEndDate, "2026-12-02");
  assert.equal(p.closeType, "deadline");
  assert.equal(p.workPeriod, ""); // 근무 시작일로 쓰지 않음
  assert.notEqual(p.applicationStartDate, kstDateFromMs(POSTED * 1000));
  assert.equal(getApplicationSchedule(p, NOW).text, "11.18 ~ 12.02 · D-14");
  assert.equal(p.deadline, "D-14"); // 기존 문자열도 그대로
});

test("사람인: close-type 2·3·4는 채용시·상시·수시, 고정 마감일 없음", () => {
  for (const [code, type, text] of [
    [2, "rolling", "채용시 마감"],
    [3, "always", "상시채용"],
    [4, "occasional", "수시채용"],
  ]) {
    const p = mapSaraminJob(saraminJob(code), { now: NOW });
    assert.equal(p.closeType, type);
    assert.equal(p.applicationEndDate, "");
    assert.equal(p.applicationStartDate, "2026-11-18");
    assert.equal(getApplicationSchedule(p, NOW).text, text);
  }
});

test("사람인: 접수 시각이 없으면 빈 값 (게시일로 채우지 않음)", () => {
  const job = saraminJob(1);
  delete job["opening-timestamp"];
  const p = mapSaraminJob(job, { now: NOW });
  assert.equal(p.applicationStartDate, "");
  assert.equal(getApplicationSchedule(p, NOW).text, "12.02 마감 · D-14");
});

// ───── 샘플 데이터 ─────

test("샘플: 고정 마감·채용시·상시·수시가 섞여 있고, 근무기간은 일부 인턴 샘플에만", () => {
  const jobs = getSampleJobs(NOW);
  const types = new Set(jobs.map((j) => j.closeType));
  for (const t of ["deadline", "rolling", "always", "occasional"]) assert.ok(types.has(t), t);
  const lines = jobs.map((j) => getApplicationSchedule(j, NOW).text);
  assert.ok(new Set(lines).size >= 8, "샘플마다 일정이 다양해야 함");
  assert.ok(lines.some((t) => t.endsWith("D-Day")));
  assert.ok(lines.some((t) => t.endsWith("D-1")));
  const withWork = jobs.filter((j) => j.workPeriod);
  assert.ok(withWork.length >= 1 && withWork.length < jobs.filter((j) => j.employmentType === "인턴").length);
  assert.ok(withWork.every((j) => j.employmentType === "인턴" && j.description.includes(j.workPeriod)));
  // 근무기간 줄은 업무·조건 목록에 섞이지 않음
  assert.ok(withWork.every((j) => !j.tasks.some((t) => t.includes("근무기간"))));
});

// ───── 저장 snapshot 호환 ─────

const scheduled = {
  id: "sample-1",
  title: "CRM 마케팅 인턴",
  company: "오렌지커머스",
  applicationStartDate: "2026-11-18",
  applicationEndDate: "2026-12-02",
  closeType: "deadline",
  workPeriod: "2027년 1월부터 6개월",
  tasks: ["업무"],
};

test("관심 공고·비교 snapshot: 일정 필드 유지, 잘못된 값은 버림", () => {
  const saved = toSavedSnapshot(scheduled);
  assert.deepEqual(pickScheduleFields(saved), pickScheduleFields(scheduled));
  const posting = toComparisonPosting(scheduled);
  assert.equal(posting.applicationEndDate, "2026-12-02");
  assert.equal(posting.workPeriod, "2027년 1월부터 6개월");
  const bad = toSavedSnapshot({ ...scheduled, applicationEndDate: "2026-02-30", closeType: "<b>x</b>" });
  assert.equal("applicationEndDate" in bad, false);
  assert.equal("closeType" in bad, false);
});

test("예전 저장 데이터(일정 필드 없음)도 그대로 열림", () => {
  const item = toSavedItem({ job_id: "sample-1", job_snapshot: { title: "CRM", deadline: "D-7" }, created_at: "" });
  assert.equal(getApplicationSchedule(item.job, NOW).text, "D-7");
  assert.equal("applicationEndDate" in item.job, false);
  const comparison = toSavedComparisonItem({
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    comparison_snapshot: { postings: [{ id: "a", title: "A" }, { id: "b", title: "B", deadline: "상시채용" }] },
    created_at: "",
  });
  assert.equal(comparison.postings.length, 2);
  assert.equal(getApplicationSchedule(comparison.postings[1], NOW).text, "상시채용");
  const withSchedule = toComparisonSnapshot([scheduled, { ...scheduled, id: "b", closeType: "rolling" }]);
  assert.equal(withSchedule.postings[1].closeType, "rolling");
});
