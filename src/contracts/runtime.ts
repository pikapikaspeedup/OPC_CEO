import type { StepsData } from '../lib/types';

export interface RuntimeRunDispatchResponse {
  runId: string;
  status: 'starting';
}

export interface RuntimeConversationCreateResponse {
  cascadeId: string;
  state?: string;
  provider?: string;
}

export interface RuntimeConversationSendResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export type RuntimeConversationStepsResponse = StepsData;

export interface RuntimeLanguageServerSummary {
  pid: number;
  port: number;
  csrf: string;
  workspace: string;
}
