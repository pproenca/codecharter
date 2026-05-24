export type AnnotationPromptCopyOutcome =
  | {
      readonly copied: true;
      readonly closeActions: true;
      readonly buttonLabel: "Copied";
      readonly selectionStatus: "Copied.";
    }
  | {
      readonly copied: false;
      readonly closeActions: false;
      readonly buttonLabel: "Copy failed";
      readonly selectionStatus: "Copy failed.";
      readonly feedback: {
        readonly message: "Copy failed. Try Copy Prompt again.";
        readonly tone: "error";
      };
    };

export function annotationPromptCopyOutcome(copied: boolean): AnnotationPromptCopyOutcome {
  return copied
    ? {
        copied: true,
        closeActions: true,
        buttonLabel: "Copied",
        selectionStatus: "Copied.",
      }
    : {
        copied: false,
        closeActions: false,
        buttonLabel: "Copy failed",
        selectionStatus: "Copy failed.",
        feedback: {
          message: "Copy failed. Try Copy Prompt again.",
          tone: "error",
        },
      };
}
