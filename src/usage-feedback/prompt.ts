/**
 * Usage feedback — the prompt card.
 *
 * A titled card pinned to the bottom corner of the work area, asking
 * whether the user has two minutes to say how OpenStation is going.
 * Deliberately more than a toast and less than a dialog: it does not
 * block the desk or take focus, but it does not time out either, it
 * has no small close button to swat, and it stays until the user
 * picks one of its two answers. Its accent halo beats twice on
 * arrival so it is noticed once; reduced motion skips all of it.
 *
 * "No thanks" reports `dismissed`. "Sure" swaps the card for the form
 * (`form.ts`), whose own outcome is reported instead. Either way
 * `onAnswered` fires exactly once and the caller records it; this
 * module keeps no state beyond the card being on screen.
 *
 * Placement reads the work area, not the viewport: the card mounts
 * inside `#os-shell`, where `src/work-area/` publishes the
 * `--os-work-area-inset-*` tokens, so a bottom dock or a side rail
 * never covers it.
 *
 * The card is a dark chip whatever the admin colour scheme says, the
 * same constraint the toast and the dialog surface have, so it chains
 * through the `--os-ui-modal-*` tokens and re-points the shared text
 * and hover tokens for the `<os-button>`s inside it, as `<os-modal>`
 * does for its slotted controls.
 */

import { __ } from '../i18n';
import '../ui/components/os-button/os-button';
import { openUsageFeedbackForm } from './form';
import type { UsageFeedbackPromptOptions } from './types';

const STYLE_ID = 'os-usage-feedback-prompt-styles';
const CARD_CLASS = 'os-usage-feedback-prompt';
const TITLE_ID = 'os-usage-feedback-prompt-title';

const STYLES = `
/* The role is in the selector to outrank one rule: the WordPress
   components stylesheet sets position relative on every region, at the
   same specificity as a bare class. It loads on demand (the assistant
   brings it in), so it lands after these styles and won: the card
   dropped out of its corner to the bottom-left of the shell, partly
   off screen, the moment the user pressed the palette shortcut. */
.${ CARD_CLASS }[role='region'] {
	--os-ui-fg: var( --os-ui-modal-text, #f0f0f1 );
	--os-ui-fg-muted: var( --os-ui-modal-text-muted, #a7aaad );
	--os-ui-border: var( --os-ui-modal-border, rgba( 255, 255, 255, 0.25 ) );
	--os-ui-button-bg-hover: var( --os-ui-modal-button-bg-hover, rgba( 255, 255, 255, 0.08 ) );
	position: fixed;
	right: calc( var( --os-work-area-inset-right, 0px ) + 20px );
	bottom: calc( var( --os-work-area-inset-bottom, 80px ) + 20px );
	z-index: calc( var( --os-z-adminbar, 9991 ) - 1 );
	box-sizing: border-box;
	width: 340px;
	max-width: calc( 100vw - 32px );
	padding: 18px 18px 16px;
	border-radius: 14px;
	background-color: var( --os-ui-modal-bg, #1d2327 );
	color: var( --os-ui-modal-text, #f0f0f1 );
	border: 1px solid var( --os-ui-modal-border, rgba( 255, 255, 255, 0.25 ) );
	border-top: 3px solid var( --os-ui-accent, #2271b1 );
	box-shadow:
		0 18px 44px rgba( 0, 0, 0, 0.5 ),
		0 3px 10px rgba( 0, 0, 0, 0.25 ),
		0 0 0 4px color-mix( in srgb, var( --os-ui-accent-dim, #2271b1 ) 18%, transparent );
	font-family: var( --os-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif );
	font-size: 14px;
	line-height: 1.45;
	/* Arrives on a spring, then the accent halo beats twice and
	   settles: enough to be noticed once, not a nag that keeps
	   moving in the corner of the eye. */
	animation:
		osUsageFeedbackPromptIn 0.45s cubic-bezier( 0.2, 1.2, 0.35, 1 ) both,
		osUsageFeedbackPromptBeat 1.4s ease-in-out 0.7s 2;
}
@keyframes osUsageFeedbackPromptIn {
	from { opacity: 0; transform: translateY( 18px ) scale( 0.96 ); }
	to   { opacity: 1; transform: none; }
}
@keyframes osUsageFeedbackPromptBeat {
	50% {
		box-shadow:
			0 18px 44px rgba( 0, 0, 0, 0.5 ),
			0 3px 10px rgba( 0, 0, 0, 0.25 ),
			0 0 0 9px color-mix( in srgb, var( --os-ui-accent-dim, #2271b1 ) 34%, transparent );
	}
}
.${ CARD_CLASS }__title {
	margin: 0 0 6px;
	color: inherit;
	font-size: 16px;
	font-weight: 650;
	line-height: 1.3;
}
.${ CARD_CLASS }__text {
	margin: 0 0 14px;
	color: var( --os-ui-modal-text-muted, #a7aaad );
}
.${ CARD_CLASS }__actions {
	display: flex;
	justify-content: flex-end;
	gap: 10px;
}
@media ( prefers-reduced-motion: reduce ) {
	.${ CARD_CLASS }[role='region'] { animation: none; }
}
`;

