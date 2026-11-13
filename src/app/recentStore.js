/**
 * 최근 본 공고 (localStorage, 로그인 없이 이 브라우저에만 저장)
 *
 * - 화면 상태 복원용 sessionStorage(career-radar:session)와는 완전히 분리
 * - "Career Radar 분석" 또는 "원문 공고 보기"를 누른 공고만 기록, 중복 없이 최신순 최대 5개
 * - 저장 실패·깨진 JSON은 조용히 무시 (기능이 없는 것처럼 동작)
 * - useSyncExternalStore로 읽어 서버 렌더링/hydration 때는 빈 목록
 */
import { pushRecent } from "@/lib/jobInsights";

const KEY = "career-radar:recent-viewed";
const VERSION = 1;
const CHANGE_EVENT = "career-radar:recent-change";
const EMPTY = [];

let cachedRaw = null;
let cachedList = EMPTY;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw) {
  if (!raw) return EMPTY;
  try {
    const data = JSON.parse(raw);
    if (!data || data.v !== VERSION || !Array.isArray(data.items)) return EMPTY;
    return data.items.filter((j) => j && typeof j.id === "string" && typeof j.title === "string");
  } catch {
    return EMPTY;
  }
}

/** useSyncExternalStore용: 같은 저장값이면 같은 배열을 돌려준다 */
export function getRecentSnapshot() {
  if (typeof window === "undefined") return EMPTY;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parse(raw);
  }
  return cachedList;
}

export const getRecentServerSnapshot = () => EMPTY;

export function subscribeRecent(callback) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e) => {
    if (e.key === KEY) callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", onStorage); // 다른 탭에서 바뀐 경우
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** 공고를 최근 본 공고로 기록 */
export function recordRecent(job) {
  if (typeof window === "undefined") return;
  try {
    const next = pushRecent(getRecentSnapshot(), job);
    window.localStorage.setItem(KEY, JSON.stringify({ v: VERSION, items: next }));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // 저장 실패(용량·사생활 보호 모드 등)는 무시
  }
}
