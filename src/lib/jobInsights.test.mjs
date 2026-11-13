// 실행: node --test src/lib/jobInsights.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { getCheckPoints, getComparePoints, pushRecent, MAX_RECENT } from "./jobInsights.js";

// ───── 핵심 체크 포인트 ─────
test("포트폴리오 필수 + 학사 이상 (우선순위 순서, 최대 2개)", () => {
  const job = {
    employmentType: "계약직",
    required: ["시각디자인 또는 관련 전공 학사 이상", "포트폴리오 제출 필수"],
    preferred: ["Illustrator 활용 능력"],
  };
  assert.deepEqual(getCheckPoints(job), ["포트폴리오 필수", "학사 이상"]);
});

test("근무 기간이 가장 먼저", () => {
  const job = { employmentType: "인턴", required: ["SQL 기본 문법", "6개월 근무 가능하신 분"], preferred: [] };
  assert.deepEqual(getCheckPoints(job), ["6개월 근무", "인턴"]);
});

test("졸업 예정자 + 인턴", () => {
  const job = {
    employmentType: "인턴",
    required: ["2027년 2월 졸업 예정자 또는 기졸업자", "주 5일 근무 가능하신 분"],
    preferred: ["SQL 사용 경험이 있으신 분"],
  };
  assert.deepEqual(getCheckPoints(job), ["졸업 예정자 지원 가능", "인턴"]);
});

test("우대 도구는 단어로 있을 때만 (필수에 있는 도구는 우대로 만들지 않음)", () => {
  assert.deepEqual(
    getCheckPoints({ employmentType: "정규직", required: ["SQL 기본 문법"], preferred: ["Python 경험"] }),
    ["Python 우대"]
  );
  // "NoSQL"은 SQL이 아님
  assert.deepEqual(
    getCheckPoints({ employmentType: "정규직", required: [], preferred: ["NoSQL 경험"] }),
    []
  );
});

test("우대사항의 포트폴리오는 '필수'로 만들지 않음", () => {
  assert.deepEqual(
    getCheckPoints({ employmentType: "정규직", required: ["글쓰기를 좋아하시는 분"], preferred: ["포트폴리오 제출 가능하신 분"] }),
    []
  );
});

test("정규직·애매한 조건만 있으면 아무것도 만들지 않음", () => {
  assert.deepEqual(
    getCheckPoints({ employmentType: "정규직", career: "신입", required: ["꼼꼼하신 분"], preferred: ["관심이 많으신 분"] }),
    []
  );
  assert.deepEqual(getCheckPoints(null), []);
  assert.deepEqual(getCheckPoints({}), []);
});

// ───── 비교 포인트 ─────
const base = {
  employmentType: "정규직",
  career: "신입",
  location: "서울 마포구",
  required: ["학사 이상"],
  preferred: ["SQL 경험"],
  tasks: ["캠페인 운영"],
  keywords: ["마케팅"],
};

test("1개 이하면 없음", () => {
  assert.deepEqual(getComparePoints([]), []);
  assert.deepEqual(getComparePoints([base]), []);
});

test("모두 같으면 억지로 채우지 않음", () => {
  assert.deepEqual(getComparePoints([base, { ...base }]), []);
});

test("다른 항목만, 정해진 순서로 최대 3개", () => {
  const other = {
    ...base,
    employmentType: "인턴",
    required: ["6개월 근무"],
    tasks: ["화면 개발"],
    keywords: ["프론트엔드"],
    location: "경기 성남시",
  };
  assert.deepEqual(getComparePoints([base, other]), ["근무형태", "필수조건", "주요업무"]);
});

test("업무 문장이 달라도 공통 키워드가 있으면 '주요업무'로 보지 않음", () => {
  const other = { ...base, tasks: ["광고 운영"], keywords: ["마케팅", "광고"], location: "서울 강남구" };
  assert.deepEqual(getComparePoints([base, other]), ["근무지역"]);
});

test("공백·대소문자만 다른 조건은 같은 것으로", () => {
  const other = { ...base, required: ["학사  이상"], location: "서울  마포구" };
  assert.deepEqual(getComparePoints([base, other]), []);
});

// ───── 최근 본 공고 ─────
const job = (id) => ({ id, company: `회사${id}`, title: `공고${id}`, description: "본문", keywords: ["a"] });

test("최신순, 중복 없이, 최대 5개", () => {
  let list = [];
  for (const id of ["1", "2", "3", "4", "5", "6"]) list = pushRecent(list, job(id));
  assert.equal(list.length, MAX_RECENT);
  assert.deepEqual(list.map((j) => j.id), ["6", "5", "4", "3", "2"]);
  list = pushRecent(list, job("4"));
  assert.deepEqual(list.map((j) => j.id), ["4", "6", "5", "3", "2"]);
});

test("필요한 필드만 저장", () => {
  const [snap] = pushRecent([], { ...job("x"), tasks: ["t"], secret: "no", companyType: "스타트업" });
  assert.deepEqual(Object.keys(snap).sort(), [
    "career", "company", "deadline", "description", "employmentType", "id", "keywords", "location", "originalUrl", "title",
  ]);
});

test("잘못된 공고는 기록하지 않음", () => {
  assert.deepEqual(pushRecent([job("1")], null).map((j) => j.id), ["1"]);
  assert.deepEqual(pushRecent([], { title: "id 없음" }), []);
});

