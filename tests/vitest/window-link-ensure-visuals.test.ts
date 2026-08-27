/**
 * The visuals bundle is lazy, and it is also what registers the
 * built-in `svg-splines` renderer. Preferences builds its "Link style"
 * dropdown from that registry, so opening Preferences before any two
 * windows related left the select with only `None` while the stored
 * value was `svg-splines` — and it rendered blank.
 *
 * These pin the shared loader both callers now route through.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vendorLoader from '../../src/wallpapers/vendor-loader';
import {
	ensureWindowLinkVisuals,
	__resetWindowLinkVisualsForTests,
} from '../../src/window-links/ensure-visuals';

type Carrier = {
	openStationConfig?: { windowLinkVisualsBundleUrl?: string };
	openStationWindowLinkVisuals?: unknown;
};

const w = window as unknown as Carrier;

describe( 'ensureWindowLinkVisuals', () => {
	beforeEach( () => {
		__resetWindowLinkVisualsForTests();
		delete w.openStationWindowLinkVisuals;
		w.openStationConfig = {
			windowLinkVisualsBundleUrl: 'https://example.test/visuals.js',
		};
		vi.spyOn( vendorLoader, 'loadVendorScript' ).mockResolvedValue(
			undefined,
		);
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'loads the bundle from the config URL', async () => {
		await expect( ensureWindowLinkVisuals() ).resolves.toBe( true );

		expect( vendorLoader.loadVendorScript ).toHaveBeenCalledWith(
			'https://example.test/visuals.js',
		);
	} );

	it( 'loads once however many callers ask', async () => {
		// The Preferences picker and the shell's groups-changed
		// sentinel can both ask, in either order.
		await Promise.all( [
			ensureWindowLinkVisuals(),
			ensureWindowLinkVisuals(),
		] );
		await ensureWindowLinkVisuals();

		expect( vendorLoader.loadVendorScript ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not re-fetch a bundle the page already has', async () => {
		w.openStationWindowLinkVisuals = { start: () => {} };

		await expect( ensureWindowLinkVisuals() ).resolves.toBe( true );

		expect( vendorLoader.loadVendorScript ).not.toHaveBeenCalled();
	} );

	it( 'resolves false, without throwing, when no bundle URL is configured', async () => {
		w.openStationConfig = {};

		await expect( ensureWindowLinkVisuals() ).resolves.toBe( false );
		expect( vendorLoader.loadVendorScript ).not.toHaveBeenCalled();
	} );

	it( 'clears the memo after a failure so a later caller can retry', async () => {
		vi.mocked( vendorLoader.loadVendorScript ).mockRejectedValueOnce(
			new Error( 'offline' ),
		);

		await expect( ensureWindowLinkVisuals() ).rejects.toThrow( 'offline' );
		await expect( ensureWindowLinkVisuals() ).resolves.toBe( true );
		expect( vendorLoader.loadVendorScript ).toHaveBeenCalledTimes( 2 );
	} );
} );
