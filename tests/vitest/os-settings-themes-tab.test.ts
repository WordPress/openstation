/**
 * OS Settings → Themes tab.
 *
 * The picker separates personal selection from site-wide package
 * management. These tests pin that information architecture and the
 * native radio interaction that switches the current look.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setDesktopThemes } from '../../src/desktop-themes/registry';
import type { DesktopThemeEntry } from '../../src/desktop-themes/types';
import { buildThemesSection } from '../../src/settings/sections/themes';
import { structuredDefaults } from '../../src/settings/state';
import type { SettingsCtx } from '../../src/settings/types';

function theme(
	overrides: Partial< DesktopThemeEntry > = {},
): DesktopThemeEntry {
	return {
		id: 'signal-garden',
		slug: 'signal-garden',
		name: 'Signal Garden',
		version: '1.2.0',
		author: 'OpenStation',
		description: 'A quiet greenhouse built for long writing sessions.',
		previewUrl: 'https://example.test/signal-garden.png',
		cssUrl: 'https://example.test/signal-garden.css',
		cssText: '',
		tokens: {},
		fonts: [],
		icons: {},
		iconColors: {},
		recommendedOsSettings: {},
		installedAt: 1,
		source: 'upload',
		...overrides,
	};
}

function ctx(
	desktopTheme = '',
	canManageDesktopThemes = false,
): SettingsCtx & { save: ReturnType< typeof vi.fn >; apply: ReturnType< typeof vi.fn > } {
	return {
		state: { ...structuredDefaults(), desktopTheme },
		config: {
			canManageDesktopThemes,
			desktopThemesUrl: 'https://example.test/desktop-themes',
		},
		save: vi.fn(),
		apply: vi.fn(),
	} as unknown as SettingsCtx & {
		save: ReturnType< typeof vi.fn >;
		apply: ReturnType< typeof vi.fn >;
	};
}

function mount( settingsCtx: SettingsCtx ): HTMLElement {
	const el = buildThemesSection( settingsCtx );
	document.body.appendChild( el );
	return el;
}

describe( 'OS Settings — Themes tab', () => {
	beforeEach( () => {
		document.body.replaceChildren();
		setDesktopThemes( [] );
	} );

	afterEach( () => {
		document.body.replaceChildren();
		// Detached subscribers remove themselves on this change.
		setDesktopThemes( [] );
	} );

	test( 'stages the active theme and uses its real library copy', () => {
		setDesktopThemes( [ theme() ] );
		const el = mount( ctx( 'signal-garden' ) );

		expect(
			el.querySelector( '.os-settings__theme-stage-name' )?.textContent?.trim(),
		).toBe( 'Signal Garden' );
		expect(
			el.querySelector( '.os-settings__theme-stage-description' )?.textContent,
		).toContain( 'quiet greenhouse' );
		expect(
			el.querySelector< HTMLImageElement >( '.os-settings__theme-stage img' )
				?.src,
		).toBe( 'https://example.test/signal-garden.png' );
	} );

	test( 'renders the library as one native radio group', () => {
		setDesktopThemes( [ theme(), theme( { slug: 'paper-sun', name: 'Paper Sun' } ) ] );
		const el = mount( ctx( 'paper-sun' ) );
		const radios = Array.from(
			el.querySelectorAll< HTMLInputElement >(
				'input[name="openstation-desktop-theme"]',
			),
		);

		expect( radios ).toHaveLength( 3 );
		expect( radios.find( ( radio ) => radio.checked )?.value ).toBe(
			'paper-sun',
		);
		expect( el.querySelector( '.os-settings__theme-count' )?.textContent ).toContain(
			'3 looks',
		);
	} );

	test( 'switching a radio applies and saves the chosen look', () => {
		setDesktopThemes( [ theme() ] );
		const settingsCtx = ctx();
		const el = mount( settingsCtx );
		const radio = Array.from(
			el.querySelectorAll< HTMLInputElement >(
				'input[name="openstation-desktop-theme"]',
			),
		).find( ( input ) => input.value === 'signal-garden' )!;

		radio.checked = true;
		radio.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		expect( settingsCtx.state.desktopTheme ).toBe( 'signal-garden' );
		expect( settingsCtx.save ).toHaveBeenCalledOnce();
		expect( settingsCtx.apply ).toHaveBeenCalledOnce();
		expect(
			el.querySelector( '.os-settings__theme-stage-name' )?.textContent?.trim(),
		).toBe( 'Signal Garden' );
	} );

	test( 'shows the system look when a saved package is missing', () => {
		const el = mount( ctx( 'no-longer-installed' ) );
		const selected = el.querySelector< HTMLInputElement >(
			'input[name="openstation-desktop-theme"]:checked',
		);

		expect( selected?.value ).toBe( '' );
		expect(
			el.querySelector( '.os-settings__theme-stage-name' )?.textContent?.trim(),
		).toBe( 'OpenStation' );
	} );

	test( 'does not describe an undocumented package as the system theme', () => {
		setDesktopThemes( [ theme( { description: '' } ) ] );
		const el = mount( ctx( 'signal-garden' ) );

		expect(
			el.querySelector( '.os-settings__theme-stage-description' )?.textContent,
		).toContain( 'A complete desktop look' );
		expect(
			el.querySelector( '.os-settings__theme-stage-description' )?.textContent,
		).not.toContain( 'original OpenStation look' );
	} );

	test( 'arrow keys move focus through the library without switching theme', () => {
		setDesktopThemes( [ theme(), theme( { slug: 'paper-sun', name: 'Paper Sun' } ) ] );
		const settingsCtx = ctx();
		const el = mount( settingsCtx );
		const radios = Array.from(
			el.querySelectorAll< HTMLInputElement >(
				'input[name="openstation-desktop-theme"]',
			),
		);
		radios[ 0 ].focus();

		const arrow = new KeyboardEvent( 'keydown', {
			key: 'ArrowRight',
			bubbles: true,
			cancelable: true,
		} );
		radios[ 0 ].dispatchEvent( arrow );

		// Cancelled, or the browser's own radio handling would select
		// as it moves — which on this group means swapping the desktop
		// stylesheet and seeding the theme's recommendations.
		expect( arrow.defaultPrevented ).toBe( true );
		expect( document.activeElement ).toBe( radios[ 1 ] );
		expect( settingsCtx.state.desktopTheme ).toBe( '' );
		expect( settingsCtx.save ).not.toHaveBeenCalled();
		expect( settingsCtx.apply ).not.toHaveBeenCalled();

		// And it wraps, the way a radio group's arrows always have.
		const back = new KeyboardEvent( 'keydown', {
			key: 'ArrowLeft',
			bubbles: true,
			cancelable: true,
		} );
		radios[ 0 ].focus();
		radios[ 0 ].dispatchEvent( back );
		expect( document.activeElement ).toBe( radios[ radios.length - 1 ] );
	} );

	test( 'Enter commits the focused choice', () => {
		setDesktopThemes( [ theme() ] );
		const settingsCtx = ctx();
		const el = mount( settingsCtx );
		const target = Array.from(
			el.querySelectorAll< HTMLInputElement >(
				'input[name="openstation-desktop-theme"]',
			),
		).find( ( input ) => input.value === 'signal-garden' )!;

		target.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Enter',
				bubbles: true,
				cancelable: true,
			} ),
		);

		expect( settingsCtx.state.desktopTheme ).toBe( 'signal-garden' );
		expect( settingsCtx.apply ).toHaveBeenCalledOnce();
		expect(
			el.querySelector< HTMLInputElement >(
				'input[name="openstation-desktop-theme"]:checked',
			)?.value,
		).toBe( 'signal-garden' );
	} );

	test( 'keeps a radio checked after the worn theme leaves the library', () => {
		setDesktopThemes( [ theme() ] );
		const el = mount( ctx() );
		const radios = () =>
			Array.from(
				el.querySelectorAll< HTMLInputElement >(
					'input[name="openstation-desktop-theme"]',
				),
			);

		// Both clicks set each input's dirty-checkedness flag, which is
		// what makes the `checked` ATTRIBUTE stop reflecting to the
		// property. The binding has to be the property.
		radios()[ 0 ].click();
		radios()[ 1 ].click();

		// The package is deleted, or its plugin is deactivated.
		setDesktopThemes( [] );

		expect( radios().filter( ( radio ) => radio.checked ) ).toHaveLength( 1 );
		expect(
			el.querySelector< HTMLInputElement >(
				'input[name="openstation-desktop-theme"]:checked',
			)?.value,
		).toBe( '' );
	} );

	test( 'keeps package management admin-only and separate from choices', () => {
		setDesktopThemes( [
			theme(),
			theme( {
				id: 'plugin-theme',
				slug: 'plugin-theme',
				name: 'Plugin Theme',
				source: 'code',
			} ),
		] );

		expect(
			mount( ctx( '', false ) ).querySelector(
				'.os-settings__theme-management',
			),
		).toBeNull();

		const adminEl = mount( ctx( '', true ) );
		const removableNames = Array.from(
			adminEl.querySelectorAll( '.os-settings__theme-package-copy strong' ),
		).map( ( node ) => node.textContent?.trim() );

		expect( removableNames ).toEqual( [ 'Signal Garden' ] );
		expect(
			adminEl.querySelector( '.os-settings__theme-file-input' ),
		).not.toBeNull();
	} );
} );
