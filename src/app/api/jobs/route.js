import { SAMPLE_JOBS } from "./sampleJobs";

const MAX_KEYWORD_LENGTH = 100;

// 공백·대소문자 차이를 무시하고 비교 ("데이터분석" ↔ "데이터 분석")
const normalize = (v) => String(v ?? "").replace(/\s+/g, "").toLowerCase();

/**
 * 채용공고 목록을 가져온다.
 *
 * 지금은 샘플 데이터를 회사명 / 공고명 / keywords 기준으로 필터링해 반환한다.
 *
 * TODO(사람인 API 승인 후): 이 함수 내부만 교체하면 된다.
 *   1. .env.local 에 SARAMIN_API_KEY 추가
 *   2. 여기서 process.env.SARAMIN_API_KEY 로 사람인 채용공고 API를 서버에서 호출
 *   3. 응답을 sampleJobs.js 상단에 정리한 Job 구조로 변환해 반환
 *      (companyType 정보가 없으면 필드를 빼면 된다.
 *       비교용 tasks/required/preferred는 sections.js의 extractSections(description)로 만들 수 있다)
 *   프론트엔드는 GET /api/jobs?keyword=... 의 { jobs } 응답만 사용하므로 수정할 필요가 없다.
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
