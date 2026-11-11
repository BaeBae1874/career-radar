// 실행: node --test src/lib/polishText.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { polishText } from "./polishText.js";

const fixes = [
  ["어assistant 업무를 맡아요.", "어시스턴트 업무를 맡아요."],
  ["마케팅 assistant 수준의 업무예요.", "마케팅 어시스턴트 수준의 업무예요."],
  ["글riting 역량이 필요해요.", "글쓰기 역량이 필요해요."],
  ["카피riting 업무가 있어요.", "카피라이팅 업무가 있어요."],
  ["REQUIRED 조건이에요.", "필수 조건이에요."],
  ["PREFERRED 조건이에요.", "우대 조건이에요."],
  ["REQUIRED 수준인지 여부는 unclear.", "필수 수준인지 여부는 명확하지 않아요."],
  ["unclear 부분이 있어요.", "불명확한 부분이 있어요."],
  ["업무 비중이 높아요 but 지표 확인도 있어요.", "업무 비중이 높아요 하지만 지표 확인도 있어요."],
  ["CRM versus 퍼포먼스", "CRM ↔ 퍼포먼스"],
  ["CRM vs 퍼포먼스", "CRM ↔ 퍼포먼스"],
  ["CRM vs. 퍼포먼스", "CRM ↔ 퍼포먼스"],
  ["성과를 정리해요~해요.", "성과를 정리해요."],
];

for (const [input, expected] of fixes) {
  test(`보정: ${input}`, () => assert.equal(polishText(input), expected));
}

// 정상 용어·고유명사는 그대로
const unchanged = [
  "CRM, SQL, GA4, ROAS, CPA 지표를 다뤄요.",
  "Meta, Google 광고를 운영해요.",
  "Google Analytics와 GA4를 활용해요.",
  "Photoshop, Figma 사용 경험을 우대해요.",
  "SNS 채널과 API 연동 업무가 있어요.",
  "Marketing Assistant 포지션이에요.",
  "vsCode와 Canvas를 써요.",
  "GA4활용, Meta광고처럼 붙여 써도 그대로예요.",
];

for (const input of unchanged) {
  test(`변경 없음: ${input}`, () => assert.equal(polishText(input), input));
}

test("한글이 없는 문자열은 그대로", () => {
  assert.equal(polishText("Google Analytics"), "Google Analytics");
  assert.equal(polishText("required"), "required");
});

test("원문에 있는 영어 표현은 보존", () => {
  const source = "우대사항: required skills 확인, but 협업 가능";
  assert.equal(polishText("required 항목을 확인해요.", source), "required 항목을 확인해요.");
  assert.equal(polishText("but 조건이 있어요.", source), "but 조건이 있어요.");
  assert.equal(polishText("글riting 과제", "제출: 글riting 과제"), "글riting 과제");
});
