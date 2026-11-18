import { loadSession, patchSession } from "./sessionStore";
import { normalizeJobId, toSavedSnapshot } from "@/lib/savedJobs";
import { toComparisonPosting, toComparisonSnapshot } from "@/lib/savedComparisons";
import { addToCompareState, readDraft } from "@/lib/customJobs";

/**
 * 저장함 → 메인 화면 분석 열기.
 * 분석 화면은 메인(/)의 화면 상태라서, 저장함에서 고른 공고를 sessionStorage에 잠깐 남기고 /로 이동한다.
 * 메인은 복원할 때 이 값을 한 번 읽고 바로 지운다.
 */
export const SAVED_ANALYZE_INTENT_KEY = "savedAnalyze";

const MAX_SESSION_DESCRIPTION = 15000;

/**
 * 저장함·직접 추가 화면에서: 분석할 공고 남기기
 * - full: 비교·분석에 쓰는 사실 필드 전체 (직접 추가한 공고처럼 공고 목록에 없는 공고도 분석 입력을 만들 수 있게)
 * - description: 이번 세션에서 붙여넣은 원문이 있을 때만 (sessionStorage에만, DB에는 저장하지 않음)
 */
export function writeAnalyzeIntent(job, { description = "" } = {}) {
  const snapshot = toSavedSnapshot(job);
  if (!snapshot) return false;
  const full = toComparisonPosting(job);
  const text = typeof description === "string" ? description.trim().slice(0, MAX_SESSION_DESCRIPTION) : "";
  patchSession({
    [SAVED_ANALYZE_INTENT_KEY]: {
      jobId: snapshot.id,
      job: snapshot,
      ...(full ? { full } : {}),
      ...(text ? { description: text } : {}),
    },
  });
  return true;
}

/** 메인에서: 남겨 둔 공고 읽고 지우기. 없거나 깨졌으면 null */
export function readAnalyzeIntent(saved = loadSession()) {
  const raw = saved?.[SAVED_ANALYZE_INTENT_KEY];
  if (!raw) return null;
  patchSession({ [SAVED_ANALYZE_INTENT_KEY]: null });
  const jobId = normalizeJobId(raw.jobId);
  const job = toSavedSnapshot({ ...(raw.job && typeof raw.job === "object" ? raw.job : {}), id: jobId });
  if (!jobId || !job) return null;
  const full = raw.full && typeof raw.full === "object" ? toComparisonPosting({ ...raw.full, id: jobId }) : null;
  const description =
    typeof raw.description === "string" ? raw.description.trim().slice(0, MAX_SESSION_DESCRIPTION) : "";
  return {
    jobId,
    job,
    full: full ? (description ? { ...full, description } : full) : null,
  };
}

/**
 * 저장함 → 저장한 비교 다시 보기.
 * 저장된 snapshot(2~3개, A/B/C 순서 그대로)을 sessionStorage에 잠깐 남기고 /로 이동하면
 * 메인이 복원할 때 한 번 읽고 지운 뒤 비교 화면을 연다. (지금 공고 목록에 없어도 snapshot으로 열림)
 */
export const SAVED_COMPARE_INTENT_KEY = "savedCompare";

export function writeCompareIntent(postings) {
  const snapshot = toComparisonSnapshot(postings);
  if (!snapshot) return false;
  patchSession({ [SAVED_COMPARE_INTENT_KEY]: { postings: snapshot.postings } });
  return true;
}

/** 남겨 둔 비교 읽고 지우기. 없거나 깨졌으면 null, 있으면 공고 snapshot 목록 */
export function readCompareIntent(saved = loadSession()) {
  const raw = saved?.[SAVED_COMPARE_INTENT_KEY];
  if (!raw) return null;
  patchSession({ [SAVED_COMPARE_INTENT_KEY]: null });
  return toComparisonSnapshot(raw.postings)?.postings ?? null;
}

/**
 * 저장함·직접 추가 화면에서: 메인의 비교 선택에 공고 하나 담기 (기존 비교 상태 그대로 사용, 최대 3개)
 * 지금 공고 목록에 없는 공고도 compareSnapshots로 복원된다.
 * @returns {{ status: "added" | "already" | "full" | "invalid", count: number }}
 */
export function addJobToCompare(job) {
  const page = loadSession()?.page;
  const r = addToCompareState(page, job);
  if (r.status === "added") patchSession({ page: r.page });
  return { status: r.status, count: r.count };
}

// ───── 공고 직접 추가: 로그인 전 입력 임시 보관 (로그인 후 다시 붙여넣지 않게) ─────
export const CUSTOM_DRAFT_KEY = "customJobDraft";

export const saveCustomDraft = (draft) => patchSession({ [CUSTOM_DRAFT_KEY]: draft });
export const clearCustomDraft = () => patchSession({ [CUSTOM_DRAFT_KEY]: null });
export const loadCustomDraft = () => readDraft(loadSession()?.[CUSTOM_DRAFT_KEY]);
