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

	test( 'closing the panel drops the in-flight answer', async () => {

		let release: ( v: Response ) => void = () => {};
		vi.stubGlobal(
			'fetch',
			vi.fn(
				( _url: string, init?: RequestInit ) =>
					new Promise< Response >( ( resolve, reject ) => {
						init?.signal?.addEventListener( 'abort', () =>
							reject( new DOMException( 'aborted', 'AbortError' ) ),
						);
						release = resolve;
					} ),
			),
		);

		assistant.open();
		const pending = assistant[ '_runSearchRequest' ]( 'hola', null, 0 );

		assistant.close();
		release( {
			ok: true,
			status: 200,
			json: async () => ( {
				answer_type: 'chat',
				message: 'Answer that arrived too late.',
				entity: null,
				admin_links: null,
			} ),
		} as Response );
		await pending;

		const res = document.querySelector( '.os-ai__results' )!;
		expect( res.textContent ).not.toContain( 'Answer that arrived too late.' );
	} );

	test( 'Ask AI is offered before AI is set up, and Enter opens the setup tab', () => {
		document.getElementById( 'desktop-mode-ai-assistant' )?.remove();
		assistant = new AiAssistant( { ...BASE_CONFIG, isAiSupported: () => true } );
		assistant.open();

		const aiMode = document.querySelector< HTMLButtonElement >(
			'.os-ai__mode[data-mode="ai"]',
		)!;
		expect( aiMode.getAttribute( 'aria-pressed' ) ).toBe( 'false' );

		aiMode.click();
		const input = document.querySelector< HTMLInputElement >( '.os-ai__input' )!;
		expect( input.readOnly ).toBe( true );
		expect( document.querySelector( '.os-ai__settings-link' ) ).not.toBeNull();

		input.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ) );
		expect( openOsSettings ).toHaveBeenCalledWith( { tabId: 'features' } );
	} );

	test( 'Ask AI sends a user who cannot connect a provider to an administrator', () => {
		document.getElementById( 'desktop-mode-ai-assistant' )?.remove();
		assistant = new AiAssistant( {
			...BASE_CONFIG,
			isAiSupported: () => true,
			canConnectProvider: () => false,
		} );
		assistant.open();
		document.querySelector< HTMLButtonElement >( '.os-ai__mode[data-mode="ai"]' )!.click();

		expect( document.querySelector( '.os-ai__settings-link' ) ).toBeNull();
		expect( document.getElementById( 'os-ai-setup-message' )?.textContent ).toContain(
			'administrator',
		);

		const input = document.querySelector< HTMLInputElement >( '.os-ai__input' )!;
		input.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ) );
		expect( openOsSettings ).not.toHaveBeenCalled();
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

describe( 'AiAssistant — admin link icons', () => {
	let assistant: AiAssistant;

	beforeEach( () => {
		installHooksStub();
		assistant = new AiAssistant( BASE_CONFIG );
	} );

	afterEach( () => {
		assistant.close();
		document
			.querySelectorAll( '#desktop-mode-ai-assistant' )
			.forEach( ( el ) => el.remove() );
		clearHooksStub();
	} );

	test( 'paints a WordPress.org plugin icon and fetches no other URL', () => {
		const pluginIcon = 'https://ps.w.org/wordpress-seo/assets/icon-128x128.gif?rev=3419908';
		const link = { url: 'https://example.test/wp-admin/', description: '' };

		assistant.open();
		assistant[ '_showResult' ]( 'seo', {
			answer_type: 'navigation',
			message: 'Some SEO plugins.',
			entity: null,
			admin_links: [
				{ ...link, title: 'Yoast SEO', icon: pluginIcon },
				{ ...link, title: 'Elsewhere', icon: 'https://attacker.example/i.png?d=secret' },
				{ ...link, title: 'Plugins', icon: 'dashicons-admin-plugins' },
			],
			iterations: 2,
			exhausted: false,
			continue: null,
		} );

		const icons = document.querySelectorAll( '.os-ai__admin-link-icon' );
		expect( icons[ 0 ].getAttribute( 'src' ) ).toBe( pluginIcon );
		expect( document.querySelector( '[src*="attacker.example"]' ) ).toBeNull();
		expect( icons[ 1 ].classList.contains( 'dashicons-admin-generic' ) ).toBe( true );
		expect( icons[ 2 ].classList.contains( 'dashicons-admin-plugins' ) ).toBe( true );
	} );
} );
