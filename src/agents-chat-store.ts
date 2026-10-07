import { createSharedStore } from './shared-store';
import type {
	AgentCallToAction,
	AgentToolCall,
} from './agents-types';

export interface AgentChatAgent {
	id: number;
	name: string;
	description: string;
	avatarUrl: string;
}

export interface AgentChatAttachment {
	kind: 'post' | 'page' | 'media' | 'user' | 'comment';
	id: number;
	title: string;
}

export interface AgentChatMessage {
	role: 'user' | 'agent' | 'error';
	text: string;

	attachment?: AgentChatAttachment;
	toolCalls?: AgentToolCall[];

	callToActions?: AgentCallToAction[];

	ctaUsed?: boolean;
	at: number;

	pending?: boolean;
}

export interface AgentsChatState {

	activeAgent: AgentChatAgent | null;

	transcripts: Record< number, AgentChatMessage[] >;

	conversationIds: Record< number, number | null >;

	conversationsRev: number;
}

export const agentsChatStore = createSharedStore< AgentsChatState >(
	'desktop-mode/agents-chat',
	() => ( {
		activeAgent: null,
		transcripts: {},
		conversationIds: {},
		conversationsRev: 0,
	} ),
);

export function openAgentChat( agent: AgentChatAgent ): void {
	agentsChatStore.state.activeAgent = agent;
	if ( ! agentsChatStore.state.transcripts[ agent.id ] ) {
		agentsChatStore.state.transcripts[ agent.id ] = [];
	}
	if ( ! agentsChatStore.state.conversationIds ) {
		agentsChatStore.state.conversationIds = {};
		agentsChatStore.state.conversationsRev = 0;
	}
	agentsChatStore.notify();
}
