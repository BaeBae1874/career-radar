import { extractSections } from "./sections";

/**
 * 사람인 Open API 승인 전까지 사용하는 샘플 채용공고.
 *
 * - 회사명·공고 내용은 모두 UI 확인용으로 만든 가상 데이터입니다.
 * - 프론트엔드는 아래 필드 구조(Job)만 사용합니다. 실제 API로 교체할 때도
 *   route.js에서 응답을 이 구조로 변환해서 내려주면 프론트엔드는 그대로 동작합니다.
 *
 * Job {
 *   id: string
 *   company: string
 *   title: string
 *   employmentType: string   // 예: 인턴 / 정규직 / 계약직
 *   career: string           // 예: 신입 / 경력 / 경력무관
 *   companyType?: string     // ⚠️ 샘플 전용 (아래 주석 참고)
 *   location: string
 *   deadline: string         // 예: D-7, 상시채용
 *   source: string           // 예: 사람인
 *   originalUrl: string
 *   keywords: string[]
 *   description: string      // 분석 입력으로 들어가는 공고 본문 (그대로 유지)
 *   tasks: string[]          // 비교용: 주요 업무
 *   required: string[]       // 비교용: 자격요건
 *   preferred: string[]      // 비교용: 우대사항
 * }
 *
 * tasks / required / preferred는 description에서 extractSections()로 자동 생성한다.
 * (본문과 비교용 필드가 서로 어긋나지 않도록 한 곳에서만 관리)
 *
 * ⚠️ companyType(대기업/중견기업/중소기업/스타트업)은 UI 확인을 위한 샘플 값입니다.
 *    실제 사람인 API 응답에 해당 정보가 없으면 이 필드를 빼면 되고,
 *    프론트엔드는 companyType이 없으면 표시하지 않도록 되어 있습니다.
 */
