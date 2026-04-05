import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BranchTreeNode,
  Chat,
  ChatBranch,
  ChatMessage,
  ChatStreamChunk,
  CreateChatResponse,
} from "@jchat/shared";
import { chatApi } from "@/services/chatApi";
import { useErrorActions } from "@/providers/error/ErrorProvider";

interface ChatContextValue {
  chat: Chat | null;
  branches: ChatBranch[];
  branchTree: BranchTreeNode[];
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  forkBranch: (baseMessageId: string, name?: string) => Promise<void>;
  switchBranch: (branchId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [branches, setBranches] = useState<ChatBranch[]>([]);
  const [branchTree, setBranchTree] = useState<BranchTreeNode[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { showError } = useErrorActions();

  const chatRef = useRef(chat);
  chatRef.current = chat;

  const initChat = useCallback(async (): Promise<CreateChatResponse> => {
    const data = await chatApi.createChat();
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
    const { nodes } = await chatApi.getBranchTree(chatId);
    setBranchTree(nodes);
  }, []);

  const loadBranchMessages = useCallback(
    async (chatId: string, branchId: string) => {
      const { messages: chain } = await chatApi.getBranchMessages(
        chatId,
        branchId,
      );
      setMessages(chain);
    },
    [],
  );

  const receiveStream = useCallback(
    (
      chatId: string,
      sessionId: string,
      assistantMsgId: string,
    ): Promise<void> => {
      return new Promise((resolve, reject) => {
        const source = chatApi.createStream(chatId, sessionId);

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

        const { userMessage, assistantMessage, streamSessionId } =
          await chatApi.sendMessage(
            currentChat.id,
            currentChat.currentBranchId,
            content,
          );

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
        showError(err);
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
    [initChat, isLoading, receiveStream, showError],
  );

  const forkBranch = useCallback(
    async (baseMessageId: string, name?: string) => {
      const currentChat = chatRef.current;
      if (!currentChat) return;

      try {
        const { branch, chat: updatedChat } = await chatApi.createBranch(
          currentChat.id,
          baseMessageId,
          name,
        );

        setChat(updatedChat);
        setBranches((prev) => [...prev, branch]);

        await loadBranchTree(currentChat.id);
        await loadBranchMessages(currentChat.id, branch.id);
      } catch (err) {
        showError(err);
      }
    },
    [loadBranchMessages, loadBranchTree, showError],
  );

  const switchBranch = useCallback(
    async (branchId: string) => {
      const currentChat = chatRef.current;
      if (!currentChat) return;

      const { chat: updatedChat } = await chatApi.switchBranch(
        currentChat.id,
        branchId,
      );
      setChat(updatedChat);

      await loadBranchTree(currentChat.id);
      await loadBranchMessages(currentChat.id, branchId);
    },
    [loadBranchMessages, loadBranchTree],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      chat,
      branches,
      branchTree,
      messages,
      isLoading,
      sendMessage,
      forkBranch,
      switchBranch,
    }),
    [
      chat,
      branches,
      branchTree,
      messages,
      isLoading,
      sendMessage,
      forkBranch,
      switchBranch,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within ChatProvider");
  }
  return ctx;
}
