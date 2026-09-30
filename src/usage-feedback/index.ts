/**
 * Usage feedback — the prompt (main-bundle side).
 *
 * Once a user has had OpenStation on for a while, ask whether they
 * have two minutes to say how it is going. The ask is a toast in the
 * corner, not a dialog: it interrupts nothing, and the form behind it
 * only opens for someone who said yes.
 *
 * Everything that decides WHO sees this is server-side and arrives as
 * `config.usageFeedback`: the feature is on, the user has had
 * OpenStation on for long enough by the `openstation_enabled_at`
 * stamp, and they have not answered or dismissed it
 * (`includes/feedback/usage.php`).
 *
 * Once per user, whatever they answer:
 *
 * - Closing the toast is a no, recorded as the `usage-feedback` slug
 *   in the seen-intros registry.
 * - "Sure" opens the form (`form.ts`, a lazy bundle fetched through
 *   `loader.ts`). Leaving it without sending is recorded the same
 *   way; a successful send is recorded server-side in the same
 *   request, so a lost client write can never re-ask someone who
 *   answered.
 * - A toast that is simply ignored records nothing and returns on
 *   the next boot: the user has not answered yet.
 */

import { __ } from '../i18n';
import { showToast } from '../toast';
import { trackedFetch } from '../tracked-fetch';
import type { DesktopConfig } from '../types';
import { openUsageFeedbackForm } from './loader';
import type { UsageFeedbackFormOptions } from './types';

/** Slug this prompt records in the seen-intros registry. */
export const USAGE_FEEDBACK_INTRO_SLUG = 'usage-feedback';

/**
 * Delay before the prompt appears, in ms. Long enough for the desk
 * and its restored windows to settle, so the question arrives while
 * the user is looking at what they are being asked about rather than
 * at a page still assembling itself.
 */
const PROMPT_DELAY_MS = 4000;

export interface UsageFeedbackDeps {
	/** The shell config, for the gate, the REST base and the nonce. */
	config: DesktopConfig;
	/**
	 * Opens the form; resolves `false` when it could not be shown.
	 * Defaults to the lazy-bundle loader. A test passes the form
	 * directly.
	 */
	openForm?: ( opts: UsageFeedbackFormOptions ) => Promise< boolean > | boolean;
}

/**
 * Record the answer so the prompt does not return. Fire-and-forget
 * and silent on failure: the cost of a lost write is being asked once
 * more.
 */
async function markSeen( config: DesktopConfig ): Promise< void > {
	const base = config.seenIntrosUrl;
	if ( ! base ) {
		return;
	}
	try {
		await trackedFetch(
			`${ base.replace( /\/$/, '' ) }/seen`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.restNonce ?? '',
				},
				body: JSON.stringify( { slug: USAGE_FEEDBACK_INTRO_SLUG } ),
			},
			{ source: 'desktop-mode/usage-feedback', silent: true },
		);
	} catch {
		// Nothing useful to tell the user here.
	}
}

/**
 * Show the prompt if this user is owed it.
 *
 * Fire-and-forget from boot. Resolves either way; a shell whose PHP
 * predates `usageFeedback` simply never asks.
 */
export async function maybeAskForUsageFeedback( deps: UsageFeedbackDeps ): Promise< void > {
	const { config } = deps;
	const request = config.usageFeedback;
	if ( ! request ) {
		return;
	}
	// Belt and braces against a stale config: the server already
	// excludes users who answered, but the same boot payload is what a
	// session restore replays.
	if ( config.seenIntros?.includes( USAGE_FEEDBACK_INTRO_SLUG ) ) {
		return;
	}
	const openForm = deps.openForm ?? openUsageFeedbackForm;

	await new Promise( ( resolve ) => window.setTimeout( resolve, PROMPT_DELAY_MS ) );

	const remember = (): void => {
		config.seenIntros = [ ...( config.seenIntros ?? [] ), USAGE_FEEDBACK_INTRO_SLUG ];
	};

	const accept = async (): Promise< void > => {
		const shown = await openForm( {
			restUrl: request.restUrl,
			restNonce: config.restNonce ?? '',
			onClose: ( outcome ) => {
				remember();
				if ( outcome === 'sent' ) {
					// The server recorded the intro in the same request.
					showToast( { message: __( 'Thank you! That really helps.' ) } );
					return;
				}
				void markSeen( config );
			},
		} );
		if ( ! shown && typeof console !== 'undefined' ) {
			// Nothing recorded: the user said yes and never saw the
			// form, so the prompt returns on the next boot.
			console.warn( '[openstation] usage feedback form could not be opened.' );
		}
	};

	showToast( {
		message: __( 'Got two minutes to tell us how OpenStation is going?' ),
		action: {
			label: __( 'Sure' ),
			onClick: () => void accept(),
		},
		persistent: true,
		dismissible: true,
		onDismiss: () => {
			remember();
			void markSeen( config );
		},
	} );
}
