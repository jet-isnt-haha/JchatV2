// ===== Core Entities =====

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;

  parentId: string | null;
  branchId: string;
  chatId: string;
  createdAt: number;
}

export interface ChatBranch {
  id: string;
  chatId: string;
  baseMessageId: string | null;
  leafMessageId: string | null;
  name?: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  title?: string;
  currentBranchId: string;
  createdAt: number;
}

export interface BranchTreeNode {
  id: string;
  chatId: string;
  name?: string;
  baseMessageId: string | null;
  parentBranchId: string | null;
  createdAt: number;
  isCurrent: boolean;
  children: BranchTreeNode[];
}

export interface BranchTreeResponse {
  chatId: string;
  currentBranchId: string;
  nodes: BranchTreeNode[];
}

// ===== New Branch API =====

export interface CreateChatResponse {
  chat: Chat;
  branch: ChatBranch;
}

export interface ChatDetailResponse {
  chat: Chat;
  branches: ChatBranch[];
}

export interface CreateBranchRequest {
  baseMessageId: string;
  name?: string;
}

export interface CreateBranchResponse {
  branch: ChatBranch;
  chat: Chat;
}

export interface SwitchBranchRequest {
  currentBranchId: string;
}

export interface SwitchBranchResponse {
  chat: Chat;
}

export interface BranchMessagesResponse {
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  branchId: string;
  content: string;
}

export interface SendMessageResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  streamSessionId: string;
}

export interface ChatStreamChunk {
  streamId: string;
  seq: number;
  content: string;
  done: boolean;
  errorCode?: string;
}

// ===== Legacy Compatibility =====

export interface LegacyChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface LegacyChatStartResponse {
  chatId: string;
}
