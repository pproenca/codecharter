export type ClearActivityClickState = {
  readonly clearedByCompletedHold: boolean;
  readonly disabled: boolean;
};

export type ClearActivityClickAction = "clear" | "ignore";

export function clearActivityClickAction({ clearedByCompletedHold, disabled }: ClearActivityClickState): ClearActivityClickAction {
  if (disabled || clearedByCompletedHold) return "ignore";
  return "clear";
}
