import styles from "./JobRadar.module.css";
import { matchesEmploymentFilter } from "@/lib/postingMeta";

/** 현재 화면에 보이는 공고만으로 근무형태별 개수를 센다. (AI·API 호출 없음, 단순 집계) */
export function summarizeJobs(jobs) {
  const count = (pred) => jobs.filter(pred).length;
  return {
    total: jobs.length,
    // 필터 버튼과 같은 기준 (사람인 "인턴직 (정규직 전환가능)" → 인턴)
    stats: [
      { label: "인턴", value: count((j) => matchesEmploymentFilter(j, "인턴")) },
      { label: "정규직", value: count((j) => matchesEmploymentFilter(j, "정규직")) },
      { label: "계약직", value: count((j) => matchesEmploymentFilter(j, "계약직")) },
    ],
  };
}

/**
 * 검색 결과 요약 한 줄: "마케팅 채용공고 3건 · 인턴 1 · 정규직 2 · 계약직 0" + 오른쪽 근무형태 필터
 * (많이 등장한 키워드·기업유형 줄은 제거)
 * filters: 근무형태 필터 버튼 (JobSearch가 넘겨줌)
 */
export default function JobRadar({ jobs, keyword, filter, filters = null }) {
  const { total, stats } = summarizeJobs(jobs);
  const filtered = filter && filter !== "전체";

  return (
    <section className={styles.radar} aria-labelledby="radar-title">
      <div className={styles.summary}>
        <h3 id="radar-title" className={styles.title}>
          {keyword ? `${keyword} 채용공고` : "전체 채용공고"}
          <span className={styles.total}>
            {filtered && <span className={styles.totalFilter}>{filter} </span>}
            <strong className={styles.totalNum}>{total}</strong>건
          </span>
        </h3>
        <dl className={styles.stats}>
          {stats.map((s) => (
            <div key={s.label} className={styles.stat}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {filters && <div className={styles.filterSlot}>{filters}</div>}
    </section>
  );
}
