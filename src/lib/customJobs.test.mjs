import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LIMITS,
  PREVIEW_EMPTY_HINT,
  addToCompareState,
  appearsInPosting,
  customJobId,
  fromPreviewEdit,
  isStructuredOnly,
  normalizeStructured,
  readDraft,
  sanitizeCustomInput,
  stripTags,
  toCustomJobItem,
  toCustomSnapshot,
  toPostingText,
  toPreviewEdit,
} from "./customJobs.js";
import { deleteCustomJob, insertCustomJob, listCustomJobs, updateCustomJob } from "./customJobsDb.js";
import { restoreCompareJobs, toComparisonPosting, toComparisonSnapshot } from "./savedComparisons.js";
import { getComparePoints, getPostingHighlights } from "./jobInsights.js";

const POSTING = `[오렌지커머스] CRM 마케팅 인턴
근무형태: 인턴 (3개월)
근무지: 서울 강남구
마감: 2026-12-31

주요 업무
- 고객 데이터를 분석해 타깃 캠페인을 기획합니다.
- 이메일, 앱푸시 CRM 캠페인을 운영합니다.

자격요건
- 데이터 기반으로 문제를 해결할 수 있는 분

우대사항
- SQL 또는 GA4 사용 경험`;

const ROW_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ROW_ID_2 = "9b2504e0-4f89-11d3-9a0c-0305e82c3302";

const customJob = (rowId = ROW_ID, extra = {}) => ({
  id: customJobId(rowId),
  source: "custom",
  company: "오렌지커머스",
  title: "CRM 마케팅 인턴",
  employmentType: "인턴",
  tasks: ["고객 데이터를 분석해 타깃 캠페인을 기획합니다."],
  required: ["데이터 기반으로 문제를 해결할 수 있는 분"],
  preferred: ["SQL 또는 GA4 사용 경험"],
  keywords: ["CRM", "SQL"],
  ...extra,
});

const sampleJob = (n) => ({
  id: `sample-${n}`,
  source: "sample",
  company: `샘플회사${n}`,
  title: `퍼포먼스 마케터 ${n}`,
  employmentType: "정규직",
  career: "신입",
  tasks: ["광고 집행과 성과 분석"],
  required: ["학사 이상"],
  preferred: [],
  keywords: ["광고", "ROAS"],
  description: "샘플 본문",
});

// ───── 가짜 Supabase (쿼리 기록) ─────

function fakeSupabase(result = { data: null, error: null }) {
  const calls = [];
  const builder = {
    calls,
    from(table) {
      calls.push(["from", table]);
      return builder;
    },
  };
  for (const op of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
    builder[op] = (...args) => {
      calls.push([op, ...args]);
      return builder;
    };
  }
  builder.single = builder.maybeSingle = async () => result;
  builder.then = (resolve) => resolve(result); // await 체인 끝 (order/limit/delete 뒤)
  return builder;
}

const row = (id = ROW_ID, snapshot = toCustomSnapshot(customJob(id))) => ({
  id,
  company: snapshot.company,
  title: snapshot.title,
  structured_snapshot: snapshot,
  created_at: "2026-11-17T01:00:00Z",
});

// 1. 직접 입력 공고 sanitize
test("1. 입력 정리: 회사명·공고명·본문 필수, 공백·태그 정리", () => {
  const r = sanitizeCustomInput({ company: "  오렌지<b>커머스</b> ", title: " CRM 마케팅 인턴 ", posting: POSTING });
  assert.equal(r.ok, true);
  assert.equal(r.company, "오렌지 커머스");
  assert.equal(r.title, "CRM 마케팅 인턴");
  assert.ok(r.posting.includes("주요 업무\n- 고객 데이터를"));
  assert.equal(sanitizeCustomInput({ company: "", title: "a", posting: POSTING }).ok, false);
  assert.equal(sanitizeCustomInput({ company: "a", title: "", posting: POSTING }).ok, false);
  assert.equal(sanitizeCustomInput({ company: "a", title: "b", posting: "짧음" }).ok, false);
  assert.equal(sanitizeCustomInput(null).ok, false);
});

