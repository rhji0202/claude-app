/**
 * 실행에 쓸 수 있는 Claude 모델·effort 정의. API(검증)와 web(선택 UI)이 함께 쓴다.
 * 모델을 추가할 때 여기만 고치면 양쪽이 같이 따라온다.
 *
 * Agent SDK도 ModelInfo.supportsEffort / supportedEffortLevels를 제공하지만,
 * 이는 Query 객체의 supportedModels()로만 얻을 수 있어(=실행 세션 필요) 부팅 시
 * env 검증이나 설정 폼 검증에는 쓸 수 없다. 그래서 정적 목록을 따로 둔다.
 * SDK의 EffortLevel 유니온과 값이 일치해야 한다.
 */

/** reasoning effort 레벨. 낮을수록 토큰·지연이 적다. SDK EffortLevel과 동일. */
export const EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export interface ModelOption {
  /** API 모델 id. 날짜 접미사 없는 고정 스냅샷 id를 그대로 쓴다. */
  id: string;
  /** UI 표시명 */
  label: string;
  /**
   * effort 파라미터를 지원하는가. false면 effort를 보내도 무시되거나 거부되므로
   * 저장 시점과 실행 시점 양쪽에서 effort를 비운다.
   */
  supportsEffort: boolean;
}

/** 선택 가능한 모델. 최신 세대 우선. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-opus-5", label: "Opus 5", supportsEffort: true },
  { id: "claude-fable-5", label: "Fable 5", supportsEffort: true },
  { id: "claude-sonnet-5", label: "Sonnet 5", supportsEffort: true },
  { id: "claude-opus-4-8", label: "Opus 4.8", supportsEffort: true },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", supportsEffort: false },
];

export const MODEL_IDS: string[] = MODEL_OPTIONS.map((m) => m.id);

/**
 * 이 모델이 effort를 지원하는가. 목록에 없는 모델(직접 지정한 신규/레거시 id)은
 * 지원한다고 본다 — 모르는 모델에 대해 조용히 effort를 버리는 쪽이 더 위험하다.
 */
export function modelSupportsEffort(model: string | null | undefined): boolean {
  if (!model) return true;
  const found = MODEL_OPTIONS.find((m) => m.id === model);
  return found ? found.supportsEffort : true;
}
