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

	isAiAvailable: () => false,
	isOverrideEnabled: () => false,
};

function clearRegistry(): void {
	for ( const cmd of listCommands() ) {
		unregisterCommand( cmd.slug );
	}
}

function paletteInput(): HTMLInputElement {
	return document.querySelector< HTMLInputElement >(
		'#desktop-mode-ai-assistant .os-ai__input',
	)!;
}

function typeQuery( query: string ): void {
	const input = paletteInput();
	input.value = query;
	input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
}

function rows(): HTMLButtonElement[] {
	return Array.from(
		document.querySelectorAll< HTMLButtonElement >(
			'#desktop-mode-ai-assistant .os-ai__cmd-item',
		),
	);
}

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

		registerCommand( { slug: 'global/a', label: 'ZZZ Alpha', owner: 'global', run: alpha } );
		registerCommand( { slug: 'plugin/b', label: 'ZZZ Beta', run: beta } );

		assistant = new AiAssistant( CONFIG );
		assistant.open();
		typeQuery( 'ZZZ' );
		expect( rows()[ 0 ].textContent ).toContain( 'ZZZ Alpha' );

		unregisterCommand( 'global/a' );
		registerCommand( { slug: 'global/a', label: 'ZZZ Alpha', owner: 'global', run: alpha } );

		const [ topRow ] = rows();
		const topLabel = topRow.textContent ?? '';
		topRow.click();

		const expected = topLabel.includes( 'Alpha' ) ? alpha : beta;
		const other = expected === alpha ? beta : alpha;
		await vi.waitFor( () => expect( expected ).toHaveBeenCalled() );
		expect( other ).not.toHaveBeenCalled();
	} );

	test( 'a result stays up when the WordPress commands finish loading', async () => {
		registerCommand( {
			slug: 'plugin/say-hi',
			label: 'SN: Say hi',
			run: () => ( { message: 'Hello from the command' } ),
		} );

		assistant = new AiAssistant( CONFIG );
		assistant.setBaselineLoading( true );
		assistant.open();
		typeQuery( 'SN: Say hi' );
		rows()[ 0 ].click();
		await vi.waitFor( () =>
			expect( resultsText() ).toContain( 'Hello from the command' ),
		);

		registerCommand( {
			slug: 'core/add-new-post',
			label: 'Add new post',
			run: () => undefined,
		} );
		assistant.setBaselineLoading( false );

		expect( resultsText() ).toContain( 'Hello from the command' );
	} );
} );
