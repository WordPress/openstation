/**
 * Usage feedback — the types both sides of the lazy-bundle seam share.
 *
 * A leaf on purpose: the main bundle's gate and loader import these
 * without reaching the prompt or the form, whose imports register the
 * modal and field kit and must stay out of `desktop.min.js`.
 */

/** How the user answered: feedback forwarded, or declined at any step. */
export type UsageFeedbackOutcome = 'sent' | 'dismissed';

/**
 * Everything the prompt needs. It takes its whole world through this
 * object and reports back through `onAnswered`, so the copy compiled
 * into the lazy bundle reads no module-level state the shell owns.
 */
export interface UsageFeedbackPromptOptions {
	/** `POST /desktop-mode/v1/feedback/usage`. */
	restUrl: string;
	/** The REST nonce, as a fallback; `wp.os.fetch` injects the live one. */
	restNonce: string;
	/**
	 * Called exactly once, when the user has answered: `dismissed` for
	 * "No thanks" on the card or for leaving the form unsent, `sent`
	 * once the route accepted their answers.
	 */
	onAnswered: ( outcome: UsageFeedbackOutcome ) => void;
}

/** What the form needs; the prompt opens it on a yes. */
export interface UsageFeedbackFormOptions {
	/** `POST /desktop-mode/v1/feedback/usage`. */
	restUrl: string;
	/** The REST nonce, as a fallback; `wp.os.fetch` injects the live one. */
	restNonce: string;
	/** Called exactly once, when the form leaves the screen. */
	onClose: ( outcome: UsageFeedbackOutcome ) => void;
}

/** What the lazy bundle publishes on `window.openStationUsageFeedback`. */
export interface UsageFeedbackApi {
	showUsageFeedbackPrompt: ( opts: UsageFeedbackPromptOptions ) => void;
}
