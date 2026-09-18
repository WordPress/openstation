import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginActionButtons, freshBusy } from '../../apps/plugins/parts/actions';
import {
	DEFAULT_UPDATE_TIMEOUT_MS,
	enqueueUpdateJob,
	resetUpdateQueueForTest,
} from '../../apps/plugins/parts/update-queue';
import type { InstalledPlugin, PluginsExtra, PluginsHost } from '../../apps/plugins/parts/types';

function mockPluginRow( over: Partial< InstalledPlugin > = {} ): InstalledPlugin {
	return {
		plugin: 'hello-dolly/hello',
		status: 'inactive',
		name: 'Hello Dolly',
		textdomain: 'hello-dolly',
		openstation_update_available: {
			available: true,
			new_version: '2.0.0',
			package: 'https://downloads.wordpress.org/plugin/hello-dolly.2.0.0.zip',
			slug: 'hello-dolly',
		},
		...over,
	};
}

function mockHost( over: Partial< PluginsHost > = {} ): PluginsHost & { toasts: string[]; repaints: number } {
	const toasts: string[] = [];
	let repaints = 0;
	const extra: PluginsExtra = {
		ajaxUrl: 'http://example.test/wp-admin/admin-ajax.php',
		ajaxNonce: 'ajax-nonce',
		updatesNonce: 'updates-nonce',
		caps: { activate: true, install: true, delete: true, upload: true, update: true },
		autoUpdatesEnabled: true,
		selfPluginFile: 'desktop-mode/desktop-mode',
		adminUrl: 'http://example.test/wp-admin/',
	};
	const row = mockPluginRow();
	return {
		extra,
		installed: [ row ],
		rest: {
			browsePlugins: vi.fn(),
			fetchPluginInfo: vi.fn(),
			fetchPluginReviews: vi.fn(),
			fetchFeaturedPlugins: vi.fn(),
			installPluginBySlug: vi.fn(),
			updateInstalledPlugin: vi.fn(),
			toggleAutoUpdate: vi.fn(),
			uploadPluginZip: vi.fn(),
			isOpenStationSelf: vi.fn( () => false ),
		},
		root: document.body,
		busy: freshBusy(),
		caches: { info: new Map(), reviews: new Map() },
		dispatch: vi.fn( async () => true ),
		refresh: vi.fn( async () => true ),
		repaint: () => {
			repaints++;
		},
		toast: ( msg: string ) => {
			toasts.push( msg );
		},
		confirm: vi.fn( async () => true ),
		refreshMenu: vi.fn(),
		installedFor: ( slug ) => ( slug === 'hello-dolly' ? row : undefined ),
		broadcastChange: vi.fn(),
		toasts,
		repaints,
		...over,
	};
}

