import type { AskFn } from '../ai/ask';

export interface AiAssistantApi {
	open(): void;
	close(): void;
	toggle(): void;
	readonly isOpen: boolean;

	ask: AskFn;
}

export interface AiAssistantConfig {
	aiSearchUrl: string;
	restNonce: string;

	adminUrl: string;

	isAiSupported?: () => boolean;

	canConnectProvider?: () => boolean;

	isAiAvailable?: () => boolean;

	isOverrideEnabled?: () => boolean;
}

export type AiAssistantFactory = ( config: AiAssistantConfig ) => AiAssistantApi & {
	attachAsk( fn: AskFn ): void;
	setBaselineLoading( loading: boolean ): void;
};
