/**
 * The AI assistant overlay's chrome has to render through `wp.i18n`.
 *
 * Every string here was hardcoded English at some point, which made the
 * whole panel untranslatable — the strings never reached the POT, so no
 * locale could override them however complete its translation was. The
 * regression is silent: an untranslated literal renders perfectly in
 * English and looks correct to anyone reviewing in English.
 *
 * So these tests install a `wp.i18n` stub that returns a marked string
 * for every msgid and assert the marker reaches the DOM. A literal that
 * skips `__()` renders the English source instead and fails here.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { AiAssistant } from '../../src/ai-assistant/impl';
import type { AiAssistantConfig } from '../../src/ai-assistant/types';

const BASE_CONFIG: AiAssistantConfig = {
	aiSearchUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/search',
	aiSearchStreamUrl: '',
	restNonce: 'test-nonce',
	adminUrl: 'https://example.test/wp-admin/',
	isAiAvailable: () => false,
	isOverrideEnabled: () => false,
	getTransport: () => 'off',
};

/** Marker wrapped around every msgid so a missed `__()` is visible. */
function translate( text: string ): string {
	return `[es]${ text }`;
}

/**
 * Install a `wp.i18n` that translates everything, preserving the hooks
 * stub already living under `window.wp`.
 */
function stubI18n(): void {
	const existing = ( window as unknown as Record< string, unknown > ).wp ?? {};
	( window as unknown as Record< string, unknown > ).wp = {
		...existing,
		i18n: {
			__: ( text: string ) => translate( text ),
			_x: ( text: string ) => translate( text ),
			_n: ( single: string, plural: string, number: number ) =>
				translate( number === 1 ? single : plural ),
			_nx: ( single: string, plural: string, number: number ) =>
				translate( number === 1 ? single : plural ),
			sprintf: ( format: string, ...args: unknown[] ) => {
				let i = 0;
				return format.replace(
					/%(?:(\d+)\$)?[sd]/g,
					( _match, pos ) => {
						const idx = pos ? Number.parseInt( pos, 10 ) - 1 : i++;
						return String( args[ idx ] ?? '' );
					},
				);
			},
		},
	};
}

describe( 'AiAssistant — i18n', () => {
	let assistant: AiAssistant;

	beforeEach( () => {
		installHooksStub();
		stubI18n();
		assistant = new AiAssistant( BASE_CONFIG );
	} );

	afterEach( () => {
		if ( assistant && assistant.isOpen ) {
			assistant.close();
		}
		document.getElementById( 'desktop-mode-ai-assistant' )?.remove();
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'the panel chrome renders translated', () => {
		const el = document.getElementById( 'desktop-mode-ai-assistant' )!;

		expect( el.getAttribute( 'aria-label' ) ).toBe(
			translate( 'Site Assistant' ),
		);
		expect(
			el.querySelector( '.os-ai__header-label' )?.textContent?.trim(),
		).toBe( translate( 'Site Assistant' ) );
		expect(
			el.querySelector( '.os-ai__modes' )?.getAttribute( 'aria-label' ),
		).toBe( translate( 'Assistant mode' ) );
		expect(
			el.querySelector( '[data-mode="ai"]' )?.textContent?.trim(),
		).toBe( translate( 'Ask AI' ) );
		expect(
			el.querySelector( '[data-mode="commands"]' )?.textContent?.trim(),
		).toBe( translate( 'Commands' ) );
		expect(
			el.querySelector( '.os-ai__close' )?.getAttribute( 'aria-label' ),
		).toBe( translate( 'Close' ) );
		expect(
			el.querySelector( '.os-ai__submit' )?.getAttribute( 'aria-label' ),
		).toBe( translate( 'Send' ) );
		expect(
			el.querySelector( '.os-ai__footer-hint' )?.textContent?.trim(),
		).toBe(
			translate(
				'Your assistant to quickly navigate and manage your entire site.',
			),
		);
	} );

	test( 'the input placeholder and aria-label render translated', () => {
		const input = document.querySelector< HTMLInputElement >(
			'.os-ai__input',
		)!;

		expect( input.getAttribute( 'aria-label' ) ).toBe(
			translate( 'Ask the assistant' ),
		);
		// Commands is the default mode when AI is unavailable.
		assistant.open();
		expect( input.placeholder ).toBe( translate( 'Search commands…' ) );
	} );

	test( 'the empty-state message renders translated', () => {
		assistant.open();
		const input = document.querySelector< HTMLInputElement >(
			'.os-ai__input',
		)!;
		input.value = 'nothing-matches-this';
		input.dispatchEvent( new Event( 'input' ) );

		const empty = document.querySelector( '.os-ai__state--empty' );
		expect( empty?.textContent ).toContain(
			translate( 'No commands matching %s.' ).replace( ' %s.', '' ),
		);
		expect( empty?.querySelector( 'strong' )?.textContent ).toBe(
			'nothing-matches-this',
		);
	} );

	test( 'the unknown-command error renders translated', () => {
		assistant.open();
		const input = document.querySelector< HTMLInputElement >(
			'.os-ai__input',
		)!;
		input.value = '/definitely-not-a-command ';
		input.dispatchEvent( new Event( 'input' ) );
		input.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);

		const error = document.querySelector( '.os-ai__state--error' );
		expect( error?.textContent?.trim() ).toBe(
			'[es]Unknown command: /definitely-not-a-command',
		);
	} );
} );
