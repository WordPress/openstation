/**
 * When the assistant is turned off, the overlay offers a link that opens
 * OpenStation Preferences on the tab that turns it back on.
 *
 * Which tab that is comes from the server, as `settings_tab` in the
 * error data. The client used to recover it by matching the tab path out
 * of the error message, so these cover the contract that replaced it:
 * the link follows the data, not the wording, and an error carrying no
 * hint gets no link.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { AiAssistant } from '../../src/ai-assistant/impl';
import type { AiAssistantConfig } from '../../src/ai-assistant/types';

const BASE_CONFIG: AiAssistantConfig = {
	aiSearchUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/search',
	restNonce: 'test-nonce',
	adminUrl: 'https://example.test/wp-admin/',
	isAiAvailable: () => false,
	isOverrideEnabled: () => false,
};

/** Stub the REST call with a non-ok response carrying `body`. */
function stubErrorResponse( status: number, body: unknown ): void {
	vi.stubGlobal(
		'fetch',
		vi.fn( () =>
			Promise.resolve( {
				ok: false,
				status,
				json: async () => body,
			} as Response ),
		),
	);
}

describe( 'AiAssistant — error recovery link', () => {
	let assistant: AiAssistant;
	const openOsSettings = vi.fn();

	beforeEach( () => {
		openOsSettings.mockClear();
		installHooksStub();
		const existing = ( window as unknown as Record< string, unknown > ).wp ?? {};
		( window as unknown as Record< string, unknown > ).wp = {
			...existing,
			os: { openOsSettings },
		};
		assistant = new AiAssistant( BASE_CONFIG );
	} );

	afterEach( () => {
		if ( assistant && assistant.isOpen ) {
			assistant.close();
		}
		document
			.querySelectorAll( '#desktop-mode-ai-assistant' )
			.forEach( ( el ) => el.remove() );
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'the link opens the tab the server named', async () => {
		// A message with none of the English wording the old regex looked
		// for — the hint alone has to be enough.
		stubErrorResponse( 403, {
			code: 'openstation_ai_disabled',
			message: 'El asistente de IA está desactivado.',
			data: { status: 403, settings_tab: 'features' },
		} );

		assistant.open();
		await assistant[ '_runSearchRequest' ]( 'hola', null, 0 );

		const link = document.querySelector< HTMLButtonElement >(
			'.os-ai__settings-link',
		);
		expect( link ).not.toBeNull();

		link!.click();
		expect( openOsSettings ).toHaveBeenCalledWith( { tabId: 'features' } );
	} );

	test( 'an error with no settings hint gets no link', async () => {
		stubErrorResponse( 500, { code: 'oops', message: 'Boom.' } );

		assistant.open();
		await assistant[ '_runSearchRequest' ]( 'hola', null, 0 );

		expect( document.querySelector( '.os-ai__settings-link' ) ).toBeNull();
		expect(
			document.querySelector( '.os-ai__state--error' )?.textContent?.trim(),
		).toBe( 'Boom.' );
	} );
} );
