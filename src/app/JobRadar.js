import styles from "./JobRadar.module.css";

const TOP_KEYWORDS = 5;
const COMPANY_TYPE_ORDER = ["대기업", "중견기업", "중소기업", "스타트업"];

// 공백·대소문자 차이 무시 ("데이터분석" = "데이터 분석", "crm" = "CRM")
const keyOf = (k) => String(k).replace(/\s+/g, "").toLowerCase();

/** 현재 화면에 보이는 공고만으로 요약을 계산한다. (AI·API 호출 없음, 단순 집계) */
export function summarizeJobs(jobs) {
  const count = (pred) => jobs.filter(pred).length;

  // 키워드 빈도: 처음 등장한 표기를 대표 이름으로, 많이 나온 순 → 먼저 나온 순
  const keywordMap = new Map();
  jobs.forEach((job) => {
    const seenInJob = new Set(); // 한 공고 안의 중복 키워드는 1번만
    (job.keywords ?? []).forEach((raw) => {
      const label = String(raw).trim();
      const key = keyOf(label);
      if (!key || seenInJob.has(key)) return;
      seenInJob.add(key);
      const entry = keywordMap.get(key) ?? { label, count: 0, order: keywordMap.size };
      entry.count += 1;
      keywordMap.set(key, entry);
    });
  });
  const topKeywords = [...keywordMap.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, TOP_KEYWORDS);
  // 5개를 넘는 나머지 키워드 수 → "외 N개"로만 표시 (빠르게 훑기용)
  const moreKeywords = Math.max(0, keywordMap.size - TOP_KEYWORDS);

  // 기업유형: companyType이 있는 공고만 집계 (없으면 빈 배열 → 화면에서 줄 숨김)
  const typeMap = new Map();
  jobs.forEach((job) => {
    const type = typeof job.companyType === "string" ? job.companyType.trim() : "";
    if (type) typeMap.set(type, (typeMap.get(type) ?? 0) + 1);
  });
  const rank = (t) => {
    const i = COMPANY_TYPE_ORDER.indexOf(t);
    return i === -1 ? COMPANY_TYPE_ORDER.length : i;
  };
  const companyTypes = [...typeMap.entries()]
    .map(([type, n]) => ({ type, count: n }))
    .sort((a, b) => rank(a.type) - rank(b.type));

  return {
    stats: [
      { label: "검색 결과", value: jobs.length, total: true },
      { label: "인턴", value: count((j) => j.employmentType === "인턴") },
      { label: "정규직", value: count((j) => j.employmentType === "정규직") },
      { label: "계약직", value: count((j) => j.employmentType === "계약직") },
      { label: "신입", value: count((j) => j.career === "신입") },
    ],
    topKeywords,
    moreKeywords,
    companyTypes,
  };
}

// 결과가 이 개수 미만이면 키워드 횟수가 대부분 1이라 의미가 약하므로 횟수를 숨긴다
const SHOW_COUNT_MIN = 4;

// filters: 근무형태 필터 버튼 (JobSearch가 넘겨줌) — 현황 숫자 바로 아래에 함께 배치
export default function JobRadar({ jobs, keyword, filter, filters = null }) {
  const { stats, topKeywords, moreKeywords, companyTypes } = summarizeJobs(jobs);
  const [total, ...subStats] = stats;
  const filtered = filter && filter !== "전체";
  const showCounts = jobs.length >= SHOW_COUNT_MIN;

  return (
    <section className={styles.radar} aria-labelledby="radar-title">
      {/* 검색어 · 건수를 한 줄로: "마케팅 채용공고 · 2건" (필터 중이면 "· 인턴 1건") */}
      <h3 id="radar-title" className={styles.title}>
        {keyword ? `${keyword} 채용공고` : "전체 채용공고"}
        <span className={styles.titleSep} aria-hidden="true">
          ·
        </span>
        <span className={styles.total}>
          {filtered && <span className={styles.totalFilter}>{filter} </span>}
          <strong className={styles.totalNum}>{total.value}</strong>건
        </span>
      </h3>

      <dl className={styles.stats}>
        {subStats.map((s) => (
          <div key={s.label} className={styles.stat}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>

      {filters && <div className={styles.filterSlot}>{filters}</div>}

      {(topKeywords.length > 0 || companyTypes.length > 0) && (
        <dl className={styles.meta}>
          {topKeywords.length > 0 && (
            <div className={styles.metaRow}>
              <dt>{showCounts ? "많이 등장한 키워드" : "주요 키워드"}</dt>
              <dd className={styles.metaKeywords}>
                {topKeywords.map((k) => (
                  <span key={k.label}>
                    {k.label}
                    {showCounts && <span className={styles.keywordCount}> {k.count}</span>}
                  </span>
                ))}
                {moreKeywords > 0 && <span className={styles.keywordMore}>외 {moreKeywords}개</span>}
              </dd>
            </div>
          )}
          {/* companyType 데이터가 있을 때만 작은 보조 정보로 표시 (현재는 샘플 값) */}
          {companyTypes.length > 0 && (
            <div className={`${styles.metaRow} ${styles.metaSub}`}>
              <dt>기업유형</dt>
              <dd>{companyTypes.map((t) => `${t.type} ${t.count}`).join(" · ")}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
