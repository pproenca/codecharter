export type ClipboardEnvironment = {
  readonly Blob?: typeof Blob;
  readonly ClipboardItem?: typeof ClipboardItem;
  readonly document?: Pick<Document, "body" | "createElement" | "execCommand">;
  readonly navigator?: {
    readonly clipboard?: {
      readonly write?: Clipboard["write"];
      readonly writeText?: Clipboard["writeText"];
    };
  };
};

export async function copyTextToClipboard(
  text: string,
  environment: ClipboardEnvironment = browserClipboardEnvironment(),
) {
  return await writeTextToClipboard(text, environment)
    || await writeClipboardItem(text, environment)
    || copyTextWithLegacyCommand(text, environment);
}

function browserClipboardEnvironment(): ClipboardEnvironment {
  return {
    Blob: window.Blob,
    ClipboardItem: window.ClipboardItem,
    document,
    navigator,
  };
}

async function writeTextToClipboard(text: string, { navigator }: ClipboardEnvironment) {
  if (!navigator?.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function writeClipboardItem(text: string, { Blob, ClipboardItem, navigator }: ClipboardEnvironment) {
  if (!navigator?.clipboard?.write || !ClipboardItem || !Blob) return false;
  try {
    const item = new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

function copyTextWithLegacyCommand(text: string, { document }: ClipboardEnvironment) {
  if (!document?.body) return false;
  const element = document.createElement("textarea");
  element.value = text;
  element.setAttribute("readonly", "");
  element.style.position = "fixed";
  element.style.left = "-9999px";
  document.body.append(element);
  element.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    element.remove();
  }
}
