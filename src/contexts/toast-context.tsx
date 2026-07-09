"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Toast notifications.
 *
 * Bottom-of-screen, auto-dismiss for info, persistent for errors with a
 * Retry button. Used by anything that fires a Server Action and wants
 * to surface failure non-intrusively (set logging, session completion,
 * future offline-queue replay, etc.).
 *
 * Stays a small primitive on purpose — one toast at a time, simple API.
 */

type ToastVariant = "info" | "error";

type ShowToastInput = {
  message: string;
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. 0 = persistent. Defaults: info=5000, error=0. */
  durationMs?: number;
  /** Optional Retry callback. When provided, a Retry button is rendered. */
  onRetry?: () => void | Promise<void>;
};

type ToastState = ShowToastInput & { id: number };

type ToastContextValue = {
  showToast: (input: ShowToastInput) => void;
  dismissToast: () => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const dismissToast = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((input: ShowToastInput) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    idRef.current += 1;
    const next: ToastState = { ...input, id: idRef.current };
    setToast(next);
    const duration = input.durationMs ?? (input.variant === "error" ? 0 : 5000);
    if (duration > 0) {
      dismissTimer.current = setTimeout(() => {
        setToast((prev) => (prev?.id === next.id ? null : prev));
      }, duration);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {toast && <ToastView toast={toast} onDismiss={dismissToast} />}
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}) {
  const isError = toast.variant === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className="fixed left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
    >
      <div
        className={`pointer-events-auto max-w-sm w-full rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200 ${
          isError
            ? "bg-destructive text-destructive-foreground"
            : "bg-foreground text-background"
        }`}
      >
        <p className="flex-1 text-sm">{toast.message}</p>
        {toast.onRetry && (
          <button
            onClick={async () => {
              const handler = toast.onRetry;
              onDismiss();
              if (handler) await handler();
            }}
            className="text-sm font-semibold underline-offset-2 hover:underline active:opacity-70 shrink-0"
          >
            Retry
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-sm font-semibold opacity-70 active:opacity-50 shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
