import { cn } from '@/lib/utils';
import type { ChatMessage as MessageType } from '@jchat/shared';

interface ChatMessageProps {
  message: MessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex mb-4', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {message.content ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <p className="animate-pulse text-muted-foreground">思考中...</p>
        )}
      </div>
    </div>
  );
}
