import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  DeepResearchTask,
  ResearchBranchProgress,
  ResearchBudgetProgress,
  ResearchEvidenceItem,
  ResearchPlanItem,
  ResearchResult,
  ResearchSnapshotResponse,
  ResearchStreamEvent,
  CreateChatResponse,
} from "@jchat/shared";
import { chatApi } from "@/services/chatApi";
import { useErrorActions } from "@/providers/error/ErrorProvider";

const RESEARCH_VISIBLE_EVIDENCE_LIMIT = 200;
const ACTIVE_RESEARCH_STORAGE_KEY = "jchat.deep_research.active";

interface ActiveResearchContext {
  chatId: string;
  taskId: string;
  streamSessionId: string;
}

interface ResearchEvidenceState {
  visible: ResearchEvidenceItem[];
  overflowCount: number;
}

function toVisibleEvidenceState(items: ResearchEvidenceItem[]): ResearchEvidenceState {
  if (items.length <= RESEARCH_VISIBLE_EVIDENCE_LIMIT) {
    return {
      visible: items,
      overflowCount: 0,
    };
  }

  return {
    visible: items.slice(items.length - RESEARCH_VISIBLE_EVIDENCE_LIMIT),
    overflowCount: items.length - RESEARCH_VISIBLE_EVIDENCE_LIMIT,
  };
}

function getTaskBusy(task: DeepResearchTask | null): boolean {
  if (!task) {
    return false;
  }
  return (
    task.status === "waiting_confirm" ||
    task.status === "running" ||
    task.status === "finalizing"
  );
}

function readActiveResearchContext(): ActiveResearchContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(ACTIVE_RESEARCH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ActiveResearchContext>;
    if (
      !parsed.chatId ||
      !parsed.taskId ||
      !parsed.streamSessionId
    ) {
      return null;
    }

    return {
      chatId: parsed.chatId,
      taskId: parsed.taskId,
      streamSessionId: parsed.streamSessionId,
    };
  } catch {
    return null;
  }
}

interface ChatContextValue {
  chat: Chat | null;
  branches: ChatBranch[];
  branchTree: BranchTreeNode[];
  messages: ChatMessage[];
  isLoading: boolean;
  isBusy: boolean;
  deepResearchEnabled: boolean;
  setDeepResearchEnabled: (enabled: boolean) => void;
  researchTask: DeepResearchTask | null;
  researchPlan: ResearchPlanItem[];
  selectedResearchPlanItemIds: string[];
  toggleResearchPlanItem: (planItemId: string) => void;
  confirmResearchPlan: () => Promise<void>;
  researchBranches: ResearchBranchProgress[];
  researchEvidence: ResearchEvidenceItem[];
  researchEvidenceOverflowCount: number;
  researchBudget: ResearchBudgetProgress | null;
  researchResult: ResearchResult | null;
  researchErrorMessage: string;
  clearResearchError: () => void;
  researchFailedOrSkippedAttempts: number;
  researchActiveSubQuestionTitle?: string;
  isResearchAwaitingConfirm: boolean;
  isResearchRunning: boolean;
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

  const [deepResearchEnabled, setDeepResearchEnabledState] = useState(false);
  const [researchTask, setResearchTask] = useState<DeepResearchTask | null>(null);
  const [researchPlan, setResearchPlan] = useState<ResearchPlanItem[]>([]);
  const [selectedResearchPlanItemIds, setSelectedResearchPlanItemIds] = useState<
    string[]
  >([]);
  const [researchBranches, setResearchBranches] = useState<
    ResearchBranchProgress[]
  >([]);
  const [researchEvidenceState, setResearchEvidenceState] =
    useState<ResearchEvidenceState>({
      visible: [],
      overflowCount: 0,
    });
  const [researchBudget, setResearchBudget] =
    useState<ResearchBudgetProgress | null>(null);
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(
    null,
  );
  const [researchErrorMessage, setResearchErrorMessage] = useState("");
  const [researchFailedOrSkippedAttempts, setResearchFailedOrSkippedAttempts] =
    useState(0);
  const [researchActiveSubQuestionTitle, setResearchActiveSubQuestionTitle] =
    useState<string>();

  const { showError } = useErrorActions();

  const chatRef = useRef(chat);
  chatRef.current = chat;

  const researchTaskRef = useRef(researchTask);
  researchTaskRef.current = researchTask;

  const researchStreamRef = useRef<EventSource | null>(null);
  const activeResearchContextRef = useRef<ActiveResearchContext | null>(null);
  const insertedResearchReportTaskIdsRef = useRef(new Set<string>());

