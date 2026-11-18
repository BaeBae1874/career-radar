import pageStyles from "./page.module.css";
import AuthMenu from "./AuthMenu";
import SiteNav from "./SiteNav";

/**
 * 로그인·저장함 화면용 헤더. 메인 화면 헤더와 같은 구조·클래스:
 * Career Radar / 공고 찾기 / 공고 비교 … 저장함 / 계정
 * showAccount: 오른쪽 계정 영역 표시 여부 (로그인 화면에서는 숨김)
 */
export default function SiteHeader({ showAccount = true }) {
  return (
    <header className={pageStyles.topbar}>
      <div className={pageStyles.topbarInner}>
        <div className={pageStyles.topbarLeft}>
          <SiteNav />
        </div>
        <div className={pageStyles.topbarRight}>
          {showAccount && (
            <div className={pageStyles.accountSlot}>
              <AuthMenu />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
