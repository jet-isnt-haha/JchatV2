import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
}

export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [input, setInput] = useState('');

  function handleSubmit() {
    const content = input.trim();
    if (!content || isLoading) return;
    onSend(content);
    setInput('');
  }

  return (
    <div className="flex items-end gap-2 border-t p-4">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        className="min-h-10 max-h-40 resize-none"
        rows={1}
      />
      <Button
        size="icon"
        onClick={handleSubmit}
        disabled={isLoading || !input.trim()}
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
      </Button>
    </div>
  );
}