describe( 'Plugins update queue (enqueueUpdateJob)', () => {
	beforeEach( () => {
		resetUpdateQueueForTest();
		vi.useFakeTimers();
	} );

	afterEach( () => {
		resetUpdateQueueForTest();
		vi.useRealTimers();
	} );

	it( 'has a default timeout of 60 seconds', () => {
		expect( DEFAULT_UPDATE_TIMEOUT_MS ).toBe( 60_000 );
	} );

	it( 'resolves normally when the job completes before timeout', async () => {
		const job = vi.fn( async () => ( { newVersion: '1.2.0' } ) );
		const promise = enqueueUpdateJob( job );
		await expect( promise ).resolves.toEqual( { newVersion: '1.2.0' } );
		expect( job ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'rejects with custom error when the job fails normally', async () => {
		const job = vi.fn( async () => {
			throw new Error( 'Download failed.' );
		} );
		const promise = enqueueUpdateJob( job );
		await expect( promise ).rejects.toThrow( 'Download failed.' );
	} );

	it( 'rejects with a timeout error if a job stalls and does not settle', async () => {
		const hangingJob = vi.fn( () => new Promise( () => undefined ) );
		const promise = enqueueUpdateJob( hangingJob, 5000 );

		vi.advanceTimersByTime( 5000 );

		await expect( promise ).rejects.toThrow( 'Update request timed out' );
	} );

	it( 'unblocks subsequent queued jobs after a timed-out job', async () => {
		const hangingJob = vi.fn( () => new Promise( () => undefined ) );
		const nextJob = vi.fn( async () => 'success-next' );

		const p1 = enqueueUpdateJob( hangingJob, 3000 );
		const p2 = enqueueUpdateJob( nextJob, 3000 );

		expect( nextJob ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( 3000 );

		await expect( p1 ).rejects.toThrow( 'Update request timed out' );

		await expect( p2 ).resolves.toBe( 'success-next' );
		expect( nextJob ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'executes jobs in strict FIFO order', async () => {
		const order: number[] = [];
		const job1 = vi.fn( async () => {
			order.push( 1 );
			return 1;
		} );
		const job2 = vi.fn( async () => {
			order.push( 2 );
			return 2;
		} );
		const job3 = vi.fn( async () => {
			order.push( 3 );
			return 3;
		} );

		const [ r1, r2, r3 ] = await Promise.all( [
			enqueueUpdateJob( job1 ),
			enqueueUpdateJob( job2 ),
			enqueueUpdateJob( job3 ),
		] );

		expect( r1 ).toBe( 1 );
		expect( r2 ).toBe( 2 );
		expect( r3 ).toBe( 3 );
		expect( order ).toEqual( [ 1, 2, 3 ] );
	} );
} );

describe( 'Plugins update action with timeout integration', () => {
	beforeEach( () => {
		resetUpdateQueueForTest();
		vi.useFakeTimers();
	} );

	afterEach( () => {
		resetUpdateQueueForTest();
		vi.useRealTimers();
	} );

	it( 'recovers from a stalled update: shows failure toast, clears busy state, and re-enables button', async () => {
		const host = mockHost();
		const row = mockPluginRow();

		// Simulate rest.updateInstalledPlugin hanging forever
		( host.rest.updateInstalledPlugin as ReturnType< typeof vi.fn > ).mockImplementation(
			() => new Promise( () => undefined ),
		);

		// Render the update button
		const buttons = pluginActionButtons( host, row );
		const updateBtn = buttons[ 0 ];
		expect( updateBtn.textContent ).toBe( 'Update' );

		// Click the Update button
		updateBtn.click();

		// Check that row is marked busy immediately
		expect( host.busy.updating.has( row.plugin ) ).toBe( true );
		const busyBtn = pluginActionButtons( host, row )[ 0 ];
		expect( busyBtn.textContent ).toBe( 'Updating…' );
		expect( busyBtn.hasAttribute( 'disabled' ) ).toBe( true );
		expect( busyBtn.getAttribute( 'aria-busy' ) ).toBe( 'true' );

		// Clicking again while in flight is ignored
		updateBtn.click();
		expect( host.rest.updateInstalledPlugin ).toHaveBeenCalledTimes( 1 );

		// Advance timer past the default 60s timeout
		await vi.advanceTimersByTimeAsync( 60_000 );

		// Row must NOT be busy anymore
		await vi.waitFor( () => expect( host.busy.updating.has( row.plugin ) ).toBe( false ) );

		// Failure toast must be shown
		expect( host.toasts.length ).toBeGreaterThanOrEqual( 1 );
		expect( host.toasts[ 0 ] ).toContain( 'Update request timed out' );
		const retryBtn = pluginActionButtons( host, row )[ 0 ];
		expect( retryBtn.textContent ).toBe( 'Update' );
		expect( retryBtn.hasAttribute( 'disabled' ) ).toBe( false );
		expect( retryBtn.hasAttribute( 'aria-busy' ) ).toBe( false );

		// Further clicks work again and trigger a new update attempt
		( host.rest.updateInstalledPlugin as ReturnType< typeof vi.fn > ).mockImplementation(
			async () => ( { newVersion: '2.0.0' } ),
		);
		retryBtn.click();

		expect( host.busy.updating.has( row.plugin ) ).toBe( true );
		expect( host.rest.updateInstalledPlugin ).toHaveBeenCalledTimes( 2 );

		// Let successful second attempt resolve
		await vi.runAllTimersAsync();

		expect( host.busy.updating.has( row.plugin ) ).toBe( false );
		expect( host.toasts[ 1 ] ).toContain( 'Hello Dolly updated to 2.0.0' );
	} );
} );
