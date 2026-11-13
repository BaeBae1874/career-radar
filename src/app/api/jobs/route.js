import { SAMPLE_JOBS } from "./sampleJobs";

const MAX_KEYWORD_LENGTH = 100;

// 공백·대소문자 차이를 무시하고 비교 ("데이터분석" ↔ "데이터 분석")
const normalize = (v) => String(v ?? "").replace(/\s+/g, "").toLowerCase();

/**
 * 채용공고 목록을 가져온다.
 *
 * 지금은 샘플 데이터를 회사명 / 공고명 / keywords 기준으로 필터링해 반환한다.
 *
 * TODO(사람인 API 승인 후): 이 함수 내부만 교체하면 된다. (승인 전에는 절대 사람인을 호출하지 않음)
 *   1. .env.local 에 SARAMIN_API_KEY 추가 (키가 있을 때만 사람인 호출, 없으면 지금처럼 SAMPLE_JOBS)
 *   2. 서버에서 사람인 Job Search API 호출 (access-key는 서버에서만, 클라이언트로 내보내지 않음)
 *   3. 응답을 src/lib/saraminMapper.js 의 mapSaraminJobs(response)로 변환해 반환
 *      → id·company·title·employmentType·career·location·deadline·keywords·originalUrl 등
 *        기존 UI field 이름 그대로 나온다.
 *      사람인 응답에는 상세 본문이 없어 description·tasks·required·preferred는 빈 값으로 온다. (추측해서 만들지 않음)
 *   4. 아래 GET 응답의 isSample을 false로 (화면의 "샘플 데이터" 표시가 사라짐)
 *   프론트엔드는 GET /api/jobs?keyword=... 의 { jobs } 응답만 사용한다.
 */
async function fetchJobs(keyword) {
  const q = normalize(keyword);
  if (!q) return SAMPLE_JOBS;
  return SAMPLE_JOBS.filter((job) =>
    [job.company, job.title, ...job.keywords].some((field) => normalize(field).includes(q))
  );
}

export async function GET(request) {
  const keyword = (request.nextUrl.searchParams.get("keyword") ?? "")
    .trim()
    .slice(0, MAX_KEYWORD_LENGTH);

  try {
    const jobs = await fetchJobs(keyword);
    // isSample: 실제 API로 교체하면 false로 바꾸거나 제거
    return Response.json({ jobs, total: jobs.length, isSample: true });
  } catch (err) {
    console.error("[jobs] failed to fetch jobs", err);
    return Response.json(
      { error: "채용공고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 }
    );
  }
}
