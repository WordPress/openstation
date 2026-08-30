/**
 * The workspace wizard — the one door to a new desk.
 *
 * The rule this file exists to hold: **the fast path is still fast.**
 * Pressing `+` and then Enter has to be a plain new desktop, the same
 * two gestures it was before the wizard existed — and a user who never
 * touches a later step must end up with a plain Space (no profile), not
 * a workspace that happens to be empty. The rest pins that the steps
 * write what they say, and that Cancel genuinely discards.
 *
 * Runs against the real components: this bundle is the only thing in
 * the shell that puts `<os-steps>`, `<os-card>` and the picker kit in
 * one dialog, and a stubbed DOM would test a wizard nobody ships.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	closeWorkspaceWizard,
	openWorkspaceWizard,
	type WorkspaceWizardOptions,
	type WorkspaceWizardResult,
} from '../../src/workspaces/wizard';
import { blankWorkspaceProfile } from '../../src/workspaces';
import type { WorkspacePreset, WorkspaceProfile } from '../../src/workspaces';

const COMMERCE: WorkspacePreset = {
	id: 'commerce',
	label: 'Commerce',
	description: 'A shop floor.',
	icon: 'dashicons-cart',
	color: '#7f54b3',
	apps: [ 'woocommerce' ],
	widgets: [ 'clock' ],
	appearance: { wallpaper: 'dark' },
	windows: [ { match: 'wc-orders' } ],
	layout: 'columns',
	defaultLabel: 'Commerce',
};

/** A resolved Commerce profile, as `resolvePreset` would return it. */
function resolvedCommerce(): WorkspaceProfile {
	return {
		preset: 'commerce',
		icon: 'dashicons-cart',
		color: '#7f54b3',
		apps: { mode: 'only', ids: [ 'woocommerce' ] },
		widgets: { mode: 'only', ids: [ 'clock' ] },
		appearance: { wallpaper: 'dark' },
		windows: [ { match: 'wc-orders' } ],
		layout: 'columns',
		provisioned: false,
	};
}

function options(
	overrides: Partial< WorkspaceWizardOptions > = {},
): WorkspaceWizardOptions {
	return {
		mode: 'create',
		presets: [ COMMERCE ],
		apps: [
			{ id: 'edit-php', title: 'Posts', kind: 'core' },
			{ id: 'woocommerce', title: 'WooCommerce', kind: 'plugin' },
			{ id: 'os-exit', title: 'Exit', kind: 'control', locked: true },
		],
		widgets: [ { id: 'clock', label: 'Clock' } ],
		enabledWidgetIds: [ 'clock' ],
		wallpapers: [ { id: 'dark', label: 'Dark', preview: '#111' } ],
		accents: [ { id: 'rose', label: 'Rose', value: '#e11d48' } ],
		resolvePreset: () => resolvedCommerce(),
		captureAppearance: () => ( { wallpaper: 'galaxy' } ),
		...overrides,
	};
}

const modal = (): HTMLElement =>
	document.querySelector< HTMLElement >( '.os-workspace-wizard' )!;

const footerButtons = (): HTMLElement[] =>
	Array.from(
		modal().querySelectorAll< HTMLElement >(
			'.os-workspace-wizard__footer os-button',
		),
	);

const button = ( text: string ): HTMLElement => {
	const found = footerButtons().find(
		( b ) => b.textContent?.trim() === text,
	);
	if ( ! found ) {
		throw new Error(
			`No footer button "${ text }" — have: ${ footerButtons()
				.map( ( b ) => b.textContent?.trim() )
				.join( ', ' ) }`,
		);
	}
	return found;
};

const cards = (): HTMLElement[] =>
	Array.from( modal().querySelectorAll< HTMLElement >( 'os-card' ) );

const stepTitles = (): string[] =>
	Array.from( modal().querySelectorAll( 'os-step' ) ).map(
		( s ) => s.getAttribute( 'title' ) ?? '',
	);

const currentStep = (): string =>
	modal().querySelector( 'os-step[current]' )?.getAttribute( 'title' ) ?? '';

