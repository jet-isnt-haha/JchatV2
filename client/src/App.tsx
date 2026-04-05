import { useRef, useEffect, useMemo, useState } from "react";
import { MessageSquare, GitBranch, X } from "lucide-react";
import { useChat } from "@/hooks/useChat";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { BranchSelector } from "@/components/BranchSelector";
import { BranchTreePanel } from "@/components/BranchTreePanel";

export default function App() {
  const {
    chat,
    branches,
    branchTree,
    messages,
    isLoading,
    sendMessage,
    forkBranch,
    switchBranch,
  } = useChat();
  const [treeOpen, setTreeOpen] = useState(false);
  const [switchHint, setSwitchHint] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const forkPointSet = useMemo(() => {
    const set = new Set<string>();
    for (const branch of branches) {
      if (branch.baseMessageId) {
        set.add(branch.baseMessageId);
      }
    }
    return set;
  }, [branches]);

  const handleSwitchBranch = async (branchId: string) => {
    if (isLoading) {
      setSwitchHint("请等待当前回复完成后再切换分支");
      return;
    }

    setSwitchHint(null);
    try {
      await switchBranch(branchId);
      setTreeOpen(false);
    } catch {
      setSwitchHint("分支切换失败，请重试");
    }
  };

  return (
    <div className="mx-auto flex h-screen max-w-7xl border-x md:grid md:grid-cols-2">
      <aside className="hidden min-w-0 border-r md:flex md:flex-col">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">分支树</h2>
          <p className="mt-1 text-xs text-muted-foreground">点击节点切换分支</p>
        </div>
        <div className="min-h-0 flex-1">
          <BranchTreePanel
            tree={branchTree}
            currentBranchId={chat?.currentBranchId}
            disabled={isLoading}
            onSelect={handleSwitchBranch}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:w-full">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTreeOpen(true)}
              className="rounded-md border p-1.5 text-muted-foreground hover:bg-muted md:hidden"
              title="打开分支树"
            >
              <GitBranch className="size-4" />
            </button>
            <MessageSquare className="size-5" />
            <h1 className="text-lg font-semibold">JChat</h1>
          </div>
          {chat && (
            <BranchSelector
              branches={branches}
              currentBranchId={chat.currentBranchId}
              onSwitch={handleSwitchBranch}
            />
          )}
        </header>

        {switchHint && (
          <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            {switchHint}
          </div>
        )}

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
                onFork={!isLoading ? forkBranch : undefined}
                hasForks={forkPointSet.has(msg.id)}
              />
            ))
          )}
        </div>

        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      </div>

      {treeOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="关闭分支树"
            className="absolute inset-0 bg-black/40"
            onClick={() => setTreeOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[85%] max-w-sm border-r bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">分支树</h2>
              <button
                onClick={() => setTreeOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="h-[calc(100%-49px)]">
              <BranchTreePanel
                tree={branchTree}
                currentBranchId={chat?.currentBranchId}
                disabled={isLoading}
                onSelect={handleSwitchBranch}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