const RAW_SAMPLE_JOBS = [
  // ───── 마케팅: CRM / 퍼포먼스 / 콘텐츠 ─────
  {
    id: "sample-1",
    company: "오렌지커머스",
    title: "선물하기 서비스 CRM 마케팅 어시스턴트",
    employmentType: "인턴",
    career: "신입",
    companyType: "대기업", // 샘플 전용
    location: "경기 성남시",
    deadline: "D-7",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["CRM", "메시지 마케팅", "성과 분석"],
    description: `주요 업무
- 선물하기 서비스 이용 고객 데이터를 바탕으로 타깃 CRM 캠페인을 기획하고 운영합니다.
- 앱푸시, 알림 메시지 등 채널별 메시지 콘텐츠를 작성합니다.
- 캠페인 성과(오픈율, 전환율)를 정리하고 개선점을 제안합니다.

자격요건
- 2027년 2월 졸업 예정자 또는 기졸업자
- 주 5일 근무 가능하신 분
- 스프레드시트를 활용한 기본적인 데이터 정리가 가능하신 분

우대사항
- SQL 사용 경험이 있으신 분
- 커머스 서비스 마케팅 관련 프로젝트 경험이 있으신 분`,
  },
  {
    id: "sample-2",
    company: "그린핀테크",
    title: "퍼포먼스 마케터 (신입)",
    employmentType: "정규직",
    career: "신입",
    companyType: "스타트업", // 샘플 전용
    location: "서울 강남구",
    deadline: "D-12",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["퍼포먼스 마케팅", "광고 운영", "GA"],
    description: `주요 업무
- 메타, 구글 등 디지털 광고 캠페인을 세팅하고 운영합니다.
- 광고 소재별 성과를 비교해 예산 배분을 조정합니다.
- 주간 마케팅 성과 리포트를 작성합니다.

자격요건
- 학사 이상
- 숫자와 지표를 꼼꼼하게 다루는 것을 좋아하시는 분

우대사항
- GA4 또는 광고 관리자 사용 경험
- 금융·핀테크 서비스에 관심이 많으신 분`,
  },
  {
    id: "sample-7",
    company: "블루웨이브미디어",
    title: "콘텐츠 마케터 (신입)",
    employmentType: "정규직",
    career: "신입",
    companyType: "중소기업", // 샘플 전용
    location: "서울 마포구",
    deadline: "D-10",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["콘텐츠 마케팅", "SNS 운영", "카피라이팅"],
    description: `주요 업무
- 브랜드 SNS 콘텐츠를 기획하고 제작합니다.
- 채널별 콘텐츠 성과를 확인하고 개선합니다.
- 캠페인용 카피와 이미지 소재 기획에 참여합니다.

자격요건
- 콘텐츠 기획과 글쓰기에 관심이 있으신 분
- 기본적인 문서 작성이 가능한 분
- 포트폴리오 제출 가능하신 분

우대사항
- SNS 채널 운영 경험
- 디자인 툴 또는 이미지 편집 경험
- 브랜드 콘텐츠 제작 경험`,
  },

  // ───── 프론트엔드: 서비스 기능 개발 / Next.js 인턴 / 웹 운영·유지보수 ─────
  {
    id: "sample-6",
    company: "숲소프트",
    title: "프론트엔드 개발자 (React)",
    employmentType: "정규직",
    career: "신입",
    companyType: "스타트업", // 샘플 전용
    location: "서울 구로구",
    deadline: "D-15",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["프론트엔드", "React", "JavaScript"],
    description: `주요 업무
- React 기반 웹 서비스의 신규 기능 화면을 개발합니다.
- 디자인 시안을 바탕으로 반응형 UI를 구현합니다.
- 기존 코드의 성능과 접근성을 개선합니다.

자격요건
- JavaScript, React에 대한 이해가 있으신 분
- Git을 활용한 협업 경험이 있으신 분

우대사항
- TypeScript 사용 경험
- 개인 또는 팀 프로젝트를 배포해 본 경험`,
  },
  {
    id: "sample-8",
    company: "별빛랩스",
    title: "프론트엔드 개발 인턴 (Next.js)",
    employmentType: "인턴",
    career: "신입",
    companyType: "스타트업", // 샘플 전용
    location: "서울 성동구",
    deadline: "D-4",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["프론트엔드", "Next.js", "TypeScript"],
    description: `주요 업무
- Next.js와 TypeScript로 사내 어드민 화면을 개발합니다.
- API 응답을 화면에 연결하고 컴포넌트를 정리합니다.
- 코드 리뷰를 받으며 기능을 개선합니다.

자격요건
- HTML, CSS, JavaScript 기본기를 갖추신 분
- 포트폴리오 또는 프로젝트 결과물(GitHub 링크) 제출 가능하신 분
- 3개월 근무 가능하신 분

우대사항
- Next.js 또는 React로 프로젝트를 만들어 본 경험
- TypeScript 사용 경험`,
  },
  {
    id: "sample-9",
    company: "모래시계웹",
    title: "웹 운영 프론트엔드 (유지보수)",
    employmentType: "계약직",
    career: "신입/경력 1년",
    companyType: "중소기업", // 샘플 전용
    location: "서울 영등포구",
    deadline: "상시채용",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["프론트엔드", "웹 운영", "HTML/CSS"],
    description: `주요 업무
- 운영 중인 기업 홈페이지와 이벤트 페이지를 수정하고 관리합니다.
- HTML, CSS, JavaScript로 페이지 화면을 제작합니다.
- 브라우저별 화면 오류를 확인하고 고칩니다.

자격요건
- HTML, CSS, JavaScript로 웹페이지를 만들어 본 경험이 있으신 분
- 계약기간 12개월 근무 가능하신 분 (평가 후 정규직 전환 검토)

우대사항
- jQuery 사용 경험
- 웹 접근성 관련 지식`,
  },

  // ───── 데이터: 서비스 지표 분석 / BI·리포팅 / 데이터 운영(엔지니어링) ─────
  {
    id: "sample-3",
    company: "블루데이터랩",
    title: "데이터 분석 인턴 (서비스 지표 분석)",
    employmentType: "인턴",
    career: "경력무관",
    companyType: "중견기업", // 샘플 전용
    location: "서울 마포구",
    deadline: "D-3",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["데이터 분석", "SQL", "A/B 테스트"],
    description: `주요 업무
- 서비스 핵심 지표를 정의하고 대시보드로 정리합니다.
- SQL로 필요한 데이터를 추출해 분석 보고서를 작성합니다.
- A/B 테스트 결과를 정리해 기획팀에 공유합니다.

자격요건
- SQL 기본 문법을 이해하고 계신 분
- 6개월 근무 가능하신 분

우대사항
- Python 데이터 분석 경험
- Tableau 등 시각화 도구 사용 경험`,
  },
  {
    id: "sample-10",
    company: "차트나무",
    title: "BI 데이터 리포팅 담당",
    employmentType: "정규직",
    career: "신입/경력 1년",
    companyType: "중견기업", // 샘플 전용
    location: "서울 중구",
    deadline: "D-14",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["BI", "데이터 리포팅", "Tableau"],
    description: `주요 업무
- 부서별 정기 리포트와 BI 대시보드를 만들고 관리합니다.
- 현업 부서의 데이터 요청을 받아 지표를 정리해 전달합니다.
- 지표 정의서를 작성하고 리포트 수치를 검증합니다.

자격요건
- 학사 이상
- 엑셀 함수와 피벗 테이블 활용이 가능하신 분
- 현업 부서와 소통하며 요구사항을 정리할 수 있는 분

우대사항
- Tableau 또는 Power BI 사용 경험
- SQL 사용 경험`,
  },
  {
    id: "sample-11",
    company: "구름물류",
    title: "데이터 엔지니어 주니어 (데이터 운영)",
    employmentType: "정규직",
    career: "신입",
    companyType: "대기업", // 샘플 전용
    location: "경기 성남시",
    deadline: "D-20",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["데이터 파이프라인", "SQL", "Python"],
    description: `주요 업무
- 물류 시스템 데이터를 수집·적재하는 배치 작업을 운영합니다.
- 데이터 테이블 구조를 관리하고 품질 이상을 점검합니다.
- 분석팀이 쓰는 데이터 마트를 정리하고 문서화합니다.

자격요건
- SQL로 데이터를 조회·가공할 수 있으신 분
- Python 기본 문법을 이해하고 계신 분
- 컴퓨터공학 또는 관련 전공 학사 이상

우대사항
- Airflow 등 워크플로 도구 사용 경험
- 클라우드(AWS, GCP) 사용 경험`,
  },

  // ───── 기획: 서비스 기획 / 사업기획 / 운영기획 ─────
  {
    id: "sample-5",
    company: "하늘모빌리티",
    title: "서비스 기획 주니어 (앱 서비스)",
    employmentType: "정규직",
    career: "신입",
    companyType: "중견기업", // 샘플 전용
    location: "경기 성남시",
    deadline: "D-20",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["서비스 기획", "화면 설계", "앱 서비스"],
    description: `주요 업무
- 앱 서비스 신규 기능의 요구사항을 정리하고 화면 설계서를 작성합니다.
- 디자이너, 개발자와 협업해 기능 출시 일정을 관리합니다.
- 출시 후 사용자 데이터를 확인해 개선 과제를 도출합니다.

자격요건
- 학사 이상
- 문서 작성 및 커뮤니케이션 역량을 갖추신 분

우대사항
- Figma 사용 경험
- 모빌리티 서비스 관련 프로젝트 경험`,
  },
  {
    id: "sample-12",
    company: "바람트래블",
    title: "사업기획 담당 (신규 제휴)",
    employmentType: "정규직",
    career: "신입/경력 1년",
    companyType: "중견기업", // 샘플 전용
    location: "서울 중구",
    deadline: "D-9",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["사업기획", "시장 조사", "제휴"],
    description: `주요 업무
- 여행 상품 신규 제휴처를 조사하고 제휴 조건을 비교합니다.
- 사업 계획서와 손익 추정 자료를 작성합니다.
- 월별 매출 실적을 정리해 경영진 보고 자료를 만듭니다.

자격요건
- 학사 이상
- 엑셀로 수치를 정리하고 보고서를 작성할 수 있으신 분

우대사항
- 여행·레저 산업에 대한 관심
- PPT 보고서 작성 경험`,
  },
  {
    id: "sample-13",
    company: "달빛리빙",
    title: "운영기획 매니저 (커머스 운영)",
    employmentType: "계약직",
    career: "경력무관",
    companyType: "중소기업", // 샘플 전용
    location: "서울 송파구",
    deadline: "상시채용",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["운영기획", "커머스 운영", "프로세스 개선"],
    description: `주요 업무
- 온라인몰 상품 등록과 주문·배송 운영 기준을 관리합니다.
- 고객 문의 유형을 정리해 운영 프로세스 개선안을 만듭니다.
- 프로모션 일정과 운영 체크리스트를 관리합니다.

자격요건
- 계약기간 12개월 근무 가능하신 분
- 꼼꼼하게 일정을 관리할 수 있으신 분

우대사항
- 온라인 쇼핑몰 운영 경험
- 스프레드시트 활용 능력`,
  },

  // ───── 디자인: UX/UI / 콘텐츠 디자인 / 브랜드 디자인 ─────
  {
    id: "sample-14",
    company: "솔방울스튜디오",
    title: "UX/UI 디자이너 인턴",
    employmentType: "인턴",
    career: "신입",
    companyType: "스타트업", // 샘플 전용
    location: "경기 성남시",
    deadline: "D-6",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["UX/UI 디자인", "Figma", "사용자 리서치"],
    description: `주요 업무
- 모바일 앱 화면의 UI를 디자인하고 컴포넌트를 정리합니다.
- 사용자 인터뷰 내용을 정리해 화면 개선안을 제안합니다.
- 개발자에게 전달할 디자인 가이드를 작성합니다.

자격요건
- 포트폴리오 제출 필수
- Figma 기본 사용이 가능하신 분
- 4개월 근무 가능하신 분

우대사항
- 프로토타이핑 툴 사용 경험
- 사용성 테스트 진행 경험`,
  },
  {
    id: "sample-15",
    company: "노을콘텐츠",
    title: "콘텐츠 디자이너 (상세페이지·배너)",
    employmentType: "정규직",
    career: "신입",
    companyType: "중소기업", // 샘플 전용
    location: "서울 성동구",
    deadline: "D-11",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["콘텐츠 디자인", "상세페이지", "Photoshop"],
    description: `주요 업무
- 신제품 상세페이지와 이벤트 배너를 디자인합니다.
- SNS 게시용 이미지와 카드뉴스를 제작합니다.
- 채널별 이미지 규격에 맞춰 디자인 파일을 관리합니다.

자격요건
- Photoshop, Illustrator 사용이 가능하신 분
- 포트폴리오 제출 가능하신 분

우대사항
- 영상 편집 툴 사용 경험
- 커머스 상세페이지 제작 경험`,
  },
  {
    id: "sample-16",
    company: "토끼정원",
    title: "브랜드 디자이너",
    employmentType: "정규직",
    career: "신입/경력 1년",
    companyType: "중소기업", // 샘플 전용
    location: "서울 용산구",
    deadline: "D-18",
    source: "사람인",
    originalUrl: "https://www.saramin.co.kr/",
    keywords: ["브랜드 디자인", "BI·로고", "패키지"],
    description: `주요 업무
- 브랜드 로고와 컬러 등 브랜드 가이드를 만들고 관리합니다.
- 제품 패키지와 오프라인 매장 인쇄물을 디자인합니다.
- 신규 브랜드 런칭에 필요한 디자인 시안을 제작합니다.

자격요건
- 시각디자인 또는 관련 전공 학사 이상
- 포트폴리오 제출 필수

우대사항
- 인쇄 공정에 대한 이해
- Illustrator 활용 능력`,
  },
];

export const SAMPLE_JOBS = RAW_SAMPLE_JOBS.map((job) => ({
  ...job,
  ...extractSections(job.description),
}));
