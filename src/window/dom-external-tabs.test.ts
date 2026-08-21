/**
 * A window's tab strip loads each tab's URL into its own iframe, so a
 * row pointing at another host has no tab to be — the remote origin
 * refuses the frame. `createWindowElement` drops those rows.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createWindowElement } from './dom';
import type { WindowConfig } from '../types';
import {
	clearHooksStub,
	installHooksStub,
} from '../../tests/vitest/helpers/hooks-stub';

const ADMIN = window.location.origin + '/wp-admin/';

function build( submenu: WindowConfig[ 'submenu' ] ): HTMLElement {
	return createWindowElement( {
		id: 'my-plugin',
		title: 'My Plugin',
		url: ADMIN + 'admin.php?page=my-plugin',
		icon: 'dashicons-admin-generic',
		x: 0,
		y: 0,
		width: 800,
		height: 600,
		minWidth: 320,
		minHeight: 240,
		submenu,
	} as WindowConfig );
}

/** Labels of the strip's submenu tabs, in order. */
function tabLabels( el: HTMLElement ): string[] {
	return Array.from(
		el.querySelectorAll< HTMLElement >( '.os-window__tab[data-kind="submenu"]' ),
	).map( ( tab ) => tab.textContent ?? '' );
}

describe( 'tab strip and off-site submenu rows', () => {
	beforeEach( () => {
		installHooksStub();
	} );

	afterEach( () => {
		clearHooksStub();
	} );

	test( 'an external row never becomes a tab', () => {
		const el = build( [
			{ title: 'Settings', url: ADMIN + 'admin.php?page=my-plugin-settings' },
			{ title: 'Docs', url: 'https://example.org/docs', external: true },
		] );

		expect( tabLabels( el ) ).toEqual( [ 'My Plugin', 'Settings' ] );
	} );

	test( 'a submenu of nothing but external rows renders no strip', () => {
		const el = build( [
			{ title: 'Docs', url: 'https://example.org/docs', external: true },
		] );

		expect( tabLabels( el ) ).toEqual( [] );
	} );

	test( 'internal rows are untouched', () => {
		const el = build( [
			{ title: 'Settings', url: ADMIN + 'admin.php?page=my-plugin-settings' },
			{ title: 'Tools', url: ADMIN + 'admin.php?page=my-plugin-tools' },
		] );

		expect( tabLabels( el ) ).toEqual( [ 'My Plugin', 'Settings', 'Tools' ] );
	} );
} );
