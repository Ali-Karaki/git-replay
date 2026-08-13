// Clipboard access that never throws: the webview can deny the async
// clipboard API (e.g. when unfocused), which must not surface as an unhandled
// rejection.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall back to a transient, user-selectable textarea selection.
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
      return true;
    } catch {
      return false;
    }
  }
}
