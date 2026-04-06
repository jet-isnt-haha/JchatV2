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
      // Keep retrying within the same 2-minute recover window defined by PRD.
      const reconnectDeadline = Date.now() + 2 * 60 * 1000;
      let lastSeq = 0;
      let reconnectCount = 0;

      const connect = (cursorSeq: number): Promise<void> =>
        new Promise((resolve, reject) => {
          const source = chatApi.createStream(chatId, sessionId, cursorSeq);
          // 复现断线重连
          /*   let settled = false;

          const cleanup = () => {
            window.removeEventListener("offline", handleOffline);
          };

          const settleResolve = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          };

          const settleReject = (error: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };

          const handleOffline = () => {
            source.close();
            settleReject(new Error("BROWSER_OFFLINE"));
          };

          window.addEventListener("offline", handleOffline); */

          source.onmessage = (event) => {
            const chunk: ChatStreamChunk = JSON.parse(event.data as string);

            // Ignore replayed/duplicate chunks on reconnect.
            if (chunk.seq <= lastSeq) {
              return;
            }
            lastSeq = chunk.seq;

            if (chunk.done) {
              source.close();

              if (chunk.errorCode) {
                reject(new Error(chunk.errorCode));
                // settleReject(new Error(chunk.errorCode));
                return;
              }
              resolve();
              // settleResolve();
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
            // settleReject(new Error("SSE connection error"));
          };
        });

      return new Promise((resolve, reject) => {
        const attempt = async () => {
          try {
            await connect(lastSeq);
            resolve();
          } catch (error) {
            if (Date.now() >= reconnectDeadline) {
              reject(error);
              return;
            }

            // Exponential backoff keeps reconnect aggressive at first but bounded.
            reconnectCount += 1;
            const delay = Math.min(
              2000,
              200 * 2 ** Math.min(reconnectCount, 4),
            );
            window.setTimeout(attempt, delay);
          }
        };

        void attempt();
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
