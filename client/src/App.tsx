import { useRef, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { ChatMessage } from '@/components/ChatMessage';
import { ChatInput } from '@/components/ChatInput';

export default function App() {
  const { messages, isLoading, sendMessage } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-screen flex-col mx-auto max-w-3xl border-x">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <MessageSquare className="size-5" />
        <h1 className="text-lg font-semibold">JChat</h1>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p>发送一条消息开始对话</p>
          </div>
        ) : (
          messages.map((msg, i) => <ChatMessage key={i} message={msg} />)
        )}
      </div>

      <ChatInput onSend={sendMessage} isLoading={isLoading} />
    </div>
  );
}
