"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./JobSearch.module.css";
import JobRadar from "./JobRadar";
import { patchSession } from "./sessionStore";
import { getCheckPoints } from "@/lib/jobInsights";
import { getPageNumbers, paginate } from "@/lib/pagination";
import { getSourceLabel, hasSaraminSource, matchesEmploymentFilter } from "@/lib/postingMeta";
import {
  getRecentServerSnapshot,
  getRecentSnapshot,
  recordRecent,
  subscribeRecent,
} from "./recentStore";

const MAX_CARD_KEYWORDS = 3;
export const EMPLOYMENT_FILTERS = ["전체", "인턴", "정규직", "계약직"];

// 직무 바로가기: label은 화면 표시용, query는 기존 검색에 그대로 넣는 검색어
// (예: "기획"으로 찾아야 서비스·사업·운영기획이 함께 나옴)
const JOB_SHORTCUTS = [
  { label: "마케팅", query: "마케팅" },
  { label: "프론트엔드", query: "프론트엔드" },
  { label: "데이터 분석", query: "데이터" },
  { label: "서비스·사업 기획", query: "기획" },
  { label: "UX/UI·디자인", query: "디자인" },
];

const RECENT_VISIBLE = 3;
const MOBILE_PAGE_BUTTONS = 3;

/** 페이지 번호: PC 최대 5개, 모바일 최대 3개 (현재 페이지 중심). 1페이지뿐이면 렌더링하지 않음 */
function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const numbers = getPageNumbers(page, totalPages);
  const mobile = new Set(getPageNumbers(page, totalPages, MOBILE_PAGE_BUTTONS));
  return (
    <nav className={styles.pagination} aria-label="검색 결과 페이지">
      <button
        type="button"
        className={styles.pageArrow}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="이전 페이지"
      >
        <span className={styles.arrowWide} aria-hidden="true">←</span>
        <span className={styles.arrowNarrow} aria-hidden="true">‹</span>
      </button>
      <ul className={styles.pageList}>
        {numbers.map((n) => (
          <li key={n} className={mobile.has(n) ? "" : styles.pageHideMobile}>
            <button
              type="button"
              className={`${styles.pageNumber} ${n === page ? styles.pageCurrent : ""}`}
              aria-current={n === page ? "page" : undefined}
              aria-label={`${n}페이지`}
              onClick={() => n !== page && onChange(n)}
            >
              {n}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.pageArrow}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="다음 페이지"
      >
        <span className={styles.arrowWide} aria-hidden="true">→</span>
        <span className={styles.arrowNarrow} aria-hidden="true">›</span>
      </button>
    </nav>
  );
}

/** 최근 본 공고 (검색 전 첫 화면에서만, 기록이 있을 때만) */
function RecentJobs({ jobs, onOpen }) {
  if (!jobs.length) return null;
  return (
    <section className={styles.recent} aria-labelledby="recent-title">
      <h3 id="recent-title" className={styles.recentTitle}>
        최근 본 공고
      </h3>
      <ul className={styles.recentList}>
        {jobs.slice(0, RECENT_VISIBLE).map((job) => (
          <li key={job.id}>
            <button type="button" className={styles.recentItem} onClick={() => onOpen(job)}>
              <span className={styles.recentText}>
                <span className={styles.recentCompany}>{job.company}</span>
                <span className={styles.recentJob}>{job.title}</span>
              </span>
              <span className={styles.recentAction}>
                다시 분석 <span aria-hidden="true">→</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function JobCard({ job, selected, compared, showSource, onToggleCompare, onAnalyze }) {
  const meta = [job.employmentType, job.career, job.location].filter(Boolean);
  const firstTask = job.tasks?.find((t) => typeof t === "string" && t.trim());
  const checkPoints = getCheckPoints(job);
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

      {/* 핵심 체크 포인트: 자격요건·우대사항·근무형태에서 명확한 것만 (최대 2개, AI 없음) */}
      {checkPoints.length > 0 && (
        <ul className={styles.checks} aria-label="핵심 체크 포인트">
          {checkPoints.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}

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

      {showSource && getSourceLabel(job.source) && (
        <p className={styles.source}>출처 {getSourceLabel(job.source)}</p>
      )}

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
            onClick={() => recordRecent(job)}
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
  // 현재 결과 페이지 (1부터). 화면 전환 중에도 JobSearch는 마운트된 채라 그대로 유지되고,
  // F5 후에는 sessionStorage의 search.page로 복원된다. 범위 밖 값은 렌더링 때 paginate()가 보정
  const [page, setPage] = useState(initial?.page ?? 1);
  const resultsRef = useRef(null);
  const recentJobs = useSyncExternalStore(
    subscribeRecent,
    getRecentSnapshot,
    getRecentServerSnapshot
  );

  // 현재 검색 결과 수를 page에 알림 (null = 아직 검색 전) — 하단 비교 바 문구용
  useEffect(() => {
    onResultCount?.(jobs ? jobs.length : null);
  }, [jobs, onResultCount]);

  // 검색 결과 자체는 저장하지 않고, 다시 가져올 수 있는 검색어·필터만 저장
  useEffect(() => {
    if (!persist) return;
    patchSession({ search: { query, searchedKeyword, filter, page, hasSearched: jobs !== null } });
  }, [persist, query, searchedKeyword, filter, page, jobs]);

  const handleSearch = (e) => {
    e?.preventDefault();
    runSearch(query);
  };

  // 직무 바로가기: 검색창 값을 바꾸고 기존 검색 로직을 그대로 실행
  const handleShortcut = (q) => {
    setQuery(q);
    runSearch(q);
  };

  const runSearch = async (rawKeyword) => {
    if (loading) return;
    const keyword = rawKeyword.trim();

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
      setPage(1); // 새 검색·직무 바로가기 → 1페이지
    } catch {
      setError("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  // 근무형태: 실제 고용 형태 기준 분류 ("계약직 (정규직 전환가능)"은 계약직만). 샘플은 employmentType으로 fallback
  const countOf = (f) => jobs.filter((j) => matchesEmploymentFilter(j, f)).length;
  const visibleJobs =
    jobs && jobs.filter((j) => matchesEmploymentFilter(j, filter));
  // 통계(JobRadar)는 visibleJobs 전체 기준, 목록만 현재 페이지 10개
  const paged = visibleJobs ? paginate(visibleJobs, page) : null;

  const changeFilter = (f) => {
    setFilter(f);
    setPage(1); // 근무형태 필터 변경 → 1페이지
  };

  // 페이지 번호를 눌렀을 때만 검색 결과 시작 지점으로 이동 (화면 전환 scroll restore와는 무관)
  const changePage = (next) => {
    setPage(next);
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  // 출처 목록: 지금은 표시만, 실제 출처가 여러 개 붙으면 이 값으로 필터 버튼을 만들면 된다
  // 화면에는 내부 코드("saramin") 대신 표시 이름("사람인")
  const sources = jobs ? [...new Set(jobs.map((j) => getSourceLabel(j.source)).filter(Boolean))] : [];

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

        <div className={styles.shortcuts}>
          <span className={styles.shortcutsLabel}>이런 직무를 찾아보세요</span>
          <ul className={styles.shortcutList}>
            {JOB_SHORTCUTS.map((s) => (
              <li key={s.query}>
                <button
                  type="button"
                  className={`${styles.shortcut} ${
                    jobs && searchedKeyword === s.query ? styles.shortcutActive : ""
                  }`}
                  aria-pressed={Boolean(jobs) && searchedKeyword === s.query}
                  disabled={loading}
                  onClick={() => handleShortcut(s.query)}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      {/* 아직 검색하지 않은 첫 화면 + 최근 기록이 있을 때만 */}
      {!jobs && <RecentJobs jobs={recentJobs} onOpen={onAnalyze} />}

      {jobs && (
        <div className={styles.results} aria-live="polite" ref={resultsRef}>
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

          {/* 사람인 실데이터(source === "saramin")가 있을 때만 출처 표기. 샘플 데이터만 쓰는 지금은 표시되지 않음 */}
          {hasSaraminSource(jobs) && (
            <p className={styles.attribution}>
              <a href="https://www.saramin.co.kr" target="_blank" rel="noopener noreferrer">
                Powered by 취업 사람인
              </a>
            </p>
          )}

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
                      onClick={() => changeFilter(f)}
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
              {paged.items.map((job) => (
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

          <Pagination page={paged.page} totalPages={paged.totalPages} onChange={changePage} />
        </div>
      )}
    </section>
  );
}
