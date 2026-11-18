import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeMainDifference } from "./compareText.js";
import { filterSimilarRoles, filterUnclearPoints, postingTitle } from "./analysisText.js";

// ───── 가장 큰 차이: 공고별 키워드 한 줄 ─────

test("가장 큰 차이: 공고 수만큼 줄이면 그대로 (키워드 · 키워드)", () => {
  const text = "React · 신규 기능 · 반응형 UI\nNext.js · TypeScript · 어드민 · API 연동\n운영 · 유지보수 · HTML/CSS/JavaScript";
  assert.equal(normalizeMainDifference(text, 3), text);
});

test("가장 큰 차이: 줄 앞 번호·이름과 끝의 '중심.'은 정리", () => {
  const text = "첫 번째는 React · 신규 기능 · 반응형 UI 중심.\n두 번째: Next.js · TypeScript · 어드민.\nC) 운영 · 유지보수";
  assert.equal(
    normalizeMainDifference(text, 3),
    "React · 신규 기능 · 반응형 UI\nNext.js · TypeScript · 어드민\n운영 · 유지보수"
  );
});

test("가장 큰 차이: ' / '로 나눈 한 줄도 공고 수가 맞으면 줄로", () => {
  assert.equal(normalizeMainDifference("CRM · 캠페인 운영 / 광고 집행 · 성과 분석", 2), "CRM · 캠페인 운영\n광고 집행 · 성과 분석");
});

test("가장 큰 차이: 형식을 어긴 긴 문단은 기존처럼 최대 3문장 (화면은 문단으로 표시)", () => {
  const long = "첫 번째는 A 중심. 두 번째는 B 중심. 세 번째는 C 중심. 네 번째 문장.";
  const out = normalizeMainDifference(long, 2);
  assert.equal(out.includes("\n"), false);
  assert.equal(out, "첫 번째는 A 중심. 두 번째는 B 중심. 세 번째는 C 중심.");
  assert.equal(normalizeMainDifference("", 2), "");
  assert.equal(normalizeMainDifference(null, 2), "");
});

test("가장 큰 차이: 줄 수가 공고 수와 다르면 줄로 쪼개지 않음", () => {
  const out = normalizeMainDifference("React · 신규 기능\nNext.js · 어드민\n운영", 2);
  assert.equal(out.includes("\n"), false);
});

// ───── 확인하고 지원하세요 ─────

test("확인할 점: '불명확한 부분 없음' 같은 빈 항목은 제거 (화면은 '발견되지 않았어요')", () => {
  const out = filterUnclearPoints(
    ["공고만으로 특별히 불명확한 부분은 없었어요.", "없음", "추가로 확인이 필요한 항목이 없습니다."],
    {}
  );
  assert.deepEqual(out, []);
});

test("확인할 점: 공고에 이미 적힌 조건을 그대로 반복한 항목은 제거, 구체적인 항목은 유지", () => {
  const out = filterUnclearPoints(
    [
      "포트폴리오 제출",
      "정규직 전환 여부가 공고에 명시되지 않았어요. 지원 전에 전환 조건을 확인해보세요.",
      "정규직 전환 여부가 공고에 명시되지 않았어요. 지원 전에 전환 조건을 확인해보세요.",
    ],
    { required: ["포트폴리오 제출"], tasks: ["화면 개발"] }
  );
  assert.deepEqual(out, ["정규직 전환 여부가 공고에 명시되지 않았어요. 지원 전에 전환 조건을 확인해보세요."]);
  assert.deepEqual(filterUnclearPoints(null), []);
});

// ───── 프롬프트 원칙이 들어 있는지 ─────

test("비교 프롬프트: 공고별 키워드 줄 형식, 단정 표현 금지, 반복 금지", () => {
  const src = readFileSync(new URL("../app/api/compare-jobs/route.js", import.meta.url), "utf8");
  assert.match(src, /React · 신규 기능 · 반응형 UI\\\\nNext\.js · TypeScript · 어드민 · API 연동/);
  assert.match(src, /실제로 있는 표현에서만 고릅니다/);
  assert.match(src, /직무 범위를 단정하지 않습니다/);
  assert.match(src, /같은 내용을 여러 필드에서 반복하지 않습니다/);
});

test("분석 프롬프트: 단정 표현 대신 경향 표현, 확인할 점은 없으면 빈 배열", () => {
  const src = readFileSync(new URL("../app/api/analyze-job/route.js", import.meta.url), "utf8");
  assert.match(src, /"항상", "오직", "~만 담당", "반드시"/);
  assert.match(src, /더 초점을 두는 경우가 많습니다/);
  assert.match(src, /공고에 이미 적힌 내용.*다시 "확인 필요"로 쓰지 않습니다/);
  assert.match(src, /확인할 점이 없으면 억지로 채우지 말고 빈 배열/);
});

