/**
 * OS Settings → Appearance → Window corners, when a desktop theme has
 * taken the token over.
 *
 * The preset writes `--desktop-mode-window-radius` as an inline style
 * on `<html>`; a theme that declares the same token writes it in a
 * compiled rule matching the shell root, which wins. That precedence
 * is intentional — what these tests defend is that the control
 * *admits* it, instead of sitting there looking operable and doing
 * nothing when clicked.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import '../../src/ui/components/wpd-segmented/wpd-segmented';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { setDesktopThemes } from '../../src/desktop-themes/registry';
import { applyDesktopTheme } from '../../src/desktop-themes/apply';
import {
	findThemeTokenOverride,
	WINDOW_RADIUS_TOKEN,
} from '../../src/desktop-themes/token-overrides';
import { buildWindowRadiusSection } from '../../src/settings/sections/window-radius';
import { structuredDefaults } from '../../src/settings/state';
import type { SettingsCtx } from '../../src/settings/types';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const tick = (): Promise< void > => Promise.resolve();

function seedTheme( tokens: Record< string, string > ): void {
	setDesktopThemes( [
		{
			id: 'acme/neon',
			slug: 'acme-neon',
			name: 'Neon Glass',
			version: '1.0.0',
			author: '',
			description: '',
			previewUrl: '',
			cssUrl: '',
			cssText: '',
			tokens,
			fonts: [],
			icons: {},
			iconColors: {},
			recommendedOsSettings: {},
			installedAt: 1,
			source: 'upload',
		},
	] );
}

function ctxWith(): SettingsCtx & { save: ReturnType< typeof vi.fn > } {
	const state = structuredDefaults();
	const save = vi.fn();
	return {
		state,
		save,
		apply: vi.fn(),
	} as unknown as SettingsCtx & { save: ReturnType< typeof vi.fn > };
}

beforeEach( () => {
	_resetAllSharedStoresForTests();
	installHooksStub();
	document.body.innerHTML = '';
	const shell = document.createElement( 'div' );
	shell.id = 'desktop-mode-shell';
	document.body.appendChild( shell );
	return () => clearHooksStub();
} );

describe( 'findThemeTokenOverride', () => {
	test( 'null when no theme is active', () => {
		seedTheme( { [ WINDOW_RADIUS_TOKEN ]: '12px' } );
		expect( findThemeTokenOverride( WINDOW_RADIUS_TOKEN ) ).toBeNull();
	} );

	test( 'reports the theme and value when the active theme pins it', () => {
		seedTheme( { [ WINDOW_RADIUS_TOKEN ]: '12px' } );
		applyDesktopTheme( 'acme-neon' );

		const override = findThemeTokenOverride( WINDOW_RADIUS_TOKEN );
		expect( override?.value ).toBe( '12px' );
		expect( override?.theme.name ).toBe( 'Neon Glass' );
	} );

	test( 'null when the active theme leaves the token alone', () => {
		seedTheme( { '--desktop-mode-window-bg': '#12122a' } );
		applyDesktopTheme( 'acme-neon' );
		expect( findThemeTokenOverride( WINDOW_RADIUS_TOKEN ) ).toBeNull();
	} );

	test( 'matches case-insensitively — PHP lower-cases token keys', () => {
		seedTheme( { [ WINDOW_RADIUS_TOKEN ]: '12px' } );
		applyDesktopTheme( 'acme-neon' );
		expect(
			findThemeTokenOverride( '--Desktop-Mode-Window-Radius' )?.value,
		).toBe( '12px' );
	} );
} );

describe( 'Window corners section', () => {
	test( 'is operable when no theme owns the radius', async () => {
		const ctx = ctxWith();
		const el = buildWindowRadiusSection( ctx );
		document.body.appendChild( el );
		await tick();

		const group = el.querySelector( 'wpd-segmented' )!;
		expect( group.hasAttribute( 'disabled' ) ).toBe( false );
		expect( el.querySelector( 'wpd-notice' ) ).toBeNull();
	} );

	test( 'disables itself and names the theme that took the token', async () => {
		seedTheme( { [ WINDOW_RADIUS_TOKEN ]: '12px' } );
		applyDesktopTheme( 'acme-neon' );

		const ctx = ctxWith();
		const el = buildWindowRadiusSection( ctx );
		document.body.appendChild( el );
		await tick();

		const group = el.querySelector( 'wpd-segmented' )!;
		expect( group.hasAttribute( 'disabled' ) ).toBe( true );
		expect( el.querySelector( 'wpd-notice' )?.textContent ).toContain(
			'Neon Glass',
		);
	} );

	test( 'a pick while theme-owned changes nothing and saves nothing', async () => {
		seedTheme( { [ WINDOW_RADIUS_TOKEN ]: '12px' } );
		applyDesktopTheme( 'acme-neon' );

		const ctx = ctxWith();
		const el = buildWindowRadiusSection( ctx );
		document.body.appendChild( el );
		await tick();
		await tick();

		el
			.querySelector( 'wpd-segment[value="sharp"]' )!
			.shadowRoot!.querySelector( 'button' )!
			.click();
		await tick();

		expect( ctx.state.windowRadius ).toBe( 'default' );
		expect( ctx.save ).not.toHaveBeenCalled();
	} );

	test( 'switching back to the system default re-enables it live', async () => {
		seedTheme( { [ WINDOW_RADIUS_TOKEN ]: '12px' } );
		applyDesktopTheme( 'acme-neon' );

		const ctx = ctxWith();
		const el = buildWindowRadiusSection( ctx );
		document.body.appendChild( el );
		await tick();
		expect( el.querySelector( 'wpd-segmented' )!.hasAttribute( 'disabled' ) )
			.toBe( true );

		// No Settings reopen: the section subscribes to the theme
		// registry, so deactivating repaints it where it stands.
		applyDesktopTheme( '' );
		await tick();

		expect( el.querySelector( 'wpd-segmented' )!.hasAttribute( 'disabled' ) )
			.toBe( false );
		expect( el.querySelector( 'wpd-notice' ) ).toBeNull();
	} );

	test( 'still writes and applies a pick when nothing owns the token', async () => {
		const ctx = ctxWith();
		const el = buildWindowRadiusSection( ctx );
		document.body.appendChild( el );
		await tick();
		await tick();

		el
			.querySelector( 'wpd-segment[value="round"]' )!
			.shadowRoot!.querySelector( 'button' )!
			.click();
		await tick();

		expect( ctx.state.windowRadius ).toBe( 'round' );
		expect( ctx.save ).toHaveBeenCalledTimes( 1 );
		expect( ctx.apply ).toHaveBeenCalledTimes( 1 );
	} );
} );
