/**
 * Phase-7 helpers — recycle-bin → desktop pinning.
 *
 * The full handler is DOM-driven and runs inside the recycle-bin
 * window's render callback; what's worth unit-testing is the
 * recycle-type → file-type mapping that decides which Files
 * registry slug to send to `POST /files/placements`.
 */
import { describe, expect, test } from 'vitest';
import { mapRecycleTypeToFileType } from '../../src/recycle-bin/table-visuals';

describe( 'mapRecycleTypeToFileType', () => {
	test( 'attachment maps to attachment', () => {
		expect( mapRecycleTypeToFileType( 'attachment' ) ).toBe( 'attachment' );
	} );

	test( 'comment maps to comment', () => {
		expect( mapRecycleTypeToFileType( 'comment' ) ).toBe( 'comment' );
	} );

	test( 'every other post type collapses to post', () => {
		expect( mapRecycleTypeToFileType( 'post' ) ).toBe( 'post' );
		expect( mapRecycleTypeToFileType( 'page' ) ).toBe( 'post' );
		expect( mapRecycleTypeToFileType( 'product' ) ).toBe( 'post' );
		expect( mapRecycleTypeToFileType( '' ) ).toBe( 'post' );
	} );
} );
