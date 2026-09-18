/**
 * Deactivation feedback — one optional question before OpenStation is
 * deactivated.
 *
 * Three surfaces show it: the classic `plugins.php`, the same page
 * inside a chromeless window, and the native Plugins app. The first
 * two have no `<os-*>` kit (the classic screen loads none of the
 * shell), so this is plain classed DOM under `.os-deactivation-feedback`
 * with styles in `assets/css/deactivation-feedback.css`. One renderer
 * that works everywhere beats two; this is the deliberate exception to
 * the "use os-* components" rule, for the same reason
 * `includes/welcome-dialog.php` gives.
 *
 * Nothing is sent unless the admin clicks Send. Both buttons resolve
 * the promise, and the caller deactivates either way — a failed or
 * slow send never keeps anyone on the page.
 *
 * Nothing here is stored on the site: the answer goes to the REST
 * route, which forwards it and forgets it.
 */

import { __ } from '../i18n';
import { trackedFetch } from '../tracked-fetch';

export type DeactivationFeedbackContext = 'classic' | 'chromeless' | 'app';

export interface DeactivationFeedbackConfig {
	/** `plugin_basename()` of OpenStation — the row the interceptor watches. */
	plugin: string;
	/** `POST /desktop-mode/v1/feedback/deactivation`. */
	restUrl: string;
	/**
	 * The REST nonce. Empty in-shell: `wp.os.fetch` injects the live
	 * one, and a snapshot from the app config goes stale after a
	 * nonce refresh.
	 */
	restNonce: string;
	context: DeactivationFeedbackContext;
	/**
	 * The dialog stylesheet, for the lazy in-shell path where nothing
	 * enqueued it. Injected once when the document lacks it.
	 */
	styleUrl?: string;
}

export interface DeactivationFeedbackApi {
	/** Opens the dialog; resolves when the user picks either button. Sends only on "Send". */
	ask: ( config: DeactivationFeedbackConfig ) => Promise< void >;
}

/** The reasons offered, in display order; the slugs are the route's enum. */
export const REASONS: ReadonlyArray< { value: string; label: () => string } > = [
	{ value: 'changed_too_much', label: () => __( 'It changed WordPress too much' ) },
	{ value: 'missing_features', label: () => __( 'I\u2019m missing features I need' ) },
	{ value: 'too_buggy', label: () => __( 'It\u2019s too buggy or unstable' ) },
	{ value: 'other', label: () => __( 'Other' ) },
];

/** Longest free text sent; the server truncates to the same length. */
export const DETAILS_MAX = 1000;

/** How long Send waits for the route before deactivating anyway. */
export const SEND_TIMEOUT_MS = 4000;

/** The id WordPress gives the enqueued stylesheet's `<link>`. */
const STYLE_ELEMENT_ID = 'os-deactivation-feedback-css';

/** Everything inside the card that can take focus, in tab order. */
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
	/** The reasons to send: the ticked ones in display order, or "other" when only details were typed. */
	reasons: () => string[];
}

/** Build the scrim + card. Exported so a test can read the markup. */
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

	const details = doc.createElement( 'textarea' );
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
	// Nothing to send until a reason is ticked or details are typed.
	send.disabled = true;
	actions.appendChild( send );

	const ticked = (): string[] =>
		Array.from( card.querySelectorAll< HTMLInputElement >( 'input[name="reasons"]:checked' ) ).map( ( i ) => i.value );

	// The route requires at least one reason. Details typed with no
	// box ticked are still an answer, so they go out as "Other".
	const reasons = (): string[] => {
		const picked = ticked();
		return picked.length === 0 && details.value.trim() !== '' ? [ 'other' ] : picked;
	};

	const refresh = (): void => {
		const picked = ticked();
		send.disabled = picked.length === 0 && details.value.trim() === '';
		// Steer the free text toward what would let us act on it.
		if ( picked.includes( 'too_buggy' ) ) {
			details.placeholder = __( 'Which page or plugin?' );
		} else if ( picked.includes( 'missing_features' ) ) {
			details.placeholder = __( 'Which features?' );
		} else {
			details.placeholder = __( 'Anything else? (optional)' );
		}
	};
	card.addEventListener( 'change', refresh );
	details.addEventListener( 'input', refresh );

	return { scrim, form: card, details, skip, send, reasons };
}

/** POST the answer; resolves whatever happens, within the timeout. */
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

/**
 * Open the dialog and resolve when the user picks either button.
 * Sends only on "Send", and only with a reason ticked or details typed.
 * A second call while one is open resolves immediately.
 */
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
	/** Where the Deactivate link goes once the dialog is done. */
	navigate?: ( href: string ) => void;
	doc?: Document;
}

/**
 * Classic / chromeless `plugins.php`: intercept the Deactivate link
 * on OpenStation's own row, ask, then follow the link. Bulk
 * deactivation with OpenStation checked is left alone.
 *
 * Delegated from `window` in the capture phase, not bound to the
 * anchor: Gutenberg's client-side admin router (and any plugin doing
 * the same) claims admin link clicks at the document level with
 * `preventDefault()` and navigates itself, so a listener on the
 * anchor sees `defaultPrevented` already set and the page is gone
 * before the dialog could open. Capture on `window` runs before any
 * of that, and `stopImmediatePropagation()` keeps the routers out.
 *
 * @return A function that removes the listener again.
 */
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
