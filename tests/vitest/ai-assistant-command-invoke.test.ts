/**
 * Picking a command in the palette, from real input events.
 *
 * Issue #705 was reported as "the palette lists third-party commands
 * and never invokes them": a row that highlighted, accepted Enter and
 * a click, and then did nothing — no error, no console line, no
 * network request. The two behaviours that made a real failure look
 * like nothing at all are pinned here:
 *
 *   - a command whose `run()` throws renders as a failure in the
 *     panel, rather than leaving the surface exactly as it was;
 *   - a row runs the command it was RENDERED from, not whatever has
 *     since slid into its index — the shell harvester republishes by
 *     dropping every `owner: 'global'` command and re-adding it,
 *     which reorders the registry under a list already on screen.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

import { AiAssistant } from '../../src/ai-assistant/impl';
import type { AiAssistantConfig } from '../../src/ai-assistant/types';
import {
	listCommands,
	registerCommand,
	unregisterCommand,
} from '../../src/commands';

const CONFIG: AiAssistantConfig = {
	aiSearchUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/search',
	restNonce: 'test-nonce',
	adminUrl: 'https://example.test/wp-admin/',
	// Commands mode only — the palette half of the assistant is what
	// #705 is about, and it is the surface every install has.
	isAiAvailable: () => false,
	isOverrideEnabled: () => false,
};

/** Drain the shared registry between tests. */
function clearRegistry(): void {
	for ( const cmd of listCommands() ) {
		unregisterCommand( cmd.slug );
	}
}

/** The palette input, once the overlay is mounted. */
function paletteInput(): HTMLInputElement {
	return document.querySelector< HTMLInputElement >(
		'#desktop-mode-ai-assistant .os-ai__input',
	)!;
}

/** Type into the palette the way a person does — value plus `input`. */
function typeQuery( query: string ): void {
	const input = paletteInput();
	input.value = query;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
}

/** The rendered command rows. */
function rows(): HTMLButtonElement[] {
	return Array.from(
		document.querySelectorAll< HTMLButtonElement >(
			'#desktop-mode-ai-assistant .os-ai__cmd-item',
		),
	);
}

/** The panel's results text, whitespace-collapsed. */
function resultsText(): string {
	return (
		document
			.querySelector( '#desktop-mode-ai-assistant .os-ai__results' )
			?.textContent?.replace( /\s+/g, ' ' )
			.trim() ?? ''
	);
}

describe( 'AiAssistant — picking a command', () => {
	let assistant: AiAssistant;

	beforeEach( () => {
		installHooksStub();
		vi.stubGlobal(
			'fetch',
			vi.fn( () =>
				Promise.resolve( {
					ok: true,
					status: 200,
					json: async () => [],
				} as unknown as Response ),
			),
		);
		clearRegistry();
	} );

	afterEach( () => {
		if ( assistant && assistant.isOpen ) {
			assistant.close();
		}
		document.getElementById( 'desktop-mode-ai-assistant' )?.remove();
		clearRegistry();
		clearHooksStub();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	test( 'Enter on the input runs the highlighted command', async () => {
		const run = vi.fn();
		registerCommand( { slug: 'plugin/goto-theme', label: 'SN: Theme', run } );

		assistant = new AiAssistant( CONFIG );
		assistant.open();
		typeQuery( 'SN: Theme' );
		expect( rows() ).toHaveLength( 1 );

		paletteInput().dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);

		await vi.waitFor( () => expect( run ).toHaveBeenCalled() );
	} );

	test( 'a command that throws renders a failure instead of nothing', async () => {
		registerCommand( {
			slug: 'plugin/broken',
			label: 'SN: Broken',
			run: () => {
				throw new Error( 'sntAbilityRun is not defined' );
			},
		} );

		assistant = new AiAssistant( CONFIG );
		assistant.open();
		typeQuery( 'SN: Broken' );

		paletteInput().dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);

		await vi.waitFor( () => {
			expect( resultsText() ).toContain( 'sntAbilityRun is not defined' );
		} );
	} );

	test( 'a clicked row runs the command it displays, through a republish', async () => {
		const alpha = vi.fn();
		const beta = vi.fn();
		// `owner: 'global'` mirrors the shell harvester's tag — the
		// republish below is exactly what that harvester does on every
		// `core/commands` tick whose fingerprint changed: drop every
		// global command, re-add it, moving the rest in insertion order.
		registerCommand( { slug: 'global/a', label: 'ZZZ Alpha', owner: 'global', run: alpha } );
		registerCommand( { slug: 'plugin/b', label: 'ZZZ Beta', run: beta } );

		assistant = new AiAssistant( CONFIG );
		assistant.open();
		typeQuery( 'ZZZ' );
		expect( rows()[ 0 ].textContent ).toContain( 'ZZZ Alpha' );

		unregisterCommand( 'global/a' );
		registerCommand( { slug: 'global/a', label: 'ZZZ Alpha', owner: 'global', run: alpha } );

		// Whatever the republish did to the order, the row on screen
		// and the command it runs are the same one.
		const [ topRow ] = rows();
		const topLabel = topRow.textContent ?? '';
		topRow.click();

		const expected = topLabel.includes( 'Alpha' ) ? alpha : beta;
		const other = expected === alpha ? beta : alpha;
		await vi.waitFor( () => expect( expected ).toHaveBeenCalled() );
		expect( other ).not.toHaveBeenCalled();
	} );
} );
