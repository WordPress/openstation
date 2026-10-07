import { __ } from '../i18n';
import { showToast } from '../toast';
import { trackedFetch } from '../tracked-fetch';
import type { DesktopConfig } from '../types';
import { showUsageFeedbackPrompt } from './loader';
import type { UsageFeedbackPromptOptions } from './types';

export const USAGE_FEEDBACK_INTRO_SLUG = 'usage-feedback';

const PROMPT_DELAY_MS = 4000;

export interface UsageFeedbackDeps {

	config: DesktopConfig;

	showPrompt?: ( opts: UsageFeedbackPromptOptions ) => Promise< boolean > | boolean;
}

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

	}
}

export async function maybeAskForUsageFeedback( deps: UsageFeedbackDeps ): Promise< void > {
	const { config } = deps;
	const request = config.usageFeedback;
	if ( ! request ) {
		return;
	}

	if ( config.seenIntros?.includes( USAGE_FEEDBACK_INTRO_SLUG ) ) {
		return;
	}
	const showPrompt = deps.showPrompt ?? showUsageFeedbackPrompt;

	await new Promise( ( resolve ) => window.setTimeout( resolve, PROMPT_DELAY_MS ) );

	const shown = await showPrompt( {
		restUrl: request.restUrl,
		restNonce: config.restNonce ?? '',
		onAnswered: ( outcome ) => {
			config.seenIntros = [ ...( config.seenIntros ?? [] ), USAGE_FEEDBACK_INTRO_SLUG ];
			if ( outcome === 'sent' ) {
				showToast( { message: __( 'Thank you! That really helps.' ) } );
				return;
			}
			void markSeen( config );
		},
	} );
	if ( ! shown && typeof console !== 'undefined' ) {
		console.warn( '[openstation] usage feedback prompt could not be shown.' );
	}
}
