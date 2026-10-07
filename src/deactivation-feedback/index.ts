import { __ } from '../i18n';
import { trackedFetch } from '../tracked-fetch';

export type DeactivationFeedbackContext = 'classic' | 'chromeless' | 'app';

export interface DeactivationFeedbackConfig {

	plugin: string;

	restUrl: string;

	restNonce: string;
	context: DeactivationFeedbackContext;

	styleUrl?: string;
}

export interface DeactivationFeedbackApi {

	ask: ( config: DeactivationFeedbackConfig ) => Promise< void >;
}

export const REASONS: ReadonlyArray< { value: string; label: () => string } > = [
	{ value: 'changed_too_much', label: () => __( 'It changed WordPress too much' ) },
	{ value: 'missing_features', label: () => __( 'I\u2019m missing features I need' ) },
	{ value: 'too_buggy', label: () => __( 'It\u2019s too buggy or unstable' ) },
	{ value: 'other', label: () => __( 'Other' ) },
];

export const DETAILS_MAX = 1000;

export const SEND_TIMEOUT_MS = 4000;

const STYLE_ELEMENT_ID = 'os-deactivation-feedback-css';

const FOCUSABLE = 'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]';

let open = false;

function ensureStylesheet( url: string | undefined, doc: Document ): void {
	if ( ! url || doc.getElementById( STYLE_ELEMENT_ID ) ) {
		return;
	}
	const link = doc.createElement( 'link' );
	link.id = STYLE_ELEMENT_ID;
	link.rel = 'stylesheet';
	link.href = url;
	doc.head.appendChild( link );
}

interface DialogParts {
	scrim: HTMLElement;
	form: HTMLFormElement;
	details: HTMLTextAreaElement;
	skip: HTMLButtonElement;
	send: HTMLButtonElement;

	reasons: () => string[];
}

export function buildDeactivationDialog( doc: Document = document ): DialogParts {
	const scrim = doc.createElement( 'div' );
	scrim.className = 'os-deactivation-feedback';
	scrim.setAttribute( 'role', 'dialog' );
	scrim.setAttribute( 'aria-modal', 'true' );
	scrim.setAttribute( 'aria-labelledby', 'os-deactivation-feedback-title' );

	const card = doc.createElement( 'form' );
	card.className = 'os-deactivation-feedback__card';
	card.noValidate = true;
	scrim.appendChild( card );

	const title = doc.createElement( 'h2' );
	title.id = 'os-deactivation-feedback-title';
	title.className = 'os-deactivation-feedback__title';
	title.textContent = __( "Before you go, what didn't work?" );
	card.appendChild( title );

	const subtitle = doc.createElement( 'p' );
	subtitle.className = 'os-deactivation-feedback__subtitle';
	subtitle.textContent = __( 'Optional. One answer helps us fix what sent you away.' );
	card.appendChild( subtitle );

	const group = doc.createElement( 'div' );
	group.className = 'os-deactivation-feedback__reasons';
	group.setAttribute( 'role', 'group' );
	group.setAttribute( 'aria-labelledby', 'os-deactivation-feedback-title' );
	for ( const opt of REASONS ) {
		const label = doc.createElement( 'label' );
		label.className = 'os-deactivation-feedback__reason';
		const input = doc.createElement( 'input' );
		input.type = 'checkbox';
		input.name = 'reasons';
		input.value = opt.value;
		label.appendChild( input );
		const text = doc.createElement( 'span' );
		text.textContent = opt.label();
		label.appendChild( text );
		group.appendChild( label );
	}
	card.appendChild( group );

	const fieldHead = doc.createElement( 'div' );
	fieldHead.className = 'os-deactivation-feedback__field-head';
	card.appendChild( fieldHead );

	const fieldLabel = doc.createElement( 'label' );
	fieldLabel.className = 'os-deactivation-feedback__label';
	fieldLabel.htmlFor = 'os-deactivation-feedback-details';
	fieldLabel.textContent = __( 'Details (optional)' );
	fieldHead.appendChild( fieldLabel );

	const prompt = doc.createElement( 'p' );
	prompt.id = 'os-deactivation-feedback-prompt';
	prompt.className = 'os-deactivation-feedback__prompt';
	prompt.textContent = __( 'What broke, and on which screen? One sentence is enough for us to find it.' );
	fieldHead.appendChild( prompt );

	const details = doc.createElement( 'textarea' );
	details.id = 'os-deactivation-feedback-details';
	details.className = 'os-deactivation-feedback__details';
	details.name = 'details';
	details.maxLength = DETAILS_MAX;
	details.rows = 3;

	details.setAttribute( 'aria-label', __( 'Details (optional)' ) );
	details.placeholder = __( 'Anything else? (optional)' );
	card.appendChild( details );

	const disclosure = doc.createElement( 'p' );
	disclosure.className = 'os-deactivation-feedback__disclosure';
	disclosure.textContent = __(
		'What we send: your answer, the plugin, WordPress and PHP versions, your site language, and a few anonymous site facts listed in the plugin readme. Nothing that identifies you or your site.',
	);
	card.appendChild( disclosure );

	const actions = doc.createElement( 'div' );
	actions.className = 'os-deactivation-feedback__actions';
	card.appendChild( actions );

	const skip = doc.createElement( 'button' );
	skip.type = 'button';
	skip.className = 'os-deactivation-feedback__btn os-deactivation-feedback__btn--ghost';
	skip.textContent = __( 'Skip and deactivate' );
	actions.appendChild( skip );

	const send = doc.createElement( 'button' );
	send.type = 'submit';
	send.className = 'os-deactivation-feedback__btn os-deactivation-feedback__btn--primary';
	send.textContent = __( 'Send and deactivate' );

	send.disabled = true;
	actions.appendChild( send );

	const ticked = (): string[] =>
		Array.from( card.querySelectorAll< HTMLInputElement >( 'input[name="reasons"]:checked' ) ).map( ( i ) => i.value );

	const reasons = (): string[] => {
		const picked = ticked();
		return picked.length === 0 && details.value.trim() !== '' ? [ 'other' ] : picked;
	};

	const refresh = (): void => {
		const picked = ticked();
		send.disabled = picked.length === 0 && details.value.trim() === '';

		const buggy = picked.includes( 'too_buggy' );
		fieldHead.toggleAttribute( 'data-asking', buggy );
		if ( buggy ) {
			details.setAttribute( 'aria-describedby', prompt.id );
			details.placeholder = __( 'Which page or plugin?' );
			return;
		}
		details.removeAttribute( 'aria-describedby' );
		if ( picked.includes( 'missing_features' ) ) {
			details.placeholder = __( 'Which features?' );
		} else {
			details.placeholder = __( 'Anything else? (optional)' );
		}
	};
	card.addEventListener( 'change', refresh );
	details.addEventListener( 'input', refresh );

	return { scrim, form: card, details, skip, send, reasons };
}

