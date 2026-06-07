/**
 * Unit tests for the pure helpers behind the right-click visibility
 * menu — the native-rail derivation and the "Hide from <surface>"
 * placement computation. `computeHideTarget` is the core correctness
 * fix for the "teleporting tile" bug, so it gets direct coverage here
 * rather than only through integration paths.
 */

import { describe, expect, test } from 'vitest';
import {
	railFromId,
	computeHideTarget,
} from '../../src/item-visibility-menu';

describe( 'railFromId', () => {
	test( 'derives the native rail from a synthesis prefix', () => {
		expect( railFromId( 'dock:edit-php', 'desktop' ) ).toBe( 'dock' );
		expect( railFromId( 'desktop:my-icon', 'dock' ) ).toBe( 'desktop' );
	} );

	test( 'a bare id is native to the surface it was clicked on', () => {
		expect( railFromId( 'woocommerce', 'dock' ) ).toBe( 'dock' );
		expect( railFromId( 'my-icon', 'desktop' ) ).toBe( 'desktop' );
	} );
} );

describe( 'computeHideTarget', () => {
	test( 'a both-rail item is demoted to the rail it is NOT hidden from', () => {
		expect(
			computeHideTarget( 'woo', 'dock', 'dock', { woo: 'both' } ),
		).toBe( 'desktop' );
		expect(
			computeHideTarget( 'mw', 'desktop', 'desktop', { mw: 'both' } ),
		).toBe( 'dock' );
	} );

	test( 'a single-rail item is genuinely hidden, not teleported', () => {
		// Regression guard: a dock-only tile (no override → resolves to
		// its native dock rail) hidden from the dock must become
		// 'hidden'. The pre-fix bug wrote 'desktop', so the tile
		// reappeared on the wallpaper instead of disappearing.
		expect( computeHideTarget( 'woo', 'dock', 'dock', {} ) ).toBe(
			'hidden',
		);
		expect(
			computeHideTarget( 'woo', 'dock', 'dock', { woo: 'dock' } ),
		).toBe( 'hidden' );
		// Symmetric case: a desktop-native icon hidden from the desktop.
		expect(
			computeHideTarget( 'my-icon', 'desktop', 'desktop', {} ),
		).toBe( 'hidden' );
		expect(
			computeHideTarget( 'my-icon', 'desktop', 'desktop', {
				'my-icon': 'desktop',
			} ),
		).toBe( 'hidden' );
	} );

	test( 'an explicit override is honored over the native rail', () => {
		// A desktop-native icon the user moved to the dock, then hides
		// from the dock → 'hidden' (it is no longer on the desktop).
		expect(
			computeHideTarget( 'my-icon', 'desktop', 'dock', {
				'my-icon': 'dock',
			} ),
		).toBe( 'hidden' );
	} );
} );
