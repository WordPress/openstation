/**
 * Tests for AiAssistant entity search integration.
 *
 * Covers the gap between Classic Admin Mode's Cmd+K (which searches
 * posts/pages via REST) and Desktop Mode's command palette:
 *
 * - `_fetchRemoteCommands` only fires in Commands mode, never AI mode
 * - Entity results render as clickable items in the command list
 * - Clicking an entity result opens the editor via `windowManager`
 * - Stale responses are discarded by token-based guard
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { AiAssistant } from '../../src/ai-assistant/impl';
import type { AiAssistantConfig } from '../../src/ai-assistant/types';
import {
	registerCommand,
	listCommands,
	unregisterCommand,
} from '../../src/commands';

/**
 * Fixtures — mock data, config, and shared helpers.
 */

const WINDOW_MANAGER = { open: vi.fn() };
const DERIVE_WINDOW_ID = vi.fn( () => 'ai-entity-post-42' );

const BASE_CONFIG: AiAssistantConfig = {
	aiSearchUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/search',
	aiSearchStreamUrl: '',
	restNonce: 'test-nonce',
	adminUrl: 'https://example.test/wp-admin/',
	isAiAvailable: () => false,
	isOverrideEnabled: () => false,
	getTransport: () => 'off',
};

/**
 * REST search fixture — two posts, one page.
 */
const SEARCH_FIXTURE = [
	{ id: 1, title: 'Getting Started', subtype: 'post', url: 'https://example.test/getting-started/' },
	{ id: 2, title: 'Hello World', subtype: 'post', url: 'https://example.test/hello-world/' },
	{ id: 3, title: 'About Us', subtype: 'page', url: 'https://example.test/about/' },
];

/**
 * Helper: create a `window.fetch` stub that returns the given data
 * after a configurable delay (default 0 so tests control timing).
 */
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

/**
 * Helper: create a `window.fetch` stub that returns a non-ok response.
 */
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

/**
 * Register the shell globals the AI assistant depends on,
 * preserving any existing stubs (hooks, etc.) under `window.wp`.
 */
function stubShell(): void {
	const existing = ( window as unknown as Record< string, unknown > ).wp ?? {};
	( window as unknown as Record< string, unknown > ).wp = {
		...existing,
		desktop: {
			windowManager: WINDOW_MANAGER,
			deriveWindowId: DERIVE_WINDOW_ID,
		},
	};
}

/**
 * Drain the command registry between tests.
 */
function clearRegistry(): void {
	for ( const cmd of listCommands() ) {
		unregisterCommand( cmd.slug );
	}
}

