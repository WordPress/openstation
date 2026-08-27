/**
 * What the recycle bin tells the window's status ring.
 *
 * It reads on open and again on every real-time signal — an item
 * trashed in another tab, a purge someone else ran — and each of
 * those reads used to flash a success check at a user who had done
 * nothing. Its writes are the opposite case, so the split is what's
 * pinned here, not the silence alone.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';

const trackedFetch = vi.hoisted( () => vi.fn() );
vi.mock( '../../src/tracked-fetch', () => ( { trackedFetch } ) );

import {
	emptyBin,
	fetchList,
	purgeItems,
	restoreItems,
} from '../../src/recycle-bin/rest';

/** The `opts` argument of the last tracked call. */
function lastOpts(): { silent?: boolean; source?: string } {
	return trackedFetch.mock.calls[ trackedFetch.mock.calls.length - 1 ][ 2 ];
}

const BASE = 'http://localhost/wp-json/desktop-mode/v1/recycle-bin';

beforeEach( () => {
	trackedFetch.mockReset();
	trackedFetch.mockResolvedValue( {
		ok: true,
		json: async () => ( { items: [], total: 0 } ),
	} );
	( window as unknown as { openStationRecycleBinConfig: unknown } ).openStationRecycleBinConfig =
		{
			restNonce: 'nonce',
			listUrl: BASE,
			restoreUrl: `${ BASE }/restore`,
			purgeUrl: `${ BASE }/purge`,
			emptyUrl: `${ BASE }/empty`,
		};
} );

describe( 'recycle bin: reads and the status ring', () => {
	test( 'listing the bin does not pulse the ring', async () => {
		await fetchList( { type: 'all', search: '', perPage: 200 } );

		expect( lastOpts().silent ).toBe( true );
		// `silent` suppresses the pulse, not the tracking — the dev
		// panel and any plugin observer still see the request.
		expect( lastOpts().source ).toBe( 'desktop-mode/recycle-bin' );
	} );

	test.each( [
		[ 'restoring', () => restoreItems( [ { id: 1, type: 'post' } ] ) ],
		[ 'purging', () => purgeItems( [ { id: 1, type: 'post' } ] ) ],
		[ 'emptying', () => emptyBin() ],
	] )( '%s reports — it is the user changing something', async ( _label, call ) => {
		await ( call as () => Promise< unknown > )();

		expect( lastOpts().silent ).toBe( false );
	} );
} );
