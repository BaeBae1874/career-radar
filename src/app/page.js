"use client";

import { useRef, useState } from "react";
import styles from "./page.module.css";
import JobSearch from "./JobSearch";

const INTERESTS = ["마케팅", "기획", "데이터", "개발", "디자인", "금융", "콘텐츠"];

const JOB_POSTING_PLACEHOLDER = `예:
주요 업무
- 고객 데이터를 분석해 타깃 캠페인을 기획합니다.
- 이메일, 앱푸시 등 CRM 캠페인을 운영합니다.

자격요건
- 데이터 기반으로 문제를 해결할 수 있는 분

우대사항
- SQL 또는 GA 사용 경험`;

const EMPTY_TEXT = "공고에 명시되어 있지 않아요.";

function SourceMark() {
  return <span className={`${styles.mark} ${styles.markSource}`}>원문 추출</span>;
}

function AiMark() {
  return <span className={`${styles.mark} ${styles.markAi}`}>AI 해석</span>;
}

function TextList({ items }) {
  if (!items.length) return <p className={styles.empty}>{EMPTY_TEXT}</p>;
  return (
    <ul className={styles.list}>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function Section({ title, mark, children }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {title}
        {mark}
      </h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function Chevron({ open }) {
  return (
    <svg
      className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className={styles.infoIcon}>
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="6.3" r="1" fill="currentColor" />
    </svg>
  );
}

export default function Home() {
  const [interests, setInterests] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [jobPosting, setJobPosting] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const resultRef = useRef(null);
  const analyzeRef = useRef(null);

  // 검색 결과에서 고른 공고를 분석 입력칸에 채운다. (OpenRouter 요청은 사용자가 직접 버튼을 눌러야 보냄)
  const handleSelectJob = (job) => {
    setSelectedJob(job);
    setKeyword((job.keywords ?? []).join(", "));
    setJobPosting(`공고명: ${job.title}\n회사명: ${job.company}\n\n${job.description ?? ""}`.trim());
    setError("");
    setFormOpen(true);
    requestAnimationFrame(() => {
      analyzeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const toggleInterest = (item) => {
    setInterests((prev) =>
      prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]
    );
  };

  const handleSubmit = async (e) => {
    // form 기본 submit(페이지 새로고침)으로 입력값이 초기화되지 않도록 막는다
    e?.preventDefault();
    if (loading) return;

    if (!jobPosting.trim()) {
      setError("분석할 채용공고 내용을 입력해 주세요.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/analyze-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interests, keyword, jobPosting }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.result) {
        setError(data?.error || "분석 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setResult(data.result);
      setFormOpen(false);
      setEvidenceOpen(false);
      requestAnimationFrame(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setError("서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  const showForm = formOpen;
  // 결과가 없고 입력 영역도 접혀 있으면, 큰 폼 대신 보조 링크만 보여준다
  const showAnalyzeSection = Boolean(result) || formOpen;
  const collapsedJobTitle =
    result && result.jobTitle && result.jobTitle !== "없음"
      ? result.jobTitle
      : "직무명 확인 어려움";
  const resultTags = result ? [...interests, ...(keyword.trim() ? [keyword.trim()] : [])] : [];

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <span className={styles.logo}>Career Radar</span>
          <span className={styles.topbarMeta}>채용공고 분석</span>
        </div>
      </header>

      <main className={styles.container}>
        <section className={`${styles.hero} ${result ? styles.heroCompact : ""}`}>
          <h1 className={styles.heroTitle}>
            채용공고, 제목보다 {!result && <br className={styles.mobileBreak} />}
            실제 일을 먼저 보세요.
          </h1>
          {!result && (
            <p className={styles.heroDesc}>
              실제 공고를 구조화하고, AI 해석의 원문 근거까지 함께 확인해보세요.
            </p>
          )}
        </section>

        <JobSearch selectedJobId={selectedJob?.id} onAnalyze={handleSelectJob} />

        {!showAnalyzeSection && (
          <p className={styles.manualToggle}>
            <span className={styles.manualToggleText}>원하는 공고가 없나요?</span>
            <button
              type="button"
              className={styles.textButton}
              aria-expanded={false}
              aria-controls="analyze-form"
              onClick={() => setFormOpen(true)}
            >
              직접 채용공고 붙여넣기
              <Chevron open={false} />
            </button>
          </p>
        )}

        {showAnalyzeSection && (
          <section
            className={styles.analyze}
            aria-labelledby="analyze-title"
            ref={analyzeRef}
          >
            <div className={styles.analyzeHead}>
              <div className={styles.analyzeHeadText}>
                <h2 id="analyze-title" className={styles.analyzeTitle}>
                  {showForm ? "공고 분석" : "분석한 공고"}
                </h2>
                {!showForm && <p className={styles.collapsedPreview}>{collapsedJobTitle}</p>}
              </div>
              <button
                type="button"
                className={styles.textButton}
                aria-expanded={formOpen}
                aria-controls="analyze-form"
                onClick={() => setFormOpen((v) => !v)}
              >
                {formOpen ? "접기" : "분석할 공고 수정하기"}
                <Chevron open={formOpen} />
              </button>
            </div>

            {showForm && (
              <form id="analyze-form" className={styles.form} onSubmit={handleSubmit}>
                {selectedJob && (
                  <p className={styles.loadedNotice}>
                    <strong>{selectedJob.company}</strong> · {selectedJob.title} 공고를 불러왔어요.
                    내용을 확인한 뒤 아래 분석 버튼을 눌러 주세요.
                  </p>
                )}

                <div className={styles.field}>
                  <span className={styles.label} id="interest-label">
                    관심 분야 <span className={styles.labelHint}>여러 개 선택 가능</span>
                  </span>
                  <div className={styles.options} role="group" aria-labelledby="interest-label">
                    {INTERESTS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={interests.includes(item)}
                        className={`${styles.option} ${interests.includes(item) ? styles.optionActive : ""}`}
                        onClick={() => toggleInterest(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="keyword">
                    궁금한 직무나 키워드 <span className={styles.labelHint}>선택</span>
                  </label>
                  <input
                    id="keyword"
                    className={styles.input}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="예: CRM, 그로스 마케팅, 서비스 기획"
                  />
                  <p className={styles.help}>
                    정확한 직무명을 몰라도 괜찮아요. 아는 단어만 적어도 됩니다.
                  </p>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="posting">
                    채용공고 내용
                  </label>
                  <textarea
                    id="posting"
                    className={styles.textarea}
                    rows={6}
                    value={jobPosting}
                    onChange={(e) => setJobPosting(e.target.value)}
                    placeholder={JOB_POSTING_PLACEHOLDER}
                  />
                  <p className={styles.help}>
                    분석하고 싶은 채용공고의 주요 업무, 자격요건, 우대사항 등을 붙여넣어 주세요.
                  </p>
                </div>

                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  className={styles.submit}
                  disabled={loading}
                  onClick={handleSubmit}
                >
                  {loading ? "채용공고 분석 중..." : "채용공고 분석하기"}
                </button>
              </form>
            )}
          </section>
        )}

        <p className={styles.intro}>
          Career Radar는 직업을 추천하기보다, 실제 채용공고를 바탕으로 직무의 차이를
          이해하도록 돕는 것을 목표로 합니다.
        </p>

        {result && (
          <article className={styles.result} ref={resultRef} aria-live="polite">
            <header className={styles.resultHead}>
              <p className={styles.resultEyebrow}>분석 결과</p>
              <h2 className={styles.jobTitle}>
                {result.jobTitle === "없음" ? "직무명 확인 어려움" : result.jobTitle}
              </h2>
              {resultTags.length > 0 && (
                <ul className={styles.metaTags}>
                  {resultTags.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
              <p className={styles.legend}>
                <span>
                  <SourceMark /> 공고에 적힌 내용을 그대로 정리
                </span>
                <span>
                  <AiMark /> 공고를 바탕으로 AI가 해석
                </span>
              </p>
            </header>

            <Section title="30초 만에 이해하기" mark={<AiMark />}>
              {result.simpleExplanation ? (
                <p className={styles.lead}>{result.simpleExplanation}</p>
              ) : (
                <p className={styles.empty}>{EMPTY_TEXT}</p>
              )}

              {result.explanationEvidence?.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={styles.textButton}
                    aria-expanded={evidenceOpen}
                    aria-controls="evidence"
                    onClick={() => setEvidenceOpen((v) => !v)}
                  >
                    왜 이렇게 해석했나요?
                    <Chevron open={evidenceOpen} />
                  </button>
                  {evidenceOpen && (
                    <div id="evidence" className={styles.evidence}>
                      <p className={styles.evidenceTitle}>공고 원문 근거</p>
                      {result.explanationEvidence.map((t, i) => (
                        <blockquote key={i} className={styles.quote}>
                          {t}
                        </blockquote>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className={styles.muted}>이 해석과 바로 연결되는 원문 문장은 찾지 못했어요.</p>
              )}
            </Section>

            <Section title="실제로 하게 될 일" mark={<SourceMark />}>
              <TextList items={result.actualTasks} />
            </Section>

            <Section title="지원 조건" mark={<SourceMark />}>
              <div className={styles.conditions}>
                <div className={styles.condCol}>
                  <h4 className={styles.condTitle}>필수 조건</h4>
                  <TextList items={result.required} />
                </div>
                <div className={styles.condCol}>
                  <h4 className={styles.condTitle}>우대 조건</h4>
                  <TextList items={result.preferred} />
                </div>
              </div>
            </Section>

            <Section title="핵심 업무·역량 키워드" mark={<AiMark />}>
              {result.skills.length ? (
                <ul className={styles.chips}>
                  {result.skills.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>{EMPTY_TEXT}</p>
              )}
            </Section>

            {result.similarRoles.length > 0 && (
              <Section title="비슷한 직무와 뭐가 다를까?" mark={<AiMark />}>
                <p className={styles.muted}>
                  아래 내용은 공고의 업무 내용을 바탕으로 AI가 비교한 참고 정보예요.
                </p>
                <dl className={styles.roles}>
                  {result.similarRoles.map((r, i) => (
                    <div key={i} className={styles.role}>
                      <dt>{r.name}</dt>
                      {r.difference && <dd>{r.difference}</dd>}
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            <Section title="확인하고 지원하세요">
              <div className={styles.checkBox}>
                <InfoIcon />
                <div>
                  <p className={styles.checkIntro}>
                    공고만으로는 확인되지 않은 정보예요. 지원 전에 회사 채용 페이지나 담당자에게
                    확인해 보세요.
                  </p>
                  {result.unclearPoints.length ? (
                    <ul className={styles.list}>
                      {result.unclearPoints.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.muted}>공고만으로 특별히 불명확한 부분은 없었어요.</p>
                  )}
                </div>
              </div>
            </Section>
          </article>
        )}
      </main>

      {result && (
        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <p>
              AI가 붙여넣은 공고 내용만 바탕으로 정리한 결과예요. 지원 전에는 원문 공고를 꼭 함께
              확인해 주세요.
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}
