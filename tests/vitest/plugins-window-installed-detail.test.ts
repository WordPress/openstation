/**
 * Tests for `deriveSlug` — the gate on every wp.org-facing affordance
 * in an installed plugin's detail panel (the "View on WordPress.org"
 * button, and the Changelog / FAQ / Reviews tabs that lazy-load
 * `plugin_information`).
 *
 * The regression these lock down: the slug used to be *derived* from
 * the plugin's folder name, which every installed plugin has, on or
 * off the directory. Private, premium and self-hosted plugins got a
 * button pointing at `wordpress.org/plugins/<their-folder>/` — a 404
 * (GH#492). Only the server's affirmative answer counts now, the same
 * line classic `plugins.php` draws.
 */

import { describe, expect, test } from 'vitest';
import { deriveSlug } from '../../src/plugins-window/installed-detail';
import type { InstalledPlugin } from '../../src/plugins-window/types';

function row( over: Partial< InstalledPlugin > = {} ): InstalledPlugin {
	return {
		plugin: 'acme-private-widgets/acme-private-widgets',
		status: 'inactive',
		name:   'Acme Private Widgets',
		...over,
	} as InstalledPlugin;
}

describe( 'deriveSlug', () => {
	test( 'uses the directory slug the server resolved', () => {
		expect(
			deriveSlug( row( { openstation_wporg_slug: 'akismet' } ) ),
		).toBe( 'akismet' );
	} );

	test( 'prefers the directory slug over the folder name', () => {
		// `hello.php` is listed as `hello-dolly`; folder and slug part
		// ways for plenty of directory plugins.
		expect(
			deriveSlug(
				row( {
					plugin:                 'hello',
					textdomain:             'hello-dolly',
					openstation_wporg_slug: 'hello-dolly',
				} ),
			),
		).toBe( 'hello-dolly' );
	} );

	test( 'returns no slug when the plugin is not on the directory', () => {
		expect( deriveSlug( row( { openstation_wporg_slug: null } ) ) ).toBe( '' );
	} );

	test( 'does not fall back to the folder name', () => {
		expect(
			deriveSlug(
				row( {
					plugin:                 'acme-private-widgets/acme-private-widgets',
					openstation_wporg_slug: null,
				} ),
			),
		).toBe( '' );
	} );

	test( 'does not fall back to the text domain', () => {
		expect(
			deriveSlug(
				row( { textdomain: 'acme-private-widgets', openstation_wporg_slug: null } ),
			),
		).toBe( '' );
	} );

	test( 'does not treat a guessed icon URL as a directory listing', () => {
		// The icon field falls back to a `ps.w.org` URL off the folder
		// name whether or not the plugin is listed — it 404s to a
		// placeholder, so it proves nothing about the directory.
		expect(
			deriveSlug(
				row( {
					openstation_icon_url:
						'https://ps.w.org/acme-private-widgets/assets/icon.svg',
					openstation_wporg_slug: null,
				} ),
			),
		).toBe( '' );
	} );

	test( 'returns no slug when the field is missing entirely', () => {
		expect( deriveSlug( row() ) ).toBe( '' );
	} );
} );