describe( 'workspace wizard', () => {
	let onCreate: ReturnType< typeof vi.fn >;
	let onSave: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		onCreate = vi.fn();
		onSave = vi.fn();
		vi.useFakeTimers();
	} );

	afterEach( () => {
		closeWorkspaceWizard();
		vi.useRealTimers();
	} );

	test( '+ then Create is a plain desktop, with no profile at all', () => {
		openWorkspaceWizard( options( { onCreate } ) );

		// Blank is the preselected card and the footer says so.
		expect( cards()[ 0 ].hasAttribute( 'selected' ) ).toBe( true );
		button( 'Create desktop' ).click();

		expect( onCreate ).toHaveBeenCalledTimes( 1 );
		const result: WorkspaceWizardResult = onCreate.mock.calls[ 0 ][ 0 ];
		expect( result.profile ).toBeNull();
		expect( result.preset ).toBeUndefined();
		expect( result.label ).toBe( '' );
		// Committed means closed.
		expect( modal() ).toBeNull();
	} );

	test( 'a template left untouched creates FROM the preset', () => {
		openWorkspaceWizard( options( { onCreate } ) );

		cards()[ 1 ].dispatchEvent( new CustomEvent( 'os-card-click' ) );
		expect( cards()[ 1 ].hasAttribute( 'selected' ) ).toBe( true );
		button( 'Create from template' ).click();

		// The shell creates from the id so the profile filter runs,
		// exactly as the old dropdown did.
		expect( onCreate.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			preset: 'commerce',
			profile: null,
		} );
	} );

	test( 'activating the selected card again commits it', () => {
		openWorkspaceWizard( options( { onCreate } ) );
		// Click once to choose, again to go.
		cards()[ 0 ].dispatchEvent( new CustomEvent( 'os-card-click' ) );
		expect( onCreate ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'Customize walks the steps, and Create is on every one', () => {
		openWorkspaceWizard( options( { onCreate } ) );
		expect( stepTitles() ).toEqual( [
			'Start',
			'Name',
			'Apps',
			'Widgets',
			'Look',
			'Windows',
		] );

		button( 'Customize' ).click();
		expect( currentStep() ).toBe( 'Name' );
		expect( () => button( 'Create workspace' ) ).not.toThrow();

		button( 'Next' ).click();
		expect( currentStep() ).toBe( 'Apps' );
		button( 'Next' ).click();
		expect( currentStep() ).toBe( 'Widgets' );
		button( 'Next' ).click();
		expect( currentStep() ).toBe( 'Look' );
		button( 'Next' ).click();
		expect( currentStep() ).toBe( 'Windows' );
		// Last step: nothing to go Next to.
		expect( footerButtons().map( ( b ) => b.textContent?.trim() ) ).not.toContain(
			'Next',
		);

		button( 'Back' ).click();
		expect( currentStep() ).toBe( 'Look' );
	} );

	test( 'customizing a template reads it into the draft — once', () => {
		openWorkspaceWizard( options( { onCreate } ) );
		cards()[ 1 ].dispatchEvent( new CustomEvent( 'os-card-click' ) );
		button( 'Customize' ).click();

		// The name step is prefilled from the template.
		expect(
			modal().querySelector( 'os-text-field' )?.getAttribute( 'value' ),
		).toBe( 'Commerce' );

		// Going back to Start and forward again must not wipe edits.
		button( 'Back' ).click();
		button( 'Customize' ).click();
		button( 'Create workspace' ).click();

		const result: WorkspaceWizardResult = onCreate.mock.calls[ 0 ][ 0 ];
		expect( result.preset ).toBeUndefined();
		expect( result.profile ).toMatchObject( {
			preset: 'commerce',
			layout: 'columns',
			apps: { mode: 'only', ids: [ 'woocommerce' ] },
		} );
		expect( result.label ).toBe( 'Commerce' );
	} );

	test( 'the apps step refuses to hide controls and locked items', () => {
		openWorkspaceWizard( options( { onCreate } ) );
		button( 'Customize' ).click();
		button( 'Next' ).click();

		const toggle = modal().querySelector( 'os-switch' )!;
		toggle.dispatchEvent(
			new CustomEvent( 'os-switch-change', { detail: { checked: true } } ),
		);
		const boxes = Array.from( modal().querySelectorAll( 'os-checkbox' ) );
		const exit = boxes.find( ( b ) => b.getAttribute( 'value' ) === 'os-exit' )!;
		expect( exit.hasAttribute( 'checked' ) ).toBe( true );
		expect( exit.hasAttribute( 'disabled' ) ).toBe( true );

		// Turning narrowing on starts from what is on screen, so the
		// non-control apps are checked, not blank.
		const posts = boxes.find( ( b ) => b.getAttribute( 'value' ) === 'edit-php' )!;
		expect( posts.hasAttribute( 'checked' ) ).toBe( true );

		posts.dispatchEvent(
			new CustomEvent( 'os-checkbox-change', { detail: { checked: false } } ),
		);
		button( 'Create workspace' ).click();
		const result: WorkspaceWizardResult = onCreate.mock.calls[ 0 ][ 0 ];
		expect( result.profile?.apps ).toEqual( {
			mode: 'only',
			ids: [ 'woocommerce' ],
		} );
	} );

	test( 'the look step captures the current look when switched on', () => {
		openWorkspaceWizard( options( { onCreate } ) );
		button( 'Customize' ).click();
		button( 'Next' ).click();
		button( 'Next' ).click();
		button( 'Next' ).click();
		expect( currentStep() ).toBe( 'Look' );

		modal()
			.querySelector( 'os-switch' )!
			.dispatchEvent(
				new CustomEvent( 'os-switch-change', { detail: { checked: true } } ),
			);
		// A wallpaper swatch is offered, and picking it writes the key.
		const swatch = modal().querySelector( 'os-swatch[value="dark"]' )!;
		swatch.dispatchEvent( new CustomEvent( 'os-pick', { detail: { value: 'dark' } } ) );

		button( 'Create workspace' ).click();
		const result: WorkspaceWizardResult = onCreate.mock.calls[ 0 ][ 0 ];
		expect( result.profile?.appearance ).toEqual( { wallpaper: 'dark' } );
	} );

	test( 'Cancel discards everything', () => {
		openWorkspaceWizard( options( { onCreate } ) );
		cards()[ 1 ].dispatchEvent( new CustomEvent( 'os-card-click' ) );
		button( 'Customize' ).click();
		button( 'Cancel' ).click();
		expect( onCreate ).not.toHaveBeenCalled();
		expect( modal() ).toBeNull();
	} );

	test( 'edit mode has no Start step, and Save where Create was', () => {
		const onDelete = vi.fn();
		openWorkspaceWizard(
			options( {
				mode: 'edit',
				desktopId: 'desktop-2',
				label: 'Shop',
				profile: resolvedCommerce(),
				onSave,
				onDelete,
			} ),
		);
		expect( stepTitles() ).toEqual( [
			'Name',
			'Apps',
			'Widgets',
			'Look',
			'Windows',
		] );
		expect( currentStep() ).toBe( 'Name' );
		expect( () => button( 'Save' ) ).not.toThrow();
		expect( () => button( 'Delete workspace' ) ).not.toThrow();

		button( 'Save' ).click();
		expect( onSave ).toHaveBeenCalledTimes( 1 );
		expect( onSave.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			label: 'Shop',
			profile: { preset: 'commerce' },
		} );
	} );

	test( 'editing a plain Space and turning nothing on keeps it plain', () => {
		openWorkspaceWizard(
			options( {
				mode: 'edit',
				desktopId: 'desktop-1',
				label: 'Desktop 1',
				profile: blankWorkspaceProfile(),
				onSave,
			} ),
		);
		button( 'Save' ).click();
		expect( onSave.mock.calls[ 0 ][ 0 ].profile ).toBeNull();
	} );

	test( 'opening twice replaces rather than stacks', () => {
		openWorkspaceWizard( options() );
		openWorkspaceWizard( options() );
		expect( document.querySelectorAll( '.os-workspace-wizard' ) ).toHaveLength( 1 );
	} );
} );
