import { useErrorActions } from "@/providers/error/ErrorProvider";

export function GlobalErrorBanner() {
  const { error, clearError } = useErrorActions();

  if (!error) return null;

  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <span>{error.message}</span>
        <button
          onClick={clearError}
          className="rounded border border-destructive/40 px-2 py-0.5 hover:bg-destructive/10"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
