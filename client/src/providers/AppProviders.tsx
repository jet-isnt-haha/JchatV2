import type { ReactNode } from "react";
import { ThemeProvider } from "@/providers/theme/ThemeProvider";
import { ErrorProvider } from "@/providers/error/ErrorProvider";
import { ChatProvider } from "@/providers/chat/ChatProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ErrorProvider>
        <ChatProvider>{children}</ChatProvider>
      </ErrorProvider>
    </ThemeProvider>
  );
}