  const persistActiveResearchContext = useCallback(
    (context: ActiveResearchContext | null) => {
      activeResearchContextRef.current = context;

      if (typeof window === "undefined") {
        return;
      }

      if (!context) {
        window.sessionStorage.removeItem(ACTIVE_RESEARCH_STORAGE_KEY);
        return;
      }

      window.sessionStorage.setItem(
        ACTIVE_RESEARCH_STORAGE_KEY,
        JSON.stringify(context),
      );
    },
    [],
  );

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

  const closeResearchStream = useCallback(() => {
    if (researchStreamRef.current) {
      researchStreamRef.current.close();
      researchStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      closeResearchStream();
    };
  }, [closeResearchStream]);

  const resetResearchPanelState = useCallback(() => {
    setResearchPlan([]);
    setSelectedResearchPlanItemIds([]);
    setResearchBranches([]);
    setResearchEvidenceState({ visible: [], overflowCount: 0 });
    setResearchBudget(null);
    setResearchResult(null);
    setResearchFailedOrSkippedAttempts(0);
    setResearchActiveSubQuestionTitle(undefined);
    setResearchErrorMessage("");
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

  const appendResearchReportToTimeline = useCallback(
    (taskId: string, result: ResearchResult) => {
      if (insertedResearchReportTaskIdsRef.current.has(taskId)) {
        return;
      }

      const currentChat = chatRef.current;
      if (!currentChat) {
        return;
      }

      insertedResearchReportTaskIdsRef.current.add(taskId);

      setMessages((prev) => {
        const parentId = prev.length > 0 ? prev[prev.length - 1].id : null;
        const reportMessage: ChatMessage = {
          id: `research-report-${taskId}`,
          role: "assistant",
          content: result.reportMarkdown,
          parentId,
          branchId: currentChat.currentBranchId,
          chatId: currentChat.id,
          createdAt: Date.now(),
        };
        return [...prev, reportMessage];
      });
    },
    [],
  );

  const applyResearchEvent = useCallback(
    (event: ResearchStreamEvent) => {
      const payload = event.payload;

      if (payload?.task) {
        setResearchTask(payload.task);
      }

      if (payload?.budget) {
        setResearchBudget(payload.budget);
      }

      if (typeof payload?.message === "string") {
        setResearchActiveSubQuestionTitle(payload.message);
      }

      if (payload?.branch) {
        setResearchBranches((prev) => {
          const idx = prev.findIndex((item) => item.id === payload.branch!.id);
          if (idx === -1) {
            return [...prev, payload.branch!];
          }
          const next = [...prev];
          next[idx] = payload.branch!;
          return next;
        });
      }

      if (payload?.evidence) {
        setResearchEvidenceState((prev) => {
          const nextVisible = [...prev.visible, payload.evidence!];
          if (nextVisible.length <= RESEARCH_VISIBLE_EVIDENCE_LIMIT) {
            return {
              visible: nextVisible,
              overflowCount: prev.overflowCount,
            };
          }

          return {
            visible: nextVisible.slice(
              nextVisible.length - RESEARCH_VISIBLE_EVIDENCE_LIMIT,
            ),
            overflowCount: prev.overflowCount + 1,
          };
        });
      }

      if (event.eventType === "report_ready") {
        if (payload?.result) {
          setResearchResult(payload.result);
        }
        if (payload?.task) {
          setResearchTask(payload.task);
        }
        if (payload?.result && payload?.task) {
          appendResearchReportToTimeline(payload.task.id, payload.result);
        }
        setResearchErrorMessage("");
        setDeepResearchEnabledState(false);
        persistActiveResearchContext(null);
      }

      if (event.eventType === "task_failed") {
        if (payload?.task) {
          setResearchTask(payload.task);
        }
        setResearchBranches([]);
        setResearchEvidenceState({ visible: [], overflowCount: 0 });
        setResearchBudget(null);
        setResearchResult(null);
        setResearchActiveSubQuestionTitle(undefined);
        setResearchFailedOrSkippedAttempts(0);
        setResearchErrorMessage(
          payload?.message ??
            "深度研究失败，请检查 Tavily key、网络状态并稍后重试。",
        );
        setDeepResearchEnabledState(false);
        persistActiveResearchContext(null);
      }
    },
    [appendResearchReportToTimeline, persistActiveResearchContext],
  );

  const recoverResearchFromSnapshot = useCallback(
    async (chatId: string, taskId: string) => {
      const snapshot: ResearchSnapshotResponse = await chatApi.getResearchSnapshot(
        chatId,
        taskId,
      );

      setResearchTask(snapshot.task);
      setResearchBranches(snapshot.branches);
      setResearchEvidenceState(toVisibleEvidenceState(snapshot.evidence));
      setResearchBudget(snapshot.budget);
      setResearchFailedOrSkippedAttempts(snapshot.failedOrSkippedAttempts);
      setResearchActiveSubQuestionTitle(snapshot.activeSubQuestionTitle);

      if (snapshot.task.status === "completed") {
        const { result } = await chatApi.getResearchResult(chatId, taskId);
        setResearchResult(result);
        appendResearchReportToTimeline(taskId, result);
        setDeepResearchEnabledState(false);
        persistActiveResearchContext(null);
      }

      if (snapshot.task.status === "failed") {
        setResearchBranches([]);
        setResearchEvidenceState({ visible: [], overflowCount: 0 });
        setResearchBudget(null);
        setResearchResult(null);
        setResearchErrorMessage(
          snapshot.task.errorMessage ??
            "深度研究失败，请检查 Tavily key、网络状态并稍后重试。",
        );
        setDeepResearchEnabledState(false);
        persistActiveResearchContext(null);
      }
    },
    [appendResearchReportToTimeline, persistActiveResearchContext],
  );

  const receiveResearchStream = useCallback(
    (chatId: string, taskId: string, sessionId: string): Promise<void> => {
      const reconnectDeadline = Date.now() + 2 * 60 * 1000;
      let lastSeq = 0;
      let reconnectCount = 0;

      const connect = (cursorSeq: number): Promise<void> =>
        new Promise((resolve, reject) => {
          const source = chatApi.createResearchStream(chatId, sessionId, cursorSeq);
          researchStreamRef.current = source;

          source.onmessage = (event) => {
            const streamEvent: ResearchStreamEvent = JSON.parse(event.data as string);

            if (streamEvent.seq <= lastSeq) {
              return;
            }
            lastSeq = streamEvent.seq;
            applyResearchEvent(streamEvent);

            if (streamEvent.done) {
              source.close();
              if (researchStreamRef.current === source) {
                researchStreamRef.current = null;
              }
              resolve();
            }
          };

          source.onerror = () => {
            source.close();
            if (researchStreamRef.current === source) {
              researchStreamRef.current = null;
            }
            reject(new Error("RESEARCH_SSE_CONNECTION_ERROR"));
          };
        });

      return new Promise((resolve, reject) => {
        const attempt = async () => {
          try {
            await connect(lastSeq);
            resolve();
          } catch (error) {
            if (Date.now() >= reconnectDeadline) {
              try {
                await recoverResearchFromSnapshot(chatId, taskId);
                resolve();
              } catch (snapshotError) {
                reject(snapshotError);
              }
              return;
            }

            reconnectCount += 1;
            const delay = Math.min(2000, 200 * 2 ** Math.min(reconnectCount, 4));
            window.setTimeout(attempt, delay);
          }
        };

        void attempt();
      });
    },
    [applyResearchEvent, recoverResearchFromSnapshot],
  );

  useEffect(() => {
    let disposed = false;

    const restore = async () => {
      if (chatRef.current) {
        return;
      }

      const persisted = readActiveResearchContext();
      if (!persisted) {
        return;
      }

      try {
        const detail = await chatApi.getChatDetail(persisted.chatId);
        if (disposed) {
          return;
        }

        setChat(detail.chat);
        setBranches(detail.branches);

        await loadBranchTree(persisted.chatId);
        await loadBranchMessages(persisted.chatId, detail.chat.currentBranchId);
        await recoverResearchFromSnapshot(persisted.chatId, persisted.taskId);

        const restoredTask = researchTaskRef.current;
        if (restoredTask && getTaskBusy(restoredTask)) {
          persistActiveResearchContext(persisted);
          void receiveResearchStream(
            persisted.chatId,
            persisted.taskId,
            persisted.streamSessionId,
          );
        } else {
          persistActiveResearchContext(null);
        }
      } catch {
        persistActiveResearchContext(null);
      }
    };

    void restore();

    return () => {
      disposed = true;
    };
  }, [
    loadBranchMessages,
    loadBranchTree,
    persistActiveResearchContext,
    receiveResearchStream,
    recoverResearchFromSnapshot,
  ]);

  const startDeepResearch = useCallback(
    async (topic: string) => {
      if (getTaskBusy(researchTaskRef.current)) {
        setResearchErrorMessage("当前已有深度研究任务进行中，请等待其完成。");
        return;
      }

      try {
        closeResearchStream();
        resetResearchPanelState();

        let currentChat = chatRef.current;
        if (!currentChat) {
          const { chat: createdChat } = await initChat();
          currentChat = createdChat;
        }

        const { task, streamSessionId } = await chatApi.startResearchTask(
          currentChat.id,
          topic,
        );
        setResearchTask(task);
        persistActiveResearchContext({
          chatId: currentChat.id,
          taskId: task.id,
          streamSessionId,
        });

        const plan = await chatApi.getResearchPlan(currentChat.id, task.id);
        setResearchPlan(plan.items);
        setSelectedResearchPlanItemIds(
          plan.items.filter((item) => item.selected).map((item) => item.id),
        );

        void receiveResearchStream(currentChat.id, task.id, streamSessionId);
      } catch (err) {
        showError(err);
        setResearchErrorMessage("深度研究启动失败，请重试。");
        persistActiveResearchContext(null);
      }
    },
    [
      closeResearchStream,
      initChat,
      persistActiveResearchContext,
      receiveResearchStream,
      resetResearchPanelState,
      showError,
    ],
  );

  const toggleResearchPlanItem = useCallback((planItemId: string) => {
    setSelectedResearchPlanItemIds((prev) => {
      if (prev.includes(planItemId)) {
        return prev.filter((id) => id !== planItemId);
      }
      return [...prev, planItemId];
    });
  }, []);

  const confirmResearchPlan = useCallback(async () => {
    const currentChat = chatRef.current;
    const task = researchTaskRef.current;
    if (!currentChat || !task) {
      return;
    }

    try {
      const { task: confirmedTask } = await chatApi.confirmResearchPlan(
        currentChat.id,
        task.id,
        selectedResearchPlanItemIds,
      );
      setResearchTask(confirmedTask);
    } catch (err) {
      showError(err);
      setResearchErrorMessage("研究计划确认失败，请检查勾选项后重试。");
    }
  }, [selectedResearchPlanItemIds, showError]);

  const clearResearchError = useCallback(() => {
    setResearchErrorMessage("");
  }, []);

  const setDeepResearchEnabled = useCallback((enabled: boolean) => {
    setDeepResearchEnabledState(enabled);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const task = researchTaskRef.current;
      const researchBusy = getTaskBusy(task);
      if (isLoading || researchBusy) {
        return;
      }

      if (deepResearchEnabled) {
        await startDeepResearch(content);
        return;
      }

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
    [
      deepResearchEnabled,
      initChat,
      isLoading,
      receiveStream,
      showError,
      startDeepResearch,
    ],
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

      if (isLoading || getTaskBusy(researchTaskRef.current)) {
        return;
      }

      const { chat: updatedChat } = await chatApi.switchBranch(
        currentChat.id,
        branchId,
      );
      setChat(updatedChat);

      await loadBranchTree(currentChat.id);
      await loadBranchMessages(currentChat.id, branchId);
    },
    [isLoading, loadBranchMessages, loadBranchTree],
  );

  const isResearchAwaitingConfirm = researchTask?.status === "waiting_confirm";
  const isResearchRunning =
    researchTask?.status === "running" || researchTask?.status === "finalizing";
  const isBusy = isLoading || isResearchAwaitingConfirm || isResearchRunning;

  const value = useMemo<ChatContextValue>(
    () => ({
      chat,
      branches,
      branchTree,
      messages,
      isLoading,
      isBusy,
      deepResearchEnabled,
      setDeepResearchEnabled,
      researchTask,
      researchPlan,
      selectedResearchPlanItemIds,
      toggleResearchPlanItem,
      confirmResearchPlan,
      researchBranches,
      researchEvidence: researchEvidenceState.visible,
      researchEvidenceOverflowCount: researchEvidenceState.overflowCount,
      researchBudget,
      researchResult,
      researchErrorMessage,
      clearResearchError,
      researchFailedOrSkippedAttempts,
      researchActiveSubQuestionTitle,
      isResearchAwaitingConfirm,
      isResearchRunning,
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
      isBusy,
      deepResearchEnabled,
      setDeepResearchEnabled,
      researchTask,
      researchPlan,
      selectedResearchPlanItemIds,
      toggleResearchPlanItem,
      confirmResearchPlan,
      researchBranches,
      researchEvidenceState,
      researchBudget,
      researchResult,
      researchErrorMessage,
      clearResearchError,
      researchFailedOrSkippedAttempts,
      researchActiveSubQuestionTitle,
      isResearchAwaitingConfirm,
      isResearchRunning,
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
