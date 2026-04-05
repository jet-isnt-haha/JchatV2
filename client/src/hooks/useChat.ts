import { useState, useRef, useCallback } from "react";
import type {
  Chat,
  ChatBranch,
  BranchTreeNode,
  BranchTreeResponse,
  ChatMessage,
  ChatStreamChunk,
  CreateChatResponse,
  SendMessageResponse,
  CreateBranchResponse,
  SwitchBranchResponse,
  BranchMessagesResponse,
} from "@jchat/shared";

export function useChat() {
  const [chat, setChat] = useState<Chat | null>(null);
  const [branches, setBranches] = useState<ChatBranch[]>([]);
  const [branchTree, setBranchTree] = useState<BranchTreeNode[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const chatRef = useRef(chat);
  chatRef.current = chat;

  const initChat = useCallback(async (): Promise<CreateChatResponse> => {
    const res = await fetch("/api/chats", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: CreateChatResponse = await res.json();
    setChat(data.chat);
    setBranches([data.branch]);
    setBranchTree([
      {
        id: data.branch.id,
        chatId: data.branch.chatId,
        name: data.branch.name,
        baseMessageId: data.branch.baseMessageId,
        parentBranchId: null,
        createdAt: data.branch.createdAt,
        isCurrent: true,
        children: [],
      },
    ]);
    return data;
  }, []);

  const loadBranchTree = useCallback(async (chatId: string) => {
    const res = await fetch(`/api/chats/${chatId}/branch-tree`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { nodes }: BranchTreeResponse = await res.json();
    setBranchTree(nodes);
  }, []);

  const loadBranchMessages = useCallback(
    async (chatId: string, branchId: string) => {
      const res = await fetch(
        `/api/chats/${chatId}/branches/${branchId}/messages`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { messages: chain }: BranchMessagesResponse = await res.json();
      setMessages(chain);
    },
    [],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (isLoading) return;
      setIsLoading(true);

      try {
        let currentChat = chatRef.current;

        if (!currentChat) {
          const { chat: newChat } = await initChat();
          currentChat = newChat;
        }

        const res = await fetch(`/api/chats/${currentChat.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: currentChat.currentBranchId,
            content,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const {
          userMessage,
          assistantMessage,
          streamSessionId,
        }: SendMessageResponse = await res.json();

        setMessages((prev) => [
          ...prev,
          userMessage,
          { ...assistantMessage, content: "" },
        ]);

        await receiveStream(
          currentChat.id,
          streamSessionId,
          assistantMessage.id,
        );
      } catch (err) {
        console.error("Chat error:", err);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && !last.content) {
            next[next.length - 1] = {
              ...last,
              content: "发生错误，请重试。",
            };
          }
          return next;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, initChat],
  );

  function receiveStream(
    chatId: string,
    sessionId: string,
    assistantMsgId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const source = new EventSource(
        `/api/chats/${chatId}/stream/${sessionId}`,
      );

      source.onmessage = (event) => {
        const chunk: ChatStreamChunk = JSON.parse(event.data as string);
        if (chunk.done) {
          source.close();
          resolve();
          return;
        }
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === assistantMsgId);
          if (idx !== -1) {
            next[idx] = {
              ...next[idx],
              content: next[idx].content + chunk.content,
            };
          }
          return next;
        });
      };

      source.onerror = () => {
        source.close();
        reject(new Error("SSE connection error"));
      };
    });
  }

  const forkBranch = useCallback(
    async (baseMessageId: string, name?: string) => {
      const currentChat = chatRef.current;
      if (!currentChat) return;

      const res = await fetch(`/api/chats/${currentChat.id}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseMessageId, name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { branch, chat: updatedChat }: CreateBranchResponse =
        await res.json();
      setChat(updatedChat);
      setBranches((prev) => [...prev, branch]);

      await loadBranchTree(currentChat.id);
      await loadBranchMessages(currentChat.id, branch.id);
    },
    [loadBranchMessages, loadBranchTree],
  );

  const switchBranch = useCallback(
    async (branchId: string) => {
      const currentChat = chatRef.current;
      if (!currentChat) return;

      const res = await fetch(`/api/chats/${currentChat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentBranchId: branchId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { chat: updatedChat }: SwitchBranchResponse = await res.json();
      setChat(updatedChat);

      await loadBranchTree(currentChat.id);
      await loadBranchMessages(currentChat.id, branchId);
    },
    [loadBranchMessages, loadBranchTree],
  );

  return {
    chat,
    branches,
    branchTree,
    messages,
    isLoading,
    sendMessage,
    forkBranch,
    switchBranch,
  };
}
