/**
 * Usage feedback — the form.
 *
 * Three optional questions and an optional email, in an `<os-modal>`.
 * Opened only after the user said yes to the prompt card
 * (`prompt.ts`), and compiled into the lazy `usage-feedback` bundle
 * with it (`entry.ts`).
 *
 * Nothing leaves the site until the user clicks Send, and then only
 * what they typed, to the plugin's own REST route, which forwards it
 * (`includes/feedback/usage.php`). The email field starts empty and is
 * never prefilled: feedback is anonymous unless its author decides
 * otherwise.
 *
 * Every way out reports through `onClose` exactly once: `sent` after
 * the route accepted the answers, `dismissed` for Cancel, Escape, the
 * backdrop and the close button. The caller owns what that means.
 */

import { restErrorFromResponse } from '../core/api-client';
import { describeRestFailure } from '../core/rest-failure';
import { __ } from '../i18n';
import { trackedFetch } from '../tracked-fetch';
import '../ui/components/os-modal/os-modal';
import '../ui/components/os-textarea/os-textarea';
import '../ui/components/os-text-field/os-text-field';
import '../ui/components/os-button/os-button';
import type { UsageFeedbackFormOptions } from './types';

/** Longest answer sent; the server truncates to the same length. */
export const ANSWER_MAX = 1000;

/** The questions, in display order; the keys are the route's args. */
export const QUESTIONS: ReadonlyArray< { key: 'requests' | 'use_case' | 'blockers'; label: () => string } > = [
	{ key: 'requests', label: () => __( 'What can we do for you?' ) },
	{ key: 'use_case', label: () => __( 'What do you mainly use OpenStation for?' ) },
	{ key: 'blockers', label: () => __( 'What gets in your way, or what is missing?' ) },
];

