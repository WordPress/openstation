import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { AiAssistant } from '../../src/ai-assistant/impl';
import type { AiAssistantConfig } from '../../src/ai-assistant/types';
import {
	registerCommand,
	listCommands,
	unregisterCommand,
} from '../../src/commands';

const WINDOW_MANAGER = { open: vi.fn() };
const DERIVE_WINDOW_ID = vi.fn( () => 'ai-entity-post-42' );

const BASE_CONFIG: AiAssistantConfig = {
	aiSearchUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/search',
	restNonce: 'test-nonce',
	adminUrl: 'https://example.test/wp-admin/',
	isAiAvailable: () => false,
	isOverrideEnabled: () => false,
};

const SEARCH_FIXTURE = [
	{ id: 1, title: 'Getting Started', subtype: 'post', url: 'https://example.test/getting-started/' },
	{ id: 2, title: 'Hello World', subtype: 'post', url: 'https://example.test/hello-world/' },
	{ id: 3, title: 'About Us', subtype: 'page', url: 'https://example.test/about/' },
];

function stubFetch( data: unknown, delay = 0 ): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			() =>
				new Promise< Response >( ( resolve ) =>
					setTimeout( () => {
						resolve( {
							ok: true,
							status: 200,
							json: async () => data,
						} as Response );
					}, delay ),
				),
		),
	);
}

function stubFetchError(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			() =>
				Promise.resolve( {
					ok: false,
					status: 500,
				} as Response ),
		),
	);
}

function stubShell(): void {
	const existing = ( window as unknown as Record< string, unknown > ).wp ?? {};
	( window as unknown as Record< string, unknown > ).wp = {
		...existing,
		os: {
			windowManager: WINDOW_MANAGER,
			deriveWindowId: DERIVE_WINDOW_ID,
		},
	};
}

function clearRegistry(): void {
	for ( const cmd of listCommands() ) {
		unregisterCommand( cmd.slug );
	}
}

