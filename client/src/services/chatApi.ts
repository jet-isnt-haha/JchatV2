import type {
  BranchMessagesResponse,
  BranchTreeResponse,
  ChatDetailResponse,
  ConfirmResearchPlanResponse,
  CreateBranchResponse,
  CreateChatResponse,
  ResearchPlanResponse,
  ResearchResultResponse,
  ResearchSnapshotResponse,
  SendMessageResponse,
  StartResearchTaskResponse,
  SwitchBranchResponse,
} from "@jchat/shared";
import { requestJson } from "@/network/httpClient";

function buildStreamUrl(path: string, cursorSeq?: number) {
  const params = new URLSearchParams();
  if (typeof cursorSeq === "number" && cursorSeq > 0) {
    params.set("cursorSeq", String(cursorSeq));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export const chatApi = {
  createChat() {
    return requestJson<CreateChatResponse>("/api/chats", { method: "POST" });
  },

  getChatDetail(chatId: string) {
    return requestJson<ChatDetailResponse>(`/api/chats/${chatId}`);
  },

  getBranchTree(chatId: string) {
    return requestJson<BranchTreeResponse>(`/api/chats/${chatId}/branch-tree`);
  },

  getBranchMessages(chatId: string, branchId: string) {
    return requestJson<BranchMessagesResponse>(
      `/api/chats/${chatId}/branches/${branchId}/messages`,
    );
  },

  createBranch(chatId: string, baseMessageId: string, name?: string) {
    return requestJson<CreateBranchResponse>(`/api/chats/${chatId}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseMessageId, name }),
    });
  },

  switchBranch(chatId: string, currentBranchId: string) {
    return requestJson<SwitchBranchResponse>(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentBranchId }),
    });
  },

  sendMessage(chatId: string, branchId: string, content: string) {
    return requestJson<SendMessageResponse>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, content }),
    });
  },

  createStream(chatId: string, sessionId: string, cursorSeq?: number) {
    const url = buildStreamUrl(`/api/chats/${chatId}/stream/${sessionId}`, cursorSeq);
    return new EventSource(url);
  },

  startResearchTask(chatId: string, topic: string) {
    return requestJson<StartResearchTaskResponse>(
      `/api/chats/${chatId}/research/tasks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      },
    );
  },

  getResearchPlan(chatId: string, taskId: string) {
    return requestJson<ResearchPlanResponse>(
      `/api/chats/${chatId}/research/tasks/${taskId}/plan`,
    );
  },

  confirmResearchPlan(
    chatId: string,
    taskId: string,
    selectedPlanItemIds: string[],
  ) {
    return requestJson<ConfirmResearchPlanResponse>(
      `/api/chats/${chatId}/research/tasks/${taskId}/plan/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedPlanItemIds }),
      },
    );
  },

  getResearchSnapshot(chatId: string, taskId: string) {
    return requestJson<ResearchSnapshotResponse>(
      `/api/chats/${chatId}/research/tasks/${taskId}/snapshot`,
    );
  },

  getResearchResult(chatId: string, taskId: string) {
    return requestJson<ResearchResultResponse>(
      `/api/chats/${chatId}/research/tasks/${taskId}/result`,
    );
  },

  createResearchStream(chatId: string, sessionId: string, cursorSeq?: number) {
    const url = buildStreamUrl(
      `/api/chats/${chatId}/research/stream/${sessionId}`,
      cursorSeq,
    );
    return new EventSource(url);
  },
};
