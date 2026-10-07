export type UsageFeedbackOutcome = 'sent' | 'dismissed';

export interface UsageFeedbackPromptOptions {

	restUrl: string;

	restNonce: string;

	onAnswered: ( outcome: UsageFeedbackOutcome ) => void;
}

export interface UsageFeedbackFormOptions {

	restUrl: string;

	restNonce: string;

	onClose: ( outcome: UsageFeedbackOutcome ) => void;
}

export interface UsageFeedbackApi {
	showUsageFeedbackPrompt: ( opts: UsageFeedbackPromptOptions ) => void;
}
