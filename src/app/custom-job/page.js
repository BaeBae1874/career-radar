import pageStyles from "../page.module.css";
import SiteHeader from "../SiteHeader";
import { BackToSearchLink } from "../SiteNav";
import CustomJobForm from "./CustomJobForm";

export const metadata = {
  title: "공고 직접 추가 · Career Radar",
};

/**
 * /custom-job — 채용사이트에서 복사한 공고를 붙여넣어 Career Radar 공고로 정리
 * 붙여넣기·AI 정리·미리보기는 로그인 없이, "내 공고에 추가"만 로그인 필요
 * (URL 크롤링·사이트 scraping 없음: 사용자가 붙여넣은 내용만 처리)
 */
export default function CustomJobPage() {
  return (
    <div className={pageStyles.page}>
      <SiteHeader />
      <main className={pageStyles.container}>
        <div className={pageStyles.analysisView}>
          <BackToSearchLink className={pageStyles.backButton} />
          <header className={pageStyles.viewHead}>
            <h1 className={pageStyles.viewTitle}>공고 직접 추가</h1>
            <p className={pageStyles.viewDesc}>
              채용사이트에서 복사한 공고를 붙여넣으면 분석·비교에 쓸 수 있게 정리해 드려요.
            </p>
          </header>
          <CustomJobForm />
        </div>
      </main>
    </div>
  );
}