/**
 * Good enough for "did they type an address": the server validates
 * for real and answers 400 otherwise.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOTE_STYLE = 'margin:0;opacity:0.75;font-size:13px;line-height:1.45;';

let open = false;

/** Open the form. A second call while one is open is ignored. */
export function openUsageFeedbackForm( opts: UsageFeedbackFormOptions ): void {
	if ( open ) {
		return;
	}
	open = true;

	const values: Record< string, string > = { requests: '', use_case: '', blockers: '', email: '' };

	const modal = document.createElement( 'os-modal' );
	modal.className = 'os-usage-feedback';
	modal.setAttribute( 'open', '' );
	modal.setAttribute( 'size', 'md' );
	modal.setAttribute( 'title', __( 'How is OpenStation going?' ) );

	const body = document.createElement( 'div' );
	body.className = 'os-usage-feedback__body';
	body.style.cssText = 'display:flex;flex-direction:column;gap:14px;';
	modal.appendChild( body );

	const intro = document.createElement( 'p' );
	intro.style.margin = '0';
	intro.textContent = __( 'Answer whichever you like. Every question is optional, and short is fine.' );
	body.appendChild( intro );

	const error = document.createElement( 'p' );
	error.className = 'os-usage-feedback__error';
	error.setAttribute( 'role', 'alert' );
	error.hidden = true;
	error.style.cssText = 'margin:0;color:var( --os-ui-danger, #d63638 );font-size:13px;';

	const clearError = (): void => {
		error.hidden = true;
	};

	for ( const question of QUESTIONS ) {
		const area = document.createElement( 'os-textarea' );
		area.setAttribute( 'label', question.label() );
		area.setAttribute( 'name', question.key );
		area.setAttribute( 'rows', '2' );
		area.setAttribute( 'auto-grow', '' );
		area.setAttribute( 'maxlength', String( ANSWER_MAX ) );
		area.addEventListener( 'os-input-change', ( e: Event ) => {
			values[ question.key ] = String( ( e as CustomEvent< { value: string } > ).detail?.value ?? '' );
			clearError();
		} );
		body.appendChild( area );
	}

	const email = document.createElement( 'os-text-field' );
	email.setAttribute( 'label', __( 'Email (optional)' ) );
	email.setAttribute( 'type', 'email' );
	email.setAttribute( 'name', 'email' );
	email.setAttribute( 'autocomplete', 'email' );
	email.setAttribute( 'maxlength', '254' );
	email.addEventListener( 'os-input-change', ( e: Event ) => {
		values.email = String( ( e as CustomEvent< { value: string } > ).detail?.value ?? '' );
		email.removeAttribute( 'invalid' );
		clearError();
	} );
	body.appendChild( email );

	const follow = document.createElement( 'p' );
	follow.className = 'os-usage-feedback__follow-up';
	follow.style.cssText = NOTE_STYLE;
	follow.textContent = __(
		'Leave your email if you are happy for us to follow up with a question or two. We like to thank people who help us.',
	);
	body.appendChild( follow );

	body.appendChild( error );

	const disclosure = document.createElement( 'p' );
	disclosure.className = 'os-usage-feedback__disclosure';
	disclosure.style.cssText = NOTE_STYLE;
	disclosure.textContent = __(
		'Nothing is sent until you click Send. Then your answers, your language, the OpenStation and WordPress versions, and how many days you have had OpenStation on go to openstation.blog, the plugin’s own site, run by Automattic. Without an email, nothing identifies you or your site.',
	);
	body.appendChild( disclosure );

	const footer = document.createElement( 'div' );
	footer.setAttribute( 'slot', 'footer' );
	footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;';
	modal.appendChild( footer );

	const cancel = document.createElement( 'os-button' );
	cancel.setAttribute( 'variant', 'secondary' );
	cancel.dataset.usageFeedbackCancel = '';
	cancel.textContent = __( 'Cancel' );
	footer.appendChild( cancel );

	const send = document.createElement( 'os-button' );
	send.setAttribute( 'variant', 'primary' );
	send.dataset.usageFeedbackSend = '';
	send.textContent = __( 'Send' );
	footer.appendChild( send );

	const answers = (): Record< string, string > => ( {
		requests: values.requests.trim(),
		use_case: values.use_case.trim(),
		blockers: values.blockers.trim(),
	} );
	const hasText = (): boolean => Object.values( values ).some( ( v ) => v.trim() !== '' );

	let closed = false;
	const close = ( outcome: 'sent' | 'dismissed' ): void => {
		if ( closed ) {
			return;
		}
		closed = true;
		open = false;
		modal.remove();
		opts.onClose( outcome );
	};

	const fail = ( message: string ): void => {
		error.textContent = message;
		error.hidden = false;
		send.removeAttribute( 'busy' );
		send.removeAttribute( 'disabled' );
	};

	cancel.addEventListener( 'click', () => close( 'dismissed' ) );

	// Escape, the backdrop and the close button all arrive here. A
	// stray Escape should not throw away what someone just typed, so
	// the first attempt with unsent text keeps the form open and says
	// so; the second one means it.
	let warned = false;
	modal.addEventListener( 'os-modal-cancel', ( e: Event ) => {
		if ( hasText() && ! warned ) {
			warned = true;
			e.preventDefault();
			fail( __( 'You have unsent answers. Close again to discard them.' ) );
			return;
		}
		close( 'dismissed' );
	} );

	const submit = async (): Promise< void > => {
		if ( closed ) {
			return;
		}
		const payload = answers();
		if ( Object.values( payload ).every( ( v ) => v === '' ) ) {
			fail( __( 'Answer at least one question first.' ) );
			return;
		}
		const address = values.email.trim();
		if ( address !== '' && ! EMAIL_SHAPE.test( address ) ) {
			email.setAttribute( 'invalid', '' );
			fail( __( 'That does not look like an email address. Fix it, or leave the field empty.' ) );
			return;
		}
		clearError();
		send.setAttribute( 'busy', '' );
		send.setAttribute( 'disabled', '' );
		// What went wrong, if anything: a `RestError` for a reply that
		// was not a success, whatever `fetch` threw when no reply came.
		let failure: unknown = null;
		try {
			const res = await trackedFetch(
				opts.restUrl,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': opts.restNonce,
					},
					body: JSON.stringify( { ...payload, email: address } ),
				},
				{ source: 'desktop-mode/usage-feedback' },
			);
			if ( ! res.ok ) {
				failure = await restErrorFromResponse( res );
			}
		} catch ( err ) {
			failure = err;
		}
		if ( failure !== null ) {
			// Say why: the server's own message for a refusal, the
			// offline or expired-session line when that is the cause.
			fail(
				describeRestFailure( failure, {
					fallback: __( 'We could not send that right now. Please try again in a moment.' ),
				} ).message,
			);
			return;
		}
		close( 'sent' );
	};
	send.addEventListener( 'click', () => void submit() );
	email.addEventListener( 'os-submit', () => void submit() );

	document.body.appendChild( modal );
}