// 2. 공고에 없는 필드는 빈 값
test("2. AI가 빈 값으로 준 필드·'없음' 같은 값은 빈 값으로 (임의로 채우지 않음)", () => {
  const s = normalizeStructured(
    {
      tasks: ["고객 데이터를 분석해 타깃 캠페인을 기획합니다."],
      required: [],
      preferred: "없음",
      keywords: ["CRM"],
      employmentType: "",
      career: "없음",
      location: null,
      deadline: "미기재",
    },
    POSTING
  );
  assert.deepEqual(s.required, []);
  assert.deepEqual(s.preferred, []);
  assert.equal(s.employmentType, "");
  assert.deepEqual(s.employmentTypes, []);
  assert.equal(s.career, "");
  assert.equal(s.location, "");
  assert.equal(s.deadline, "");
  assert.deepEqual(s.tasks, ["고객 데이터를 분석해 타깃 캠페인을 기획합니다."]);
  assert.deepEqual(normalizeStructured(null, POSTING).tasks, []);
});

// 3. 배열 제한
test("3. tasks·required·preferred·keywords 개수와 길이 제한", () => {
  const longPosting = Array.from({ length: 40 }, (_, i) => `업무 항목 번호 ${i} 를 처리합니다`).join("\n") + "\n" + "가".repeat(400);
  const s = normalizeStructured(
    {
      tasks: Array.from({ length: 40 }, (_, i) => `업무 항목 번호 ${i} 를 처리합니다`),
      required: ["가".repeat(400)],
      keywords: Array.from({ length: 30 }, (_, i) => `업무 항목 번호 ${i}`),
    },
    longPosting
  );
  assert.equal(s.tasks.length, LIMITS.listItems);
  assert.ok(s.required[0].length <= LIMITS.listItemLength);
  assert.ok(s.keywords.length <= LIMITS.keywords);
  const snap = toCustomSnapshot({ company: "A", title: "B", tasks: Array.from({ length: 50 }, (_, i) => `t${i}`) });
  assert.equal(snap.tasks.length, 20);
});

// 4. 너무 긴 입력 차단
test("4. 너무 긴 회사명·공고명·본문은 거부", () => {
  assert.equal(sanitizeCustomInput({ company: "a".repeat(101), title: "b", posting: POSTING }).ok, false);
  assert.equal(sanitizeCustomInput({ company: "a", title: "b".repeat(201), posting: POSTING }).ok, false);
  const r = sanitizeCustomInput({ company: "a", title: "b", posting: "x".repeat(LIMITS.posting + 1) });
  assert.equal(r.ok, false);
  assert.match(r.error, /15,000자/);
});

// 5. URL/HTML/script
test("5. HTML·script·javascript: URL은 글자로만 남기고 실행될 수 있는 형태는 제거", () => {
  assert.equal(stripTags('<script>alert(1)</script>안녕<img src=x onerror="x">'), " 안녕 ");
  const snap = toCustomSnapshot({
    company: "<b>A</b>사",
    title: "<script>alert('x')</script>개발자",
    tasks: ["<a href='javascript:alert(1)'>화면 개발</a>"],
    originalUrl: "javascript:alert(1)",
  });
  assert.equal(snap.company, "A 사");
  assert.equal(snap.title, "개발자");
  assert.deepEqual(snap.tasks, ["화면 개발"]);
  assert.equal("originalUrl" in snap, false);
  assert.equal(JSON.stringify(snap).includes("<"), false);
  assert.equal(JSON.stringify(snap).toLowerCase().includes("javascript:"), false);
  const input = sanitizeCustomInput({ company: "A", title: "B", posting: `<script>x</script>${POSTING}` });
  assert.equal(input.posting.includes("<script>"), false);
});

