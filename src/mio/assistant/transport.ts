/** Same-origin, nonce-authenticated transport. No conversation persistence. */
import { assertMioRequestBudget } from './budget';
import { trackedFetch } from '../../tracked-fetch';
import type { MioTransport, MioTurn } from './types';

export function createMioTransport( windowId: string ): MioTransport {
	return async ( request, signal ) => {
		assertMioRequestBudget( request );
		const config = window.wp?.os?.config;
		if ( ! config?.aiSearchUrl || ! config.restNonce ) {
			throw new Error(
				'Enable the AI assistant in Preferences → Features and connect a provider.',
			);
		}
		const url = config.aiSearchUrl.replace( /\/ai\/search(?=\?|$)/, '/mio/turn' );
		if ( url === config.aiSearchUrl ) {
			throw new Error( 'MIO transport URL is unavailable.' );
		}
		const response = await trackedFetch(
			url,
			{
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				signal,
				headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.restNonce },
				body: JSON.stringify( request ),
			},
			{ windowId, source: 'mio/window' },
		);
		const payload = await response.json();
		if ( ! response.ok ) {
			throw new Error( payload.message || 'MIO could not reach the AI provider.' );
		}
		return payload as MioTurn;
	};
}