// ───── 확인할 점: 사소한 숙련도 항목 줄이기 ─────

test("확인할 점: 기술 숙련도 세부 수준만 묻는 항목은 제외", () => {
  const out = filterUnclearPoints([
    "SQL 기본 문법의 구체적인 수준은 공고에 명시되지 않았어요. 지원 전에 요구 수준을 확인해보세요.",
    "Python 숙련도는 공고에 적혀 있지 않아요.",
    "커뮤니케이션 능력 수준은 공고에 명시되지 않았어요.",
  ]);
  assert.deepEqual(out, []);
});

test("확인할 점: 전환 여부·근무 기간·필수 여부 같은 중요한 항목은 유지", () => {
  const important = [
    "정규직 전환 여부가 공고에 명시되지 않았어요. 지원 전에 전환 조건을 확인해보세요.",
    "근무 기간이 공고에 적혀 있지 않아요. 인턴 기간을 확인해보세요.",
    "Figma가 실제 필수인지 공고에 명시되지 않았어요. 지원 전에 확인해보세요.",
    "재택 근무 가능 여부가 공고에 나와 있지 않아요.",
  ];
  assert.deepEqual(filterUnclearPoints(important), important);
});

test("확인할 점: 공고가 요구 수준을 모호하게 적은 경우(실무 수준·고급)는 예외로 유지", () => {
  const vague = [
    "'실무 수준'의 SQL이 어느 정도인지 공고에 명시되지 않았어요. 지원 전에 확인해보세요.",
    "Excel 고급 활용의 구체적인 수준은 공고에 명시되지 않았어요.",
  ];
  assert.deepEqual(filterUnclearPoints(vague), vague);
});

// ───── 비슷한 직무: 사실상 같은 직무 제외 ─────

const names = (list) => list.map((r) => r.name);
const roles = (...list) => list.map((name) => ({ name, difference: "차이" }));

test("비슷한 직무: 지금 직무와 같은 직무(경력 단계만 다름)는 제외, 인접 직무는 유지", () => {
  const out = filterSimilarRoles(
    roles("데이터 분석가", "주니어 데이터 분석가", "신입 데이터 분석가", "데이터 엔지니어", "BI 분석가", "데이터 사이언티스트"),
    ["데이터 분석 인턴"]
  );
  assert.deepEqual(names(out), ["데이터 엔지니어", "BI 분석가", "데이터 사이언티스트"]);
});

test("비슷한 직무: 기술 스택 이름만 붙은 같은 직무는 제외, BI·UI 같은 약어 직무는 유지", () => {
  const out = filterSimilarRoles(
    roles("React 프론트엔드 개발자", "주니어 프론트엔드 개발자", "웹 개발자", "백엔드 개발자", "UI 엔지니어"),
    ["프론트엔드 개발자"]
  );
  assert.deepEqual(names(out), ["웹 개발자", "백엔드 개발자", "UI 엔지니어"]);
  // 반대 방향 (지금 직무에 기술 스택 이름이 붙은 경우)
  assert.deepEqual(names(filterSimilarRoles(roles("프론트엔드 개발자", "풀스택 개발자"), ["React 프론트엔드 개발자"])), [
    "풀스택 개발자",
  ]);
});

test("비슷한 직무: 이름이 비슷해도 핵심이 다르면 유지, 지금 직무를 모르면 그대로", () => {
  assert.deepEqual(
    names(filterSimilarRoles(roles("CRM 마케터", "퍼포먼스 마케터", "콘텐츠 마케터"), ["CRM 마케팅 어시스턴트 (인턴)"])),
    ["CRM 마케터", "퍼포먼스 마케터", "콘텐츠 마케터"]
  );
  assert.deepEqual(names(filterSimilarRoles(roles("데이터 분석가"), ["", "없음"])), ["데이터 분석가"]);
  assert.deepEqual(filterSimilarRoles(null, ["a"]), []);
});

test("분석 입력의 공고명 줄 읽기 (검색 공고에서 넘어온 경우)", () => {
  assert.equal(postingTitle("공고명: 데이터 분석 인턴\n회사명: A\n\n본문"), "데이터 분석 인턴");
  assert.equal(postingTitle("그냥 붙여넣은 공고"), "");
});

test("분석 프롬프트: 숙련도 세부 수준만으로 확인 항목 금지, 인접 직무만", () => {
  const src = readFileSync(new URL("../app/api/analyze-job/route.js", import.meta.url), "utf8");
  assert.match(src, /단순히 기술 숙련도의 세부 수준이 적혀 있지 않다는 이유만으로 확인 필요 항목을 만들지 않습니다/);
  assert.match(src, /지원 여부, 계약·근무 조건, 채용 절차, 실제 업무 범위에 영향을 줄 수 있는 정보/);
  assert.match(src, /지금 직무와 같거나 사실상 같은 직무는 넣지 않습니다/);
});