// 6. 본인 custom job 저장
test("6. 저장: user_id는 서버가 넘긴 값, 저장 전 다시 정리, 원문(description)·클라이언트 user_id 무시", async () => {
  const snapshot = toCustomSnapshot(customJob());
  const db = fakeSupabase({ data: row(ROW_ID, snapshot), error: null });
  const r = await insertCustomJob(db, "server-user-id", {
    ...customJob(),
    user_id: "attacker",
    description: POSTING,
    tasks: ["<b>업무</b>"],
  });
  assert.equal(r.ok, true);
  const insert = db.calls.find((c) => c[0] === "insert")[1];
  assert.equal(insert.user_id, "server-user-id");
  assert.equal("description" in insert.structured_snapshot, false);
  assert.deepEqual(insert.structured_snapshot.tasks, ["업무"]);
  assert.equal(insert.structured_snapshot.source, "custom");
  assert.equal(r.item.job.id, customJobId(ROW_ID));
  assert.equal((await insertCustomJob(fakeSupabase(), "u", { title: "제목만" })).status, 400);
});

// 7. 다른 사용자 접근 차단 (RLS)
test("7. migration: RLS 켜짐, anon 권한 없음, 본인 row만 조회·추가·수정·삭제, 원문 컬럼 없음", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261117000000_career_custom_jobs.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.career_custom_jobs enable row level security/);
  assert.match(sql, /revoke all on table public\.career_custom_jobs from anon/);
  assert.match(sql, /grant select, insert, update, delete on table public\.career_custom_jobs to authenticated/);
  for (const action of ["select", "delete"]) {
    assert.match(sql, new RegExp(`for ${action}\\s+to authenticated\\s+using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`));
  }
  assert.match(sql, /for insert\s+to authenticated\s+with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(
    sql,
    /for update\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\)/
  );
  assert.doesNotMatch(sql, /posting|description|raw_text|original/i);
});

test("7-2. 모든 DB 요청에 로그인 사용자 조건(user_id)이 붙음", async () => {
  const list = fakeSupabase({ data: [], error: null });
  await listCustomJobs(list, "me");
  assert.ok(list.calls.some((c) => c[0] === "eq" && c[1] === "user_id" && c[2] === "me"));
  const del = fakeSupabase({ error: null });
  await deleteCustomJob(del, "me", ROW_ID);
  assert.ok(del.calls.some((c) => c[0] === "eq" && c[1] === "user_id" && c[2] === "me"));
  const up = fakeSupabase({ data: row(), error: null });
  await updateCustomJob(up, "me", ROW_ID, customJob());
  assert.ok(up.calls.some((c) => c[0] === "eq" && c[1] === "user_id" && c[2] === "me"));
});

// 8. 삭제
test("8. 삭제: 내 row id만, 잘못된 id는 거부", async () => {
  const db = fakeSupabase({ error: null });
  const r = await deleteCustomJob(db, "me", ROW_ID.toUpperCase());
  assert.deepEqual(r, { ok: true, id: ROW_ID });
  assert.ok(db.calls.some((c) => c[0] === "eq" && c[1] === "id" && c[2] === ROW_ID));
  assert.equal((await deleteCustomJob(fakeSupabase(), "me", "1 or 1=1")).status, 400);
});

// 9. 수정
test("9. 수정: 다시 정리한 값으로, 남의 row(0건)는 404", async () => {
  const edited = customJob(ROW_ID, { title: "CRM 마케팅 인턴 (수정)", tasks: ["<i>바뀐 업무</i>"] });
  const db = fakeSupabase({ data: row(ROW_ID, toCustomSnapshot(edited)), error: null });
  const r = await updateCustomJob(db, "me", ROW_ID, edited);
  assert.equal(r.ok, true);
  const update = db.calls.find((c) => c[0] === "update")[1];
  assert.equal(update.title, "CRM 마케팅 인턴 (수정)");
  assert.deepEqual(update.structured_snapshot.tasks, ["바뀐 업무"]);
  assert.equal("user_id" in update, false); // 소유자는 바꾸지 않음
  assert.equal((await updateCustomJob(fakeSupabase({ data: null, error: null }), "me", ROW_ID, edited)).status, 404);
  assert.equal((await updateCustomJob(fakeSupabase(), "me", "bad", edited)).status, 400);
});

