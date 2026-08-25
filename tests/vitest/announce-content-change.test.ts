/**
 * `announceContentChange()` — the typed envelope every content-change
 * producer shares.
 *
 * The topic (`os.<type>.changed`) and payload (`{ source, action,
 * ids }`) are a load-bearing convention: the Recycle Bin window, its
 * dock icon, and the shell's iframe-reload subscriber all parse this
 * exact shape, and a producer that drifts fails silently — the bin
 * just stops updating. These tests pin the envelope.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { announceContentChange, subscribe } from '../../src/broadcast';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

describe( 'announceContentChange', () => {
	const unsubs: Array< () => void > = [];

	beforeEach( () => {
		installHooksStub();
	} );

	const capture = ( topic: string ): Array< Record< string, unknown > > => {
		const seen: Array< Record< string, unknown > > = [];
		unsubs.push(
			subscribe( topic, ( payload ) => {
				seen.push( payload as Record< string, unknown > );
			} ),
		);
		return seen;
	};

	afterEach( () => {
		while ( unsubs.length ) {
			unsubs.pop()?.();
		}
		clearHooksStub();
	} );

	test( 'publishes the canonical envelope on the per-type topic', () => {
		const seen = capture( 'os.alltfo_form.changed' );

		announceContentChange( 'alltfo_form', 'trashed', [ 12, 34 ], 'allterrain-forms' );

		expect( seen ).toEqual( [
			{ source: 'allterrain-forms', action: 'trashed', ids: [ 12, 34 ] },
		] );
	} );

	test( 'a bare id is wrapped, and source defaults to empty', () => {
		const seen = capture( 'os.page.changed' );

		announceContentChange( 'page', 'untrashed', 7 );

		expect( seen ).toEqual( [ { source: '', action: 'untrashed', ids: [ 7 ] } ] );
	} );

	test( 'invalid ids are dropped; nothing valid means no broadcast', () => {
		const seen = capture( 'os.post.changed' );

		announceContentChange( 'post', 'deleted', [ 0, -3, NaN ] );
		announceContentChange( 'post', 'deleted', [] );
		announceContentChange( '', 'deleted', [ 5 ] );

		expect( seen ).toEqual( [] );

		announceContentChange( 'post', 'deleted', [ 0, 5 ] );

		expect( seen ).toEqual( [ { source: '', action: 'deleted', ids: [ 5 ] } ] );
	} );
} );
