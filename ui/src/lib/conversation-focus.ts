import type { ReactNode } from "react";
import type { IssueAttachment, IssueComment, IssueWorkProduct } from "@paperclipai/shared";

/** Optional presentation slot; the native thread still owns sending, queues,
 * runtime requests, approvals, recovery and the durable conversation. */
export interface ConversationFocusState {
  runStatus: "idle" | "queued" | "running";
  awaitingInput: boolean;
  unavailable: boolean;
  loading: boolean;
}
export interface ConversationFocusView {
  canvas?: boolean;
  docked?: boolean;
  onClose?: () => void;
  assistantName?: string;
  showTranscript: boolean;
  composerCollapsed?: boolean;
  onExpandComposer?: () => void;
  onCollapseComposer?: () => void;
  render: (state: ConversationFocusState) => ReactNode;
}
export interface AgentConversationFocusData extends ConversationFocusState {
  issueId: string | null;
  voiceSessionKey?: string;
  companyId?: string;
  reply: IssueComment | undefined;
  attachments: IssueAttachment[];
  workProducts: IssueWorkProduct[];
  onTranscript: (text: string) => void;
  onVoiceMessage?: (text: string) => Promise<void>;
  voiceDisabled: boolean;
}
export interface AgentConversationFocusView {
  canvas?: boolean;
  docked?: boolean;
  onClose?: () => void;
  assistantName?: string;
  showTranscript: boolean;
  composerCollapsed?: boolean;
  onExpandComposer?: () => void;
  onCollapseComposer?: () => void;
  render: (state: AgentConversationFocusData) => ReactNode;
}
