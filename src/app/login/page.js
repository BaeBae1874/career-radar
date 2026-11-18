import { Suspense } from "react";
import pageStyles from "../page.module.css";
import styles from "../auth.module.css";
import SiteHeader from "../SiteHeader";
import AuthForm from "./AuthForm";

export const metadata = {
  title: "로그인 · Career Radar",
};

/**
 * /login — 이메일 + 비밀번호 로그인 / 회원가입
 * 폼은 ?next=, ?mode=signup, ?error= 를 읽기 때문에 Suspense 안에서 그린다. (Cache Components)
 */
export default function LoginPage() {
  return (
    <div className={pageStyles.page}>
      <SiteHeader showAccount={false} />
      <main className={styles.authMain}>
        <Suspense fallback={<div className={styles.authBox} aria-busy="true" />}>
          <AuthForm />
        </Suspense>
      </main>
    </div>
  );
}
