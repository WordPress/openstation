/**
 * The Workspaces app's one piece of client logic: telling a shared
 * workspace that changed since it was published from one that merely
 * came back from the server shaped differently.
 */

import { describe, expect, test } from 'vitest';
import { profileFingerprint } from './workspaces.os';
import type { WorkspaceProfile } from '../../src/workspaces/types';

const asWritten: WorkspaceProfile = {
	preset: '',
	icon: 'dashicons-cart',
	color: '',
	apps: { mode: 'only', ids: [ 'edit-php' ] },
	appearance: { wallpaper: 'mono', wallpaperSettings: {} },
	windows: [ { match: 'edit-php', url: 'edit.php', place: { x: 0.123456, y: 0, width: 0.5, height: 0.5 } } ],
	layout: 'free',
	provisioned: true,
};

describe( 'profileFingerprint', () => {
	test( 'the server round trip does not read as a change', () => {
		// What PHP hands back: `{}` as `[]`, widgets filled in as `all`,
		// positions rounded to four places, provisioned reset.
		const asRead = {
			...asWritten,
			appearance: { wallpaper: 'mono', wallpaperSettings: [] as unknown as Record< string, unknown > },
			widgets: { mode: 'all' as const, ids: [] },
			windows: [ { match: 'edit-php', url: 'edit.php', place: { x: 0.1235, y: 0, width: 0.5, height: 0.5 } } ],
			restricted: false,
			provisioned: false,
		};
		expect( profileFingerprint( asRead ) ).toBe( profileFingerprint( asWritten ) );
	} );

	test( 'a real edit does', () => {
		expect( profileFingerprint( { ...asWritten, restricted: true } ) ).not.toBe(
			profileFingerprint( asWritten ),
		);
		expect( profileFingerprint( { ...asWritten, windows: [] } ) ).not.toBe(
			profileFingerprint( asWritten ),
		);
	} );
} );
