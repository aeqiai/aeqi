import { useCallback, useEffect, useRef, useState } from "react";

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function useClipboardToast(timeoutMs = 1800) {
  const [copiedCount, setCopiedCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (value: string) => {
      await writeClipboard(value);
      setCopiedCount((count) => count + 1);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedCount(0), timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return {
    copy,
    copiedCount,
    toastLabel: copiedCount > 0 ? `+${copiedCount} copied` : null,
  };
}
