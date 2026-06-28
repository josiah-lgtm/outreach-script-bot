// ToastProvider — subscribes to the notify() pub/sub and renders a stack of toasts
// (replaces the legacy single `#notif` element + showNotif). Success toasts use the
// green accent, errors the red; errors linger longer. Mount once near the app root.

"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { onNotify } from "@/lib/notify";
import { cn } from "./cn";
import { Icon } from "./Icon";

interface Toast {
  id: number;
  msg: string;
  error: boolean;
}

// Client-mounted flag without a setState-in-effect: false during SSR (getServerSnapshot),
// true once hydrated. Keeps the portal off the server render (no hydration mismatch).
const noopSubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mounted = useMounted();
  const seq = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    return onNotify((msg, error) => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, msg, error }]);
      timers.current[id] = setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
        delete timers.current[id];
      }, error ? 7000 : 3500);
    });
  }, []);

  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  function dismiss(id: number) {
    setToasts((t) => t.filter((x) => x.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="fixed bottom-5 right-5 z-[2000] flex flex-col items-end gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={cn(
            "pointer-events-auto cursor-pointer max-w-[360px] flex items-start gap-2 bg-bg2 border rounded-lg px-4 py-2.5 text-xs font-medium leading-relaxed shadow-[var(--shadow-lg)]",
            "animate-[toastIn_0.25s_ease]",
            t.error ? "border-red text-red" : "border-green text-green",
          )}
        >
          <Icon name={t.error ? "alert-triangle" : "check"} size={15} className="mt-px shrink-0" />
          <span className="text-subtle">{t.msg}</span>
        </div>
      ))}
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>,
    document.body,
  );
}
