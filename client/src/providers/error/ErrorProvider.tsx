import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { normalizeError } from "@/errors/normalizeError";
import type { AppError } from "@/errors/types";

interface ErrorContextValue {
  error: AppError | null;
  showError: (error: unknown) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextValue | null>(null);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<AppError | null>(null);

  const value = useMemo<ErrorContextValue>(
    () => ({
      error,
      showError: (next) => setError(normalizeError(next)),
      clearError: () => setError(null),
    }),
    [error],
  );

  return (
    <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>
  );
}

export function useErrorActions() {
  const ctx = useContext(ErrorContext);
  if (!ctx) {
    throw new Error("useErrorActions must be used within ErrorProvider");
  }
  return ctx;
}
