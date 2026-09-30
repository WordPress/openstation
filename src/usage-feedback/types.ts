/**
 * Usage feedback — the types both sides of the lazy-bundle seam share.
 *
 * A leaf on purpose: the main bundle's prompt and loader import these
 * without reaching the form module, whose imports register the modal
 * and field kit and must stay out of `desktop.min.js`.
 */

/** How the form was left: answers forwarded, or closed without sending. */
export type UsageFeedbackOutcome = 'sent' | 'dismissed';

/**
 * Everything the form needs. It takes its whole world through this
 * object and reports back through `onClose`, so the copy compiled into
 * the lazy bundle reads no module-level state the shell owns.
 */
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
	openUsageFeedbackForm: ( opts: UsageFeedbackFormOptions ) => void;
}