function ensureStyles( doc: Document ): void {
	if ( doc.getElementById( STYLE_ID ) ) {
		return;
	}
	const el = doc.createElement( 'style' );
	el.id = STYLE_ID;
	el.textContent = STYLES;
	doc.head.appendChild( el );
}

/** Show the card. A second call while one is on screen is ignored. */
export function showUsageFeedbackPrompt( opts: UsageFeedbackPromptOptions ): void {
	const doc = document;
	if ( doc.querySelector( `.${ CARD_CLASS }` ) ) {
		return;
	}
	ensureStyles( doc );

	// A region, not a dialog: it sits beside the work without taking
	// focus or trapping it.
	const card = doc.createElement( 'section' );
	card.className = CARD_CLASS;
	card.setAttribute( 'role', 'region' );
	card.setAttribute( 'aria-labelledby', TITLE_ID );

	const title = doc.createElement( 'h2' );
	title.id = TITLE_ID;
	title.className = `${ CARD_CLASS }__title`;
	title.textContent = __( 'Got two minutes?' );
	card.appendChild( title );

	const text = doc.createElement( 'p' );
	text.className = `${ CARD_CLASS }__text`;
	text.textContent = __(
		'We want your feedback to improve OpenStation. Three short questions, all optional.',
	);
	card.appendChild( text );

	const actions = doc.createElement( 'div' );
	actions.className = `${ CARD_CLASS }__actions`;
	card.appendChild( actions );

	const decline = doc.createElement( 'os-button' );
	decline.setAttribute( 'variant', 'ghost' );
	decline.dataset.usageFeedbackDecline = '';
	decline.textContent = __( 'No thanks' );
	actions.appendChild( decline );

	const accept = doc.createElement( 'os-button' );
	accept.setAttribute( 'variant', 'primary' );
	accept.dataset.usageFeedbackAccept = '';
	accept.textContent = __( 'Sure' );
	actions.appendChild( accept );

	let answered = false;
	decline.addEventListener( 'click', () => {
		if ( answered ) {
			return;
		}
		answered = true;
		card.remove();
		opts.onAnswered( 'dismissed' );
	} );
	accept.addEventListener( 'click', () => {
		if ( answered ) {
			return;
		}
		answered = true;
		card.remove();
		openUsageFeedbackForm( {
			restUrl: opts.restUrl,
			restNonce: opts.restNonce,
			onClose: opts.onAnswered,
		} );
	} );

	// Inside the shell root so the work-area tokens resolve; the body
	// is the fallback for a document without one.
	( doc.getElementById( 'os-shell' ) ?? doc.body ).appendChild( card );
}