test("같은 공고를 정보가 적은 상태로 다시 기록해도 이전 본문 유지", () => {
  const list = pushRecent([], job("1"));
  const [snap] = pushRecent(list, { id: "1", company: "회사1", title: "공고1" });
  assert.equal(snap.description, "본문");
  assert.deepEqual(snap.keywords, ["a"]);
});

// ───── 공고별 핵심 포인트 ─────
import { getPostingHighlights } from "./jobInsights.js";
const texts = (h) => h.points.map((p) => p.text);
const P = (o) => ({ id: o.id, employmentType: "정규직", required: [], preferred: [], keywords: [], ...o });

test("3개 중 한 공고만 근무형태 다름 → 그 공고에만 근무형태 포인트", () => {
  const [a, b, c] = getPostingHighlights([P({ id: "a", employmentType: "인턴" }), P({ id: "b" }), P({ id: "c" })]);
  assert.deepEqual(texts(a), ["인턴"]);
  assert.deepEqual(texts(b), []);
  assert.deepEqual(texts(c), []);
});

test("한 공고에만 있는 키워드 → 그 공고 후보 (최대 2개를 한 줄로)", () => {
  const [a, b] = getPostingHighlights([
    P({ id: "a", keywords: ["CRM", "메시지 마케팅", "성과 분석", "공통"] }),
    P({ id: "b", keywords: ["광고 운영", "공통"] }),
  ]);
  assert.deepEqual(texts(a), ["CRM · 메시지 마케팅"]);
  assert.deepEqual(texts(b), ["광고 운영"]);
});

test("공백·대소문자만 다르면 같은 키워드 (고유 아님), 의미가 비슷해도 표현이 다르면 다른 키워드", () => {
  const [a, b] = getPostingHighlights([
    P({ id: "a", keywords: ["데이터 분석", "콘텐츠"] }),
    P({ id: "b", keywords: ["데이터분석", "콘텐츠 마케팅"] }),
  ]);
  assert.deepEqual(texts(a), ["콘텐츠"]);
  assert.deepEqual(texts(b), ["콘텐츠 마케팅"]);
});

test("필수(required)와 우대(preferred)를 섞지 않음", () => {
  const [a, b] = getPostingHighlights([
    P({ id: "a", required: ["포트폴리오 제출 필수"], preferred: ["Figma 경험"] }),
    P({ id: "b", required: ["Figma 기본 사용"], preferred: ["포트폴리오 있으면 좋음"] }),
  ]);
  assert.deepEqual(a.points, [
    { text: "포트폴리오 필수", kind: "required" },
    { text: "Figma 우대", kind: "preferred" },
  ]);
  // b의 필수 Figma는 '우대'로, 우대 포트폴리오는 '필수'로 만들지 않음
  assert.deepEqual(b.points, []);
});

test("다른 공고에도 있는 필수조건은 고유 포인트 아님", () => {
  const [a, b] = getPostingHighlights([
    P({ id: "a", required: ["학사 이상", "6개월 근무 가능"] }),
    P({ id: "b", required: ["학사 이상"] }),
  ]);
  assert.deepEqual(texts(a), ["6개월 근무"]);
  assert.deepEqual(texts(b), []);
});

test("최대 3개 (우선순위: 근무형태 → 필수 → 키워드 → 우대)", () => {
  const [a] = getPostingHighlights([
    P({
      id: "a",
      employmentType: "인턴",
      required: ["포트폴리오 필수", "학사 이상"],
      keywords: ["CRM"],
      preferred: ["SQL 경험"],
    }),
    P({ id: "b" }),
  ]);
  assert.deepEqual(texts(a), ["인턴", "포트폴리오 필수", "학사 이상"]);
});

test("중복 제거 / 고유 포인트 없으면 빈 배열 / 1개 이하는 비교 안 함", () => {
  const [a] = getPostingHighlights([P({ id: "a", keywords: ["CRM", "crm "] }), P({ id: "b" })]);
  assert.deepEqual(texts(a), ["CRM"]);
  const same = getPostingHighlights([P({ id: "a" }), P({ id: "b" })]);
  assert.deepEqual(same.map(texts), [[], []]);
  assert.deepEqual(getPostingHighlights([P({ id: "a", keywords: ["CRM"] })]).map(texts), [[]]);
});

// ───── 카드 체크 포인트: 사람인 근무형태 값 (검색 필터와 같은 분류) ─────
test("사람인 인턴직/계약직 값 → '인턴' / '계약직' 체크 포인트", () => {
  const cp = (employmentTypes) => getCheckPoints({ employmentTypes, required: [], preferred: [] });
  assert.deepEqual(cp(["인턴직"]), ["인턴"]);
  assert.deepEqual(cp(["인턴직 (정규직 전환가능)"]), ["인턴"]);
  assert.deepEqual(cp(["계약직"]), ["계약직"]);
  assert.deepEqual(cp(["계약직 (정규직 전환가능)"]), ["계약직"]);
});

test("정규직 (수습기간)·파견직·프리랜서는 근무형태 체크 포인트 없음", () => {
  const cp = (employmentTypes) => getCheckPoints({ employmentTypes, required: [], preferred: [] });
  assert.deepEqual(cp(["정규직 (수습기간)"]), []);
  assert.deepEqual(cp(["파견직"]), []);
  assert.deepEqual(cp(["프리랜서"]), []);
});

test("근무 기간·우대 도구와 함께여도 순서·최대 2개 유지", () => {
  assert.deepEqual(
    getCheckPoints({ employmentTypes: ["인턴직 (정규직 전환가능)"], required: ["6개월 근무 가능"], preferred: ["SQL"] }),
    ["6개월 근무", "인턴"]
  );
});
