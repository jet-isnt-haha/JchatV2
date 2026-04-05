import type { ReactNode } from "react";
import { X } from "lucide-react";

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ open, title, onClose, children }: DrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        aria-label="关闭侧栏"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="absolute left-0 top-0 h-full w-[85%] max-w-sm border-r bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="h-[calc(100%-49px)]">{children}</div>
      </div>
    </div>
  );
}
