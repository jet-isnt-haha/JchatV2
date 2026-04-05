import type {
  BranchMessagesResponse,
  BranchTreeResponse,
  CreateBranchResponse,
  CreateChatResponse,
  SendMessageResponse,
  SwitchBranchResponse,
} from "@jchat/shared";
import { requestJson } from "@/network/httpClient";

export const chatApi = {
  createChat() {
    return requestJson<CreateChatResponse>("/api/chats", { method: "POST" });
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

  createStream(chatId: string, sessionId: string) {
    return new EventSource(`/api/chats/${chatId}/stream/${sessionId}`);
  },
};