describe( 'AiAssistant — entity search', () => {
	let assistant: AiAssistant;

	beforeEach( () => {
		WINDOW_MANAGER.open.mockClear();
		installHooksStub();
		stubShell();
		stubFetch( SEARCH_FIXTURE );
		clearRegistry();
	} );

	afterEach( () => {
		if ( assistant && assistant.isOpen ) {
			assistant.close();
		}

		const el = document.getElementById( 'desktop-mode-ai-assistant' );
		if ( el ) {
			el.remove();
		}

		clearRegistry();
		clearHooksStub();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	test( 'triggers REST search for plain text in Commands mode', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		expect( input ).toBeTruthy();
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			expect( window.fetch ).toHaveBeenCalled();
		}, { timeout: 500, interval: 50 } );
	} );

	test( 'skips REST search for slash-commands (parsed.isCommand)', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = '/help';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await new Promise( ( r ) => setTimeout( r, 50 ) );
		expect( window.fetch ).not.toHaveBeenCalled();
	} );

	test( 'skips REST search for empty input', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = '';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await new Promise( ( r ) => setTimeout( r, 50 ) );
		expect( window.fetch ).not.toHaveBeenCalled();
	} );

	test( 'does NOT fire REST search in AI mode', async () => {
		const config: AiAssistantConfig = {
			...BASE_CONFIG,
			isAiAvailable: () => true,
			isOverrideEnabled: () => true,
		};
		assistant = new AiAssistant( config );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = 'How do I create a post?';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await new Promise( ( r ) => setTimeout( r, 50 ) );
		expect( window.fetch ).not.toHaveBeenCalled();
	} );

	test( 'renders entity result items after REST response', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			const buttons = document.querySelectorAll(
				'#desktop-mode-ai-assistant .os-ai__cmd-item',
			);
			expect( buttons.length ).toBeGreaterThanOrEqual( 3 );
		}, { timeout: 500, interval: 50 } );

		const entityItem = document.querySelector(
			'.os-ai__cmd-item.is-entity-result',
		);
		expect( entityItem ).toBeTruthy();
	} );

	test( 'clicking an entity result opens the edit window', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			const btn = document.querySelector(
				'#desktop-mode-ai-assistant .os-ai__cmd-item',
			);
			expect( btn ).toBeTruthy();
		}, { timeout: 500, interval: 50 } );

		const firstItem = document.querySelector< HTMLButtonElement >(
			'#desktop-mode-ai-assistant .os-ai__cmd-item',
		)!;
		firstItem.click();

		expect( WINDOW_MANAGER.open ).toHaveBeenCalledWith(
			expect.objectContaining( {
				url: 'https://example.test/wp-admin/post.php?post=1&action=edit',
			} ),
		);
	} );

	test( 'a post the user cannot edit reads View post and opens its permalink', async () => {
		stubFetch( [
			{
				...SEARCH_FIXTURE[ 1 ],
				_embedded: { self: [ { _links: { self: [ { targetHints: { allow: [ 'GET' ] } } ] } } ] },
			},
		] );
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		let item: HTMLButtonElement | null = null;
		await vi.waitFor( () => {
			item = document.querySelector< HTMLButtonElement >(
				'#desktop-mode-ai-assistant .os-ai__cmd-item.is-entity-result',
			);
			expect( item ).toBeTruthy();
		}, { timeout: 500, interval: 50 } );

		expect( item!.querySelector( '.os-ai__cmd-desc' )?.textContent ).toBe( 'View post' );
		item!.click();
		expect( WINDOW_MANAGER.open ).toHaveBeenCalledWith(
			expect.objectContaining( { url: 'https://example.test/hello-world/' } ),
		);
	} );

	test( 'silently swallows non-ok REST response', async () => {
		stubFetchError();
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			expect( window.fetch ).toHaveBeenCalled();
		}, { timeout: 500, interval: 50 } );

		const entityItems = document.querySelectorAll(
			'.os-ai__cmd-item.is-entity-result',
		);
		expect( entityItems.length ).toBe( 0 );
	} );

	test( 'marks remote commands with is-entity-result class', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			const entityItems = document.querySelectorAll(
				'#desktop-mode-ai-assistant .os-ai__cmd-item.is-entity-result',
			);
			expect( entityItems.length ).toBe( SEARCH_FIXTURE.length );
		}, { timeout: 500, interval: 50 } );
	} );

	test( 'local commands do NOT get is-entity-result class', async () => {
		registerCommand( {
			slug: 'test-command',
			label: 'Test',
			run: () => void 0,
		} );

		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;

		input.value = '';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			expect(
				document.querySelector(
					'#desktop-mode-ai-assistant .os-ai__cmd-item',
				),
			).toBeTruthy();
		}, { timeout: 500, interval: 50 } );

		const localItem = document.querySelector(
			'.os-ai__cmd-item:not(.is-entity-result)',
		);
		expect( localItem ).toBeTruthy();
		expect( localItem?.getAttribute( 'data-slug' ) ).toBe( 'test-command' );
	} );

	test( 'discards stale async results using token-based guard', async () => {
		const firstResponse = [ { id: 1, title: 'Stale Post', subtype: 'post', url: '' } ];
		const secondResponse = [ { id: 2, title: 'Fresh Post', subtype: 'post', url: '' } ];

		let callCount = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn( () => {
				callCount++;
				const data = callCount === 1 ? firstResponse : secondResponse;
				const delay = callCount === 1 ? 300 : 20;
				return new Promise< Response >( ( resolve ) =>
					setTimeout( () => {
						resolve( {
							ok: true,
							status: 200,
							json: async () => data,
						} as Response );
					}, delay ),
				);
			} ),
		);

		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .os-ai__input',
		)!;

		input.value = 'stale';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await new Promise( ( r ) => setTimeout( r, 250 ) );

		input.value = 'fresh';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			expect( window.fetch ).toHaveBeenCalledTimes( 2 );
		}, { timeout: 1000, interval: 50 } );

		await new Promise( ( r ) => setTimeout( r, 400 ) );

		const items = document.querySelectorAll(
			'#desktop-mode-ai-assistant .os-ai__cmd-item',
		);
		expect( items.length ).toBe( 1 );
		expect( items[ 0 ].textContent ).toContain( 'Fresh Post' );
		expect( items[ 0 ].textContent ).not.toContain( 'Stale Post' );
	} );
} );
