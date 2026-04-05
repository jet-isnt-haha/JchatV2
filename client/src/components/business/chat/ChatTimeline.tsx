import type { RefObject } from "react";
import type { ChatMessage as ChatMessageEntity } from "@jchat/shared";
import { ChatMessage } from "@/components/ChatMessage";

interface ChatTimelineProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  messages: ChatMessageEntity[];
  isLoading: boolean;
  forkPointSet: Set<string>;
  onForkBranch: (messageId: string, name?: string) => Promise<void>;
}

export function ChatTimeline({
  scrollRef,
  messages,
  isLoading,
  forkPointSet,
  onForkBranch,
}: ChatTimelineProps) {
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p>发送一条消息开始对话</p>
        </div>
      ) : (
        messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onFork={!isLoading ? onForkBranch : undefined}
            hasForks={forkPointSet.has(msg.id)}
          />
        ))
      )}
    </div>
  );
}