// 10. custom + sample 비교
test("10. 직접 추가 공고 + 샘플 공고: 같은 비교 구조(A/B/C)로 비교", () => {
  let state = addToCompareState({ compareIds: ["sample-1"], compareSnapshots: [] }, customJob());
  assert.equal(state.status, "added");
  assert.deepEqual(state.page.compareIds, ["sample-1", customJobId(ROW_ID)]);
  // 메인 복원: 샘플은 공고 목록에서, 직접 추가 공고는 snapshot으로
  const pool = [sampleJob(1)];
  const restored = state.page.compareIds.map(
    (id) => pool.find((j) => j.id === id) ?? state.page.compareSnapshots.find((p) => p.id === id)
  );
  assert.deepEqual(restored.map((j) => j.id), ["sample-1", customJobId(ROW_ID)]);
  assert.ok(toComparisonSnapshot(restored));
  assert.ok(getComparePoints(restored).length > 0);
  assert.equal(getPostingHighlights(restored).length, 2);
});

// 11. custom 2~3개 비교
test("11. 직접 추가 공고끼리 2·3개 비교", () => {
  let page = {};
  for (const id of [ROW_ID, ROW_ID_2, "1b2504e0-4f89-11d3-9a0c-0305e82c3303"]) {
    page = addToCompareState(page, customJob(id, { title: `직무 ${id.slice(0, 2)}` })).page;
  }
  assert.equal(page.compareIds.length, 3);
  const jobs = restoreCompareJobs(page.compareSnapshots);
  assert.equal(jobs.length, 3);
  assert.ok(jobs.every((j) => j.source === "custom"));
  assert.equal(restoreCompareJobs(page.compareSnapshots.slice(0, 2)).length, 2);
});

// 12. 최대 3개
test("12. 최대 3개 제한 유지, 이미 담긴 공고는 다시 담지 않음", () => {
  const full = { compareIds: ["sample-1", "sample-2", "sample-3"], compareSnapshots: [] };
  assert.equal(addToCompareState(full, customJob()).status, "full");
  assert.deepEqual(addToCompareState(full, customJob()).page, full);
  const once = addToCompareState({}, customJob()).page;
  assert.equal(addToCompareState(once, customJob()).status, "already");
  assert.equal(addToCompareState({}, { title: "id 없음" }).status, "invalid");
  // 공고 조합이 바뀌면 이전 AI 비교 결과·저장한 비교 상태는 해제
  const changed = addToCompareState({ compareIds: ["a"], compareSummary: { ids: "a" }, compareFromSaved: true }, customJob());
  assert.equal(changed.page.compareSummary, null);
  assert.equal(changed.page.compareFromSaved, false);
});

// 13. 새로고침 후 목록 유지
test("13. 목록: DB row를 다시 읽으면 같은 공고(같은 id)로, 깨진 row는 제외", async () => {
  const rows = [row(ROW_ID), row(ROW_ID_2), { id: "bad", company: "x", title: "y", structured_snapshot: {} }];
  const first = await listCustomJobs(fakeSupabase({ data: rows, error: null }), "me");
  const again = await listCustomJobs(fakeSupabase({ data: rows, error: null }), "me");
  assert.equal(first.items.length, 2);
  assert.deepEqual(first.items, again.items);
  assert.deepEqual(first.items.map((i) => i.job.id), [customJobId(ROW_ID), customJobId(ROW_ID_2)]);
  assert.equal(first.items[0].job.source, "custom");
  assert.match(first.items[0].savedDate, /2026\. 11\. 17\./);
  const failed = await listCustomJobs(fakeSupabase({ data: null, error: { code: "42P01" } }), "me");
  assert.equal(failed.ok, false);
});

