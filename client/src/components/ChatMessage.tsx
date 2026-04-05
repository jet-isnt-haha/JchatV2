import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage as MessageType } from "@jchat/shared";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatMessageProps {
  message: MessageType;
  onFork?: (messageId: string) => void;
  hasForks?: boolean;
}

export function ChatMessage({ message, onFork, hasForks }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "group flex mb-4",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div className="relative max-w-[80%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted",
          )}
        >
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : (
            <p className="animate-pulse text-muted-foreground">思考中...</p>
          )}
        </div>

        <div
          className={cn(
            "absolute top-1/2 -translate-y-1/2 flex items-center gap-1",
            isUser ? "-left-8" : "-right-8",
          )}
        >
          {onFork && message.content && (
            <button
              onClick={() => onFork(message.id)}
              className="rounded p-0.5 text-muted-foreground opacity-0
                         transition-opacity hover:bg-muted hover:text-foreground
                         group-hover:opacity-100"
              title="从此处创建分支"
            >
              <GitBranch className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
