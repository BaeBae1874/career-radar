"use client";

import { useEffect, useState } from "react";
import styles from "./JobSearch.module.css";
import JobRadar from "./JobRadar";
import { patchSession } from "./sessionStore";

const MAX_CARD_KEYWORDS = 3;
export const EMPLOYMENT_FILTERS = ["전체", "인턴", "정규직", "계약직"];

function JobCard({ job, selected, compared, showSource, onToggleCompare, onAnalyze }) {
  const meta = [job.employmentType, job.career, job.location].filter(Boolean);
  const firstTask = job.tasks?.find((t) => typeof t === "string" && t.trim());
  return (
    <li className={`${styles.card} ${selected ? styles.cardSelected : ""}`}>
      <div className={styles.cardHead}>
        <div className={styles.cardHeadText}>
          <p className={styles.company}>
            {job.company}
            {/* companyType은 데이터에 있을 때만 표시 (현재는 샘플 값) */}
            {job.companyType && <span className={styles.companyType}>{job.companyType}</span>}
          </p>
          <h3 className={styles.title}>{job.title}</h3>
        </div>
        <label className={`${styles.compareCheck} ${compared ? styles.compareCheckOn : ""}`}>
          <input
            type="checkbox"
            checked={compared}
            onChange={() => onToggleCompare(job)}
            aria-label={`${job.company} ${job.title} 비교 선택`}
          />
          비교 선택
        </label>
      </div>

      <p className={styles.meta}>
        {meta.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
        {job.deadline && <span className={styles.deadline}>{job.deadline}</span>}
      </p>

      {job.keywords?.length > 0 && (
        <ul className={styles.keywords} aria-label="핵심 키워드">
          {/* 빠르게 훑을 수 있게 최대 3개만 (나머지는 숨김) */}
          {job.keywords.slice(0, MAX_CARD_KEYWORDS).map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}

      {/* 공고 tasks의 첫 번째 업무를 그대로 미리보기 (없으면 숨김) */}
      {firstTask && (
        <div className={styles.task}>
          <p className={styles.taskLabel}>실제로 하게 될 일</p>
          <p className={styles.taskText}>{firstTask.trim()}</p>
        </div>
      )}

      {showSource && job.source && <p className={styles.source}>출처 {job.source}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.analyzeButton} onClick={() => onAnalyze(job)}>
          Career Radar 분석
        </button>
        {job.originalUrl && (
          <a
            className={styles.linkButton}
            href={job.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            원문 공고 보기 <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * initial: 새로고침 후 page가 sessionStorage + /api/jobs로 복원한 검색 상태 (없으면 빈 상태)
 * persist: 복원이 끝난 뒤에만 true → 복원 전 초기값이 저장된 상태를 덮어쓰지 않게
 */
export default function JobSearch({
  selectedJobId,
  compareIds = [],
  onToggleCompare,
  onAnalyze,
  initial = null,
  persist = false,
  onResultCount,
}) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [jobs, setJobs] = useState(initial?.jobs ?? null); // null = 아직 검색 전
  const [isSample, setIsSample] = useState(initial?.isSample ?? false);
  const [searchedKeyword, setSearchedKeyword] = useState(initial?.searchedKeyword ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(initial?.filter ?? "전체");

  // 현재 검색 결과 수를 page에 알림 (null = 아직 검색 전) — 하단 비교 바 문구용
  useEffect(() => {
    onResultCount?.(jobs ? jobs.length : null);
  }, [jobs, onResultCount]);

  // 검색 결과 자체는 저장하지 않고, 다시 가져올 수 있는 검색어·필터만 저장
  useEffect(() => {
    if (!persist) return;
    patchSession({ search: { query, searchedKeyword, filter, hasSearched: jobs !== null } });
  }, [persist, query, searchedKeyword, filter, jobs]);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (loading) return;
    const keyword = query.trim();

    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs?keyword=${encodeURIComponent(keyword)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.jobs)) {
        setError(data?.error || "채용공고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setJobs(data.jobs);
      setIsSample(Boolean(data.isSample));
      setSearchedKeyword(keyword);
      setFilter("전체");
    } catch {
      setError("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  const countOf = (f) =>
    f === "전체" ? jobs.length : jobs.filter((j) => j.employmentType === f).length;
  const visibleJobs =
    jobs && (filter === "전체" ? jobs : jobs.filter((j) => j.employmentType === filter));
  // 출처 목록: 지금은 표시만, 실제 출처가 여러 개 붙으면 이 값으로 필터 버튼을 만들면 된다
  const sources = jobs ? [...new Set(jobs.map((j) => j.source).filter(Boolean))] : [];

  return (
    <section id="find-jobs" className={styles.search} aria-labelledby="search-title">
      <div className={styles.searchBox}>
        {/* Hero 바로 아래 검색창이 오도록 제목은 화면에서 숨기고 보조기기용으로만 유지 */}
        <h2 id="search-title" className={styles.srOnly}>
          어떤 일을 찾고 있나요?
        </h2>

        <form className={styles.searchForm} role="search" onSubmit={handleSearch}>
          <label htmlFor="job-search" className={styles.srOnly}>
            직무나 키워드
          </label>
          <input
            id="job-search"
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 마케팅, CRM, 데이터 분석, 서비스 기획"
            autoComplete="off"
          />
          <button
            type="button"
            className={styles.searchButton}
            disabled={loading}
            onClick={handleSearch}
          >
            {loading ? "찾는 중..." : "채용공고 찾기"}
          </button>
        </form>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      {jobs && (
        <div className={styles.results} aria-live="polite">
          <p className={styles.sourceRow}>
            <span className={styles.sourceLabel}>출처</span>
            {/* 샘플 상태에서는 사람인을 실제 출처처럼 보이지 않게 '샘플 데이터'로 표시 */}
            {isSample ? (
              <>
                <span className={styles.sourceChip}>샘플 데이터</span>
                <span className={styles.sampleNote}>실제 채용공고 연동은 준비 중이에요.</span>
              </>
            ) : (
              sources.map((src) => (
                <span key={src} className={styles.sourceChip}>
                  {src}
                </span>
              ))
            )}
          </p>

          {/* 현재 필터로 보이는 공고 기준 요약 (필터를 바꾸면 다시 계산됨) */}
          {jobs.length > 0 && (
            <JobRadar
              jobs={visibleJobs}
              keyword={searchedKeyword}
              filter={filter}
              filters={
                <div className={styles.filters} role="group" aria-label="근무형태 필터">
                  {EMPLOYMENT_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      className={`${styles.filter} ${filter === f ? styles.filterActive : ""}`}
                      onClick={() => setFilter(f)}
                    >
                      {f} <span className={styles.filterCount}>{countOf(f)}</span>
                    </button>
                  ))}
                </div>
              }
            />
          )}


          {visibleJobs.length > 0 ? (
            <ul className={styles.list}>
              {visibleJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  selected={job.id === selectedJobId}
                  compared={compareIds.includes(job.id)}
                  showSource={!isSample}
                  onToggleCompare={onToggleCompare}
                  onAnalyze={onAnalyze}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {jobs.length === 0
                ? "검색 결과가 없어요. 다른 직무명이나 키워드로 찾아보세요."
                : `${filter} 공고가 없어요. 다른 근무형태를 선택해 보세요.`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