/**
 * Suite — AiAssistant entity search integration.
 */

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

		/**
		 * Remove the assistant DOM from the document body.
		 */
		const el = document.getElementById( 'desktop-mode-ai-assistant' );
		if ( el ) {
			el.remove();
		}

		clearRegistry();
		clearHooksStub();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	/**
	 * _fetchRemoteCommands guard — Commands mode only.
	 */
	test( 'triggers REST search for plain text in Commands mode', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;
		expect( input ).toBeTruthy();
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		/**
		 * Wait for debounce (200 ms) + microtask.
		 */
		await vi.waitFor( () => {
			expect( window.fetch ).toHaveBeenCalled();
		}, { timeout: 500, interval: 50 } );
	} );

	test( 'skips REST search for slash-commands (parsed.isCommand)', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;
		input.value = '/help';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		/**
		 * Small delay to let any pending async work complete.
		 */
		await new Promise( ( r ) => setTimeout( r, 50 ) );
		expect( window.fetch ).not.toHaveBeenCalled();
	} );

	test( 'skips REST search for empty input', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
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

		/**
		 * The palette defaults to AI mode when override is on.
		 */
		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;
		input.value = 'How do I create a post?';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await new Promise( ( r ) => setTimeout( r, 50 ) );
		expect( window.fetch ).not.toHaveBeenCalled();
	} );

	/**
	 * Entity results render in Commands mode.
	 */

	test( 'renders entity result items after REST response', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		/**
		 * Wait for debounce + fetch + re-render. `expect` inside waitFor
		 * throws on failure so vitest keeps polling.
		 */
		await vi.waitFor( () => {
			const buttons = document.querySelectorAll(
				'#desktop-mode-ai-assistant .desktop-mode-ai__cmd-item',
			);
			expect( buttons.length ).toBeGreaterThanOrEqual( 3 );
		}, { timeout: 500, interval: 50 } );

		/**
		 * All three fixtures rendered with styling class.
		 */
		const entityItem = document.querySelector(
			'.desktop-mode-ai__cmd-item.is-entity-result',
		);
		expect( entityItem ).toBeTruthy();
	} );

	/**
	 * Click handler — opens editor via windowManager.
	 */
	test( 'clicking an entity result opens the edit window', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		/**
		 * Wait for entity results to render.
		 */
		await vi.waitFor( () => {
			const btn = document.querySelector(
				'#desktop-mode-ai-assistant .desktop-mode-ai__cmd-item',
			);
			expect( btn ).toBeTruthy();
		}, { timeout: 500, interval: 50 } );

		/**
		 * Click the first entity result.
		 */
		const firstItem = document.querySelector< HTMLButtonElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__cmd-item',
		)!;
		firstItem.click();

		/**
		 * `openInWindow` is called via `ctx.openInWindow` when the
		 * remote command's `run()` handler fires.
		 */
		expect( WINDOW_MANAGER.open ).toHaveBeenCalledWith(
			expect.objectContaining( {
				url: 'https://example.test/wp-admin/post.php?post=1&action=edit',
			} ),
		);
	} );

	/**
	 * Network errors silently swallowed.
	 */
	test( 'silently swallows non-ok REST response', async () => {
		stubFetchError();
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		/**
		 * Wait for debounce + fetch to complete.
		 */
		await vi.waitFor( () => {
			expect( window.fetch ).toHaveBeenCalled();
		}, { timeout: 500, interval: 50 } );

		/**
		 * After the failed fetch, no entity results should have rendered.
		 */
		const entityItems = document.querySelectorAll(
			'.desktop-mode-ai__cmd-item.is-entity-result',
		);
		expect( entityItems.length ).toBe( 0 );
	} );

	/**
	 * _isEntityResultCommand — identity check.
	 */
	test( 'marks remote commands with is-entity-result class', async () => {
		assistant = new AiAssistant( BASE_CONFIG );
		assistant.open();

		const input = document.querySelector< HTMLInputElement >(
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;
		input.value = 'hello';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			const entityItems = document.querySelectorAll(
				'#desktop-mode-ai-assistant .desktop-mode-ai__cmd-item.is-entity-result',
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
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;

		/**
		 * Empty input in Commands mode lists all commands (no entity
		 * results, but the registered command shows).
		 */
		input.value = '';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		await vi.waitFor( () => {
			expect(
				document.querySelector(
					'#desktop-mode-ai-assistant .desktop-mode-ai__cmd-item',
				),
			).toBeTruthy();
		}, { timeout: 500, interval: 50 } );

		/**
		 * The local command should NOT have the entity class.
		 */
		const localItem = document.querySelector(
			'.desktop-mode-ai__cmd-item:not(.is-entity-result)',
		);
		expect( localItem ).toBeTruthy();
		expect( localItem?.getAttribute( 'data-slug' ) ).toBe( 'test-command' );
	} );

	/**
	 * Token-based staleness guard.
	 */
	test( 'discards stale async results using token-based guard', async () => {
		const firstResponse = [ { id: 1, title: 'Stale Post', subtype: 'post', url: '' } ];
		const secondResponse = [ { id: 2, title: 'Fresh Post', subtype: 'post', url: '' } ];

		let callCount = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn( () => {
				callCount++;
				const data = callCount === 1 ? firstResponse : secondResponse;
				const delay = callCount === 1 ? 300 : 20; // First fetch is slow
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
			'#desktop-mode-ai-assistant .desktop-mode-ai__input',
		)!;

		// 1. Trigger first slow query
		input.value = 'stale';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		// Wait 250ms (passes first query's 200ms debounce; first fetch begins)
		await new Promise( ( r ) => setTimeout( r, 250 ) );

		// 2. Trigger second fast query
		input.value = 'fresh';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		// Wait for both fetch calls to be initiated
		await vi.waitFor( () => {
			expect( window.fetch ).toHaveBeenCalledTimes( 2 );
		}, { timeout: 1000, interval: 50 } );

		// Wait 400ms to let all fetches resolve and render cycles settle
		await new Promise( ( r ) => setTimeout( r, 400 ) );

		// Verify only the 'Fresh Post' remains in the list, and 'Stale Post' is discarded
		const items = document.querySelectorAll(
			'#desktop-mode-ai-assistant .desktop-mode-ai__cmd-item',
		);
		expect( items.length ).toBe( 1 );
		expect( items[ 0 ].textContent ).toContain( 'Fresh Post' );
		expect( items[ 0 ].textContent ).not.toContain( 'Stale Post' );
	} );
} );
