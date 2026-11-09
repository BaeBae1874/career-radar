"use client";

import { useState } from "react";
import styles from "./JobSearch.module.css";

const EMPLOYMENT_FILTERS = ["전체", "인턴", "정규직", "계약직"];

function JobCard({ job, selected, compared, onToggleCompare, onAnalyze }) {
  const meta = [job.employmentType, job.career, job.location].filter(Boolean);
  return (
    <li className={`${styles.card} ${selected ? styles.cardSelected : ""}`}>
      <div className={styles.cardMain}>
        <div className={styles.cardTop}>
          <p className={styles.company}>
            {job.company}
            {/* companyType은 데이터에 있을 때만 표시 (현재는 샘플 값) */}
            {job.companyType && <span className={styles.companyType}>{job.companyType}</span>}
          </p>
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
        <h3 className={styles.title}>{job.title}</h3>
        <p className={styles.meta}>
          {meta.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
          {job.deadline && <span className={styles.deadline}>{job.deadline}</span>}
        </p>
        {job.keywords?.length > 0 && (
          <ul className={styles.keywords} aria-label="핵심 키워드">
            {job.keywords.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        )}
        {job.source && <p className={styles.source}>출처 {job.source}</p>}
      </div>

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

export default function JobSearch({ selectedJobId, compareIds = [], onToggleCompare, onAnalyze }) {
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState(null); // null = 아직 검색 전
  const [isSample, setIsSample] = useState(false);
  const [searchedKeyword, setSearchedKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("전체");

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

  return (
    <section id="find-jobs" className={styles.search} aria-labelledby="search-title">
      <h2 id="search-title" className={styles.heading}>
        어떤 일을 찾고 있나요?
      </h2>
      <p className={styles.desc}>
        직무나 키워드로 실제 채용공고를 찾고, 공고 속 실제 업무까지 확인해보세요.
      </p>

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

      {jobs && (
        <div className={styles.results} aria-live="polite">
          <div className={styles.resultsHead}>
            <p className={styles.count}>
              {searchedKeyword ? (
                <>
                  <strong>‘{searchedKeyword}’</strong> 검색 결과{" "}
                </>
              ) : (
                "전체 공고 "
              )}
              <strong className={styles.countNum}>{jobs.length}</strong>건
            </p>
            {isSample && (
              <p className={styles.sampleNote}>
                현재는 화면 확인용 샘플 공고예요. 실제 공고 연동은 준비 중이에요.
              </p>
            )}
          </div>

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

          {visibleJobs.length > 0 ? (
            <ul className={styles.list}>
              {visibleJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  selected={job.id === selectedJobId}
                  compared={compareIds.includes(job.id)}
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
