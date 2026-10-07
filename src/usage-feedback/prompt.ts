import { __ } from '../i18n';
import '../ui/components/os-button/os-button';
import { openUsageFeedbackForm } from './form';
import type { UsageFeedbackPromptOptions } from './types';

const STYLE_ID = 'os-usage-feedback-prompt-styles';
const CARD_CLASS = 'os-usage-feedback-prompt';
const TITLE_ID = 'os-usage-feedback-prompt-title';

const STYLES = `

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

export function showUsageFeedbackPrompt( opts: UsageFeedbackPromptOptions ): void {
	const doc = document;
	if ( doc.querySelector( `.${ CARD_CLASS }` ) ) {
		return;
	}
	ensureStyles( doc );

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

	( doc.getElementById( 'os-shell' ) ?? doc.body ).appendChild( card );
}
