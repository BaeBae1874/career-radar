/**
 * 같은 브라우저 탭 안에서 새로고침/개발 서버 재연결이 일어나도 작업 흐름을 이어가기 위한 sessionStorage 저장소.
 *
 * - 브라우저에서만 접근한다 (서버 렌더링 중에는 아무것도 하지 않음)
 * - 저장 실패(용량·사생활 보호 모드 등)나 깨진 JSON은 조용히 무시한다
 * - 구조가 바뀌면 VERSION을 올려 예전 데이터를 버린다
 */
const KEY = "career-radar:session";
const VERSION = 1;

const canUseStorage = () => typeof window !== "undefined" && "sessionStorage" in window;

/** 저장된 상태 전체를 읽는다. 없거나 깨졌거나 버전이 다르면 null */
export function loadSession() {
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || data.v !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

/** 최상위 필드 단위로 덮어써 저장한다. (예: { search: {...} }, { page: {...} }) */
export function patchSession(patch) {
  if (!canUseStorage()) return;
  try {
    const current = loadSession() ?? {};
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...current, ...patch, v: VERSION }));
  } catch {
    // 저장 실패는 무시 (기능에는 영향 없음)
  }
}