// 14. 저장된 공고를 분석 화면에서 다시 열기
test("14. 분석 다시 열기: 원문이 없으면 저장된 공고 정보로 입력을 만들고 '저장된 공고 정보'로 표시", () => {
  const item = toCustomJobItem(row());
  const full = toComparisonPosting(item.job); // 분석 intent에 담기는 값
  const text = toPostingText(full);
  assert.match(text, /^공고명: CRM 마케팅 인턴\n회사명: 오렌지커머스/);
  assert.match(text, /주요 업무\n- 고객 데이터를 분석해 타깃 캠페인을 기획합니다\./);
  assert.match(text, /우대사항\n- SQL 또는 GA4 사용 경험/);
  assert.equal(isStructuredOnly(full), true); // → "원문 추출"이 아니라 "저장된 공고 정보"
  // 이번 세션에서 붙여넣은 원문이 있으면 원문으로 (원문 추출)
  const withOriginal = { ...full, description: POSTING };
  assert.equal(isStructuredOnly(withOriginal), false);
  assert.ok(toPostingText(withOriginal).includes("근무지: 서울 강남구"));
  assert.equal(isStructuredOnly(sampleJob(1)), false);
});

// 15. AI 실패 시 입력 유지
test("15. AI 정리 실패해도 입력 유지: 임시 보관 왕복, 실패 처리에서 입력을 지우지 않음", () => {
  const draft = readDraft({ company: "오렌지커머스", title: "CRM 마케팅 인턴", posting: POSTING, structured: null });
  assert.deepEqual(draft, { company: "오렌지커머스", title: "CRM 마케팅 인턴", posting: POSTING, structured: null });
  const withPreview = readDraft({ company: "A", title: "B", posting: POSTING, structured: { tasks: ["업무"], keywords: ["CRM"] } });
  assert.deepEqual(withPreview.structured.tasks, ["업무"]);
  assert.equal(readDraft(null), null);
  assert.equal(readDraft({ company: "", title: "", posting: "" }), null);

  const src = readFileSync(new URL("../app/custom-job/CustomJobForm.js", import.meta.url), "utf8");
  const start = src.indexOf("const handleStructure");
  const end = src.indexOf("const handleSave");
  const handler = src.slice(start, end);
  assert.doesNotMatch(handler, /setCompany\(|setTitle\(|setPosting\(/);
  assert.match(src, /공고 내용을 정리하지 못했어요\. 입력한 내용은 그대로 유지돼요\. 다시 시도해 주세요\./);
  assert.doesNotMatch(src, /402|429|OpenRouter/);
});

// 16. 추측 금지
test("16. 프롬프트 규칙 + 서버 확인: 공고 본문에서 확인되지 않는 값(추측)은 버림", () => {
  const route = readFileSync(new URL("../app/api/custom-jobs/structure/route.js", import.meta.url), "utf8");
  assert.match(route, /공고에 없는 내용을 보완하거나 일반적인 직무 지식으로 채우지 마라\. 입력된 공고에서 직접 확인 가능한 정보만 구조화하라\./);
  assert.match(route, /requestStructured/); // 기존 OpenRouter 안정화 로직 재사용
  assert.doesNotMatch(route, /fetch\(/); // 별도 호출 구현 없음

  const s = normalizeStructured(
    {
      tasks: ["고객 데이터를 분석해 타깃 캠페인을 기획합니다.", "브랜드 전략 수립 및 예산 관리"],
      required: ["경력 3년 이상"],
      preferred: ["SQL 또는 GA4 사용 경험", "Python 사용 경험"],
      keywords: ["CRM", "SQL", "Tableau"],
      employmentType: "정규직",
      career: "경력무관",
      location: "서울 강남구",
      deadline: "2026-12-31",
    },
    POSTING
  );
  assert.deepEqual(s.tasks, ["고객 데이터를 분석해 타깃 캠페인을 기획합니다."]);
  assert.deepEqual(s.required, []);
  assert.deepEqual(s.preferred, ["SQL 또는 GA4 사용 경험"]);
  assert.deepEqual(s.keywords, ["CRM", "SQL"]);
  assert.equal(s.employmentType, ""); // 본문은 "인턴" → 정규직은 추측
  assert.equal(s.career, "");
  assert.equal(s.location, "서울 강남구");
  assert.equal(s.deadline, "2026-12-31");
  assert.equal(appearsInPosting("2026.12.31", "마감: 2026-12-31"), true);
  assert.equal(appearsInPosting("정규직", "인턴 채용"), false);
});

// ───── 빈 칸 안내 / 조건 분리 ─────

test("빈 기본 조건(근무형태·경력·지역·마감): 화면은 안내 placeholder, 저장값은 빈 값", () => {
  const edit = toPreviewEdit(normalizeStructured({ tasks: ["고객 데이터를 분석해 타깃 캠페인을 기획합니다."] }, POSTING));
  for (const k of ["employmentType", "career", "location", "deadline"]) assert.equal(edit[k], "");
  const saved = fromPreviewEdit(edit);
  assert.equal(saved.employmentType, "");
  assert.deepEqual(saved.employmentTypes, []);
  assert.equal(saved.career, "");
  assert.equal(saved.location, "");
  assert.equal(saved.deadline, "");
  assert.equal(JSON.stringify(saved).includes("확인되지 않았어요"), false);
  const snap = toCustomSnapshot({ company: "A", title: "B", ...saved });
  assert.equal(JSON.stringify(snap).includes("확인되지 않았어요"), false);
});

test("빈 목록(업무·필수·우대·키워드)도 같은 원칙: 빈 칸 + placeholder, 저장값은 빈 배열", () => {
  const edit = toPreviewEdit(normalizeStructured({}, POSTING));
  for (const k of ["tasks", "required", "preferred", "keywords"]) assert.equal(edit[k], "");
  const saved = fromPreviewEdit(edit);
  for (const k of ["tasks", "required", "preferred", "keywords"]) assert.deepEqual(saved[k], []);

  // 빈 칸 모두 같은 안내 문구를 placeholder로만 사용 (value로 넣지 않음)
  const src = readFileSync(new URL("../app/custom-job/CustomJobForm.js", import.meta.url), "utf8");
  for (const id of [
    "employment",
    "career",
    "location",
    "apply-start",
    "apply-end",
    "work-period",
    "tasks",
    "required",
    "preferred",
    "keywords",
  ]) {
    assert.match(src, new RegExp(`id="custom-${id}"[^>]*placeholder=\\{PREVIEW_EMPTY_HINT\\}`), id);
  }
  assert.doesNotMatch(src, /value=\{PREVIEW_EMPTY_HINT\}/);
  assert.equal(PREVIEW_EMPTY_HINT, "공고에서 확인되지 않았어요. 필요하면 직접 입력할 수 있어요.");
});

test("조건 분리 프롬프트 규칙: 독립 조건은 원문 표현 그대로 별도 항목으로", () => {
  const route = readFileSync(new URL("../app/api/custom-jobs/structure/route.js", import.meta.url), "utf8");
  assert.match(
    route,
    /필수 조건과 우대 조건에 서로 독립적인 조건이 여러 개 포함되어 있으면 의미를 바꾸지 않는 범위에서 각 조건을 별도 항목으로 분리하라\./
  );
  assert.match(route, /수치·단위를 바꾸거나/);
  assert.match(route, /애매하면 나누지 말고 원문 한 줄 그대로/);
});

const MARTIAL = `자격요건
- 키 190이상 몸무게 120키로이상
- 전부 태권도 9단 무에타이 9단 쿵푸 9단 달고오세요`;

test("분리된 조건도 본문 확인 그대로 (원문 표현 유지분만 통과, 단위를 바꾸거나 없는 조건은 버림)", () => {
  const s = normalizeStructured(
    {
      required: [
        "키 190이상",
        "몸무게 120키로이상",
        "태권도 9단",
        "무에타이 9단",
        "쿵푸 9단",
        "합기도 9단", // 본문에 없음
        "키 190cm 이상 몸무게 120kg 이상 체지방 10% 이하", // 단위 변경 + 없는 조건
      ],
    },
    MARTIAL
  );
  assert.deepEqual(s.required, ["키 190이상", "몸무게 120키로이상", "태권도 9단", "무에타이 9단", "쿵푸 9단"]);
});

test("서버 보정: 줄바꿈·세미콜론·글머리표로 명확히 나뉜 항목만 나눔 (그 밖은 원문 한 줄 유지)", () => {
  const s = normalizeStructured(
    {
      required: [
        "키 190이상\n몸무게 120키로이상",
        "태권도 9단; 무에타이 9단 • 쿵푸 9단",
        "SQL 또는 GA4 사용 경험", // 하나의 조건: 그대로
      ],
    },
    `${MARTIAL}\n- SQL 또는 GA4 사용 경험`
  );
  assert.deepEqual(s.required, [
    "키 190이상",
    "몸무게 120키로이상",
    "태권도 9단",
    "무에타이 9단",
    "쿵푸 9단",
    "SQL 또는 GA4 사용 경험",
  ]);
  // 구분자가 없는 한 줄은 서버가 임의로 쪼개지 않음
  assert.deepEqual(normalizeStructured({ required: ["키 190이상 몸무게 120키로이상"] }, MARTIAL).required, [
    "키 190이상 몸무게 120키로이상",
  ]);
});

// ───── 모집 일정·근무기간 (직접 추가) ─────

const SCHEDULE_NOW = Date.parse("2026-11-18T03:00:00Z"); // 한국 2026-11-18
const SCHEDULE_POSTING = `데이터 분석 인턴 모집
접수기간: 11월 18일 ~ 12월 2일
근무기간: 2027년 1월부터 6개월간 근무

주요 업무
- 서비스 지표를 정리합니다.`;

test("일정 추출: 본문에 있는 모집기간·근무기간은 유지 (연도 없는 날짜는 서버가 연도 결정)", () => {
  const s = normalizeStructured(
    {
      tasks: ["서비스 지표를 정리합니다."],
      applicationStartDate: "2026-11-18",
      applicationEndDate: "2026-12-02",
      closeType: "deadline",
      workPeriod: "2027년 1월부터 6개월간 근무",
    },
    SCHEDULE_POSTING,
    { now: SCHEDULE_NOW }
  );
  assert.equal(s.applicationStartDate, "2026-11-18");
  assert.equal(s.applicationEndDate, "2026-12-02");
  assert.equal(s.closeType, "deadline");
  assert.equal(s.workPeriod, "2027년 1월부터 6개월간 근무");
  // AI가 연도를 잘못 써도 본문에 연도가 없으면 서버 규칙으로 (올해, 60일 넘게 지났으면 내년)
  const fixed = normalizeStructured({ applicationEndDate: "2031-12-02" }, SCHEDULE_POSTING, { now: SCHEDULE_NOW });
  assert.equal(fixed.applicationEndDate, "2026-12-02");
});

test("일정 추출: 본문에 없는 날짜·마감 방식은 제거", () => {
  const s = normalizeStructured(
    { applicationStartDate: "2026-11-20", applicationEndDate: "2026-12-31", closeType: "always" },
    SCHEDULE_POSTING,
    { now: SCHEDULE_NOW }
  );
  assert.equal(s.applicationStartDate, "");
  assert.equal(s.applicationEndDate, "");
  assert.equal(s.closeType, ""); // "상시 채용"이 본문에 없음
  assert.equal(normalizeStructured({ closeType: "deadline" }, SCHEDULE_POSTING, { now: SCHEDULE_NOW }).closeType, ""); // 마감일 없이 deadline 불가
  assert.equal(normalizeStructured({ applicationEndDate: "내일" }, SCHEDULE_POSTING, { now: SCHEDULE_NOW }).applicationEndDate, "");
});

test("근무기간: '인턴'이라는 단어만으로 만들지 않음, 미정·예상 같은 값도 버림", () => {
  const onlyIntern = "CRM 마케팅 인턴 채용\n주요 업무\n- 캠페인 운영";
  for (const workPeriod of ["인턴", "인턴 기간", "미정", "예상 3개월", "6개월"]) {
    assert.equal(normalizeStructured({ workPeriod }, onlyIntern, { now: SCHEDULE_NOW }).workPeriod, "", workPeriod);
  }
});

test("접수 날짜와 근무기간을 섞지 않음", () => {
  // AI가 접수 기간을 근무기간 칸에 넣은 경우 → 버림
  const s = normalizeStructured(
    {
      applicationStartDate: "2026-11-18",
      applicationEndDate: "2026-12-02",
      workPeriod: "11월 18일 ~ 12월 2일",
    },
    SCHEDULE_POSTING,
    { now: SCHEDULE_NOW }
  );
  assert.equal(s.workPeriod, "");
  assert.equal(s.applicationStartDate, "2026-11-18");
  // AI가 근무 시작(2027년 1월)을 접수 시작일로 넣은 경우 → 본문에 그런 접수 날짜가 없어 버림
  const t = normalizeStructured({ applicationStartDate: "2027-01-01" }, SCHEDULE_POSTING, { now: SCHEDULE_NOW });
  assert.equal(t.applicationStartDate, "");
});

test("일정 저장·복원: snapshot과 목록에서 그대로 유지, 편집 칸 왕복도 유지", async () => {
  const job = customJob(ROW_ID, {
    applicationStartDate: "2026-11-18",
    applicationEndDate: "2026-12-02",
    closeType: "deadline",
    workPeriod: "2027년 1월부터 6개월간 근무",
  });
  const snap = toCustomSnapshot(job);
  assert.equal(snap.applicationEndDate, "2026-12-02");
  const listed = await listCustomJobs(fakeSupabase({ data: [row(ROW_ID, snap)], error: null }), "me");
  const restored = listed.items[0].job;
  assert.equal(restored.applicationStartDate, "2026-11-18");
  assert.equal(restored.closeType, "deadline");
  assert.equal(restored.workPeriod, "2027년 1월부터 6개월간 근무");
  // 비교에 담아도 일정 유지
  const page = addToCompareState({}, restored).page;
  assert.equal(page.compareSnapshots[0].applicationEndDate, "2026-12-02");
  // 미리보기 편집 왕복 ("2026.12.02"처럼 적어도 저장은 YYYY-MM-DD)
  const edit = toPreviewEdit({ ...restored, applicationEndDate: "2026-12-02" });
  const back = fromPreviewEdit({ ...edit, applicationStartDate: "2026.11.18" });
  assert.equal(back.applicationStartDate, "2026-11-18");
  assert.equal(back.workPeriod, "2027년 1월부터 6개월간 근무");
  // 임시 보관(로그인 전)도 일정 유지
  const draft = readDraft({ company: "A", title: "B", posting: SCHEDULE_POSTING, structured: back });
  assert.equal(draft.structured.applicationEndDate, "2026-12-02");
});

test("일정 필드도 기존 정리 규칙 유지: 잘못된 날짜·마감 방식 제거, 태그 제거, 길이 제한", () => {
  const snap = toCustomSnapshot({
    company: "A",
    title: "B",
    applicationStartDate: "2026-02-30",
    applicationEndDate: "<b>2026-12-02</b>",
    closeType: "<script>x</script>",
    workPeriod: "<i>6개월</i> " + "가".repeat(300),
  });
  assert.equal("applicationStartDate" in snap, false);
  assert.equal("closeType" in snap, false);
  assert.ok(snap.workPeriod.length <= 100);
  assert.equal(snap.workPeriod.includes("<"), false);
  assert.equal(JSON.stringify(snap).includes("<"), false);
});

test("구조화 프롬프트: 일정은 본문에서만, 접수 날짜와 근무기간 구분", () => {
  const route = readFileSync(new URL("../app/api/custom-jobs/structure/route.js", import.meta.url), "utf8");
  assert.match(route, /모집 일정과 근무기간은 서로 다른 정보입니다/);
  assert.match(route, /접수 기간·게시일·지원 시작일을 근무기간으로 쓰지 않습니다/);
  assert.match(route, /"인턴"이라고만 적혀 있고 기간이 없으면 ""/);
  for (const key of ["applicationStartDate", "applicationEndDate", "closeType", "workPeriod"]) {
    assert.match(route, new RegExp(`"${key}"`));
  }
});