async function postAnswer(
	config: DeactivationFeedbackConfig,
	reasons: string[],
	details: string,
): Promise< void > {
	const headers: Record< string, string > = { 'Content-Type': 'application/json' };
	if ( config.restNonce ) {
		headers[ 'X-WP-Nonce' ] = config.restNonce;
	}
	const request = trackedFetch(
		config.restUrl,
		{
			method: 'POST',
			headers,
			body: JSON.stringify( {
				reasons,
				details: details.slice( 0, DETAILS_MAX ),
				context: config.context,
			} ),
		},
		{ source: 'desktop-mode/deactivation-feedback', silent: true },
	).then(
		() => undefined,
		() => undefined,
	);
	let timer: ReturnType< typeof setTimeout > | undefined;
	const timeout = new Promise< void >( ( resolve ) => {
		timer = setTimeout( resolve, SEND_TIMEOUT_MS );
	} );
	await Promise.race( [ request, timeout ] );
	if ( timer !== undefined ) {
		clearTimeout( timer );
	}
}

export function askDeactivationFeedback( config: DeactivationFeedbackConfig ): Promise< void > {
	if ( open ) {
		return Promise.resolve();
	}
	open = true;
	const doc = document;
	ensureStylesheet( config.styleUrl, doc );

	const parts = buildDeactivationDialog( doc );
	const previouslyFocused = doc.activeElement as HTMLElement | null;

	return new Promise< void >( ( resolve ) => {
		let settled = false;
		const finish = (): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			doc.removeEventListener( 'keydown', onKeydown, true );
			parts.scrim.remove();
			open = false;
			previouslyFocused?.focus?.();
			resolve();
		};

		const onKeydown = ( event: KeyboardEvent ): void => {
			if ( event.key === 'Escape' ) {
				event.preventDefault();
				finish();
				return;
			}
			if ( event.key !== 'Tab' ) {
				return;
			}
			const focusable = Array.from( parts.scrim.querySelectorAll< HTMLElement >( FOCUSABLE ) );
			if ( focusable.length === 0 ) {
				return;
			}
			const first = focusable[ 0 ];
			const last = focusable[ focusable.length - 1 ];
			const active = doc.activeElement;
			if ( event.shiftKey && ( active === first || ! parts.scrim.contains( active ) ) ) {
				event.preventDefault();
				last.focus();
			} else if ( ! event.shiftKey && active === last ) {
				event.preventDefault();
				first.focus();
			}
		};

		parts.skip.addEventListener( 'click', finish );
		parts.form.addEventListener( 'submit', ( event ) => {
			event.preventDefault();
			const reasons = parts.reasons();
			if ( reasons.length === 0 || settled ) {
				return;
			}
			parts.send.disabled = true;
			parts.skip.disabled = true;
			parts.send.textContent = __( 'Sending…' );
			void postAnswer( config, reasons, parts.details.value ).then( finish, finish );
		} );

		doc.addEventListener( 'keydown', onKeydown, true );
		doc.body.appendChild( parts.scrim );
		parts.scrim.querySelector< HTMLElement >( 'input[name="reasons"]' )?.focus();
	} );
}

export interface InterceptDeps {

	navigate?: ( href: string ) => void;
	doc?: Document;
}

export function interceptPluginsScreen( config: DeactivationFeedbackConfig, deps: InterceptDeps = {} ): () => void {
	const doc = deps.doc ?? document;
	const win = doc.defaultView ?? window;
	const navigate = deps.navigate ?? ( ( href: string ) => win.location.assign( href ) );
	const plugin = config.plugin.replace( /["\\]/g, '\\$&' );
	const selector = `tr[data-plugin="${ plugin }"] .deactivate a[href]`;
	const onClick = ( event: MouseEvent ): void => {
		if ( event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ) {
			return;
		}
		const target = event.target as Element | null;
		const link = target?.closest?.< HTMLAnchorElement >( selector );
		if ( ! link ) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		const href = link.href;
		void askDeactivationFeedback( config ).then( () => navigate( href ) );
	};
	win.addEventListener( 'click', onClick, true );
	return () => win.removeEventListener( 'click', onClick, true );
}
