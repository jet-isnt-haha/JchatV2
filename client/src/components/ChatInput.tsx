import { useState } from "react";
import { Loader2, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
  isInputLocked?: boolean;
  deepResearchEnabled?: boolean;
  onDeepResearchToggle?: (enabled: boolean) => void;
}

export function ChatInput({
  onSend,
  isLoading,
  isInputLocked = false,
  deepResearchEnabled = false,
  onDeepResearchToggle,
}: ChatInputProps) {
  const [input, setInput] = useState("");

  function handleSubmit() {
    const content = input.trim();
    if (!content || isLoading || isInputLocked) return;
    onSend(content);
    setInput("");
  }

  return (
    <div className="flex items-end gap-2 border-t p-4">
      <Button
        type="button"
        variant={deepResearchEnabled ? "default" : "outline"}
        size="sm"
        className={cn("shrink-0", deepResearchEnabled ? "border-primary" : "")}
        onClick={() => onDeepResearchToggle?.(!deepResearchEnabled)}
        disabled={isInputLocked}
      >
        <Search className="size-3.5" />
        深度研究
      </Button>

      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={
          deepResearchEnabled
            ? "输入研究主题... (Enter 启动深度研究)"
            : "输入消息... (Enter 发送, Shift+Enter 换行)"
        }
        className="min-h-10 max-h-40 resize-none"
        rows={1}
        disabled={isInputLocked}
      />
      <Button size="icon" onClick={handleSubmit} disabled={isLoading || isInputLocked || !input.trim()}>
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
      </Button>
    </div>
  );
}
