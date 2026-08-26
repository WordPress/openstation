/**
 * The built-in link renderer must exist from boot.
 *
 * `svg-splines` registers itself as a load-time side effect of the lazy
 * visuals bundle, so before that bundle arrived the registry was empty.
 * Two things broke: `listWindowLinkRenderers()` contradicted its own
 * documented promise to "always include the built-in `svg-splines`",
 * and Preferences painted a blank "Link style" because the stored value
 * matched no option on offer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ensureVisuals from '../../src/window-links/ensure-visuals';
import {
	listWindowLinkRenderers,
	unregisterWindowLinkRenderer,
	registerWindowLinkRenderer,
} from '../../src/window-links/renderer-registry';
import {
	BUILT_IN_LINK_RENDERER,
	registerBuiltInLinkRendererStub,
} from '../../src/window-links/stub-renderer';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

function builtIn() {
	return listWindowLinkRenderers().find(
		( def ) => def.id === BUILT_IN_LINK_RENDERER,
	);
}

describe( 'built-in link renderer stub', () => {
	beforeEach( () => {
		// `listWindowLinkRenderers()` post-filters through `wp.hooks`.
		installHooksStub();
		unregisterWindowLinkRenderer( BUILT_IN_LINK_RENDERER );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		unregisterWindowLinkRenderer( BUILT_IN_LINK_RENDERER );
		clearHooksStub();
	} );

	it( 'is listed at boot, before the visuals bundle exists', () => {
		expect( builtIn() ).toBeUndefined();

		registerBuiltInLinkRendererStub();

		const def = builtIn();
		expect( def ).toBeDefined();
		expect( def?.label ).toBe( 'Splines' );
		expect( def?.description ).toBeTruthy();
	} );

	it( 'does not fetch the bundle just by being listed', () => {
		const spy = vi
			.spyOn( ensureVisuals, 'ensureWindowLinkVisuals' )
			.mockResolvedValue( true );

		registerBuiltInLinkRendererStub();

		expect( spy ).not.toHaveBeenCalled();
	} );

	it( 'yields to the real registration rather than overwriting it', () => {
		// The bundle may already have landed — a second call must not
		// clobber the real def with metadata-only.
		const realMount = vi.fn();
		registerWindowLinkRenderer( {
			id: BUILT_IN_LINK_RENDERER,
			label: 'Splines',
			mount: realMount,
		} );

		registerBuiltInLinkRendererStub();

		expect( builtIn()?.mount ).toBe( realMount );
	} );

	it( 'mounting pulls the bundle in and delegates to the real renderer', async () => {
		const realMount = vi.fn().mockReturnValue( undefined );
		vi.spyOn( ensureVisuals, 'ensureWindowLinkVisuals' ).mockImplementation(
			() => {
				// Standing in for the bundle's load-time registration,
				// which replaces the stub entry by id.
				registerWindowLinkRenderer( {
					id: BUILT_IN_LINK_RENDERER,
					label: 'Splines',
					mount: realMount,
				} );
				return Promise.resolve( true );
			},
		);
		registerBuiltInLinkRendererStub();
		const ctx = {} as never;

		await builtIn()?.mount( ctx );

		expect( realMount ).toHaveBeenCalledWith( ctx );
	} );

	it( 'a bundle that never arrives is a no-op, not a recursion', async () => {
		// If the swap does not happen, the stub must not call itself.
		vi.spyOn( ensureVisuals, 'ensureWindowLinkVisuals' ).mockResolvedValue(
			true,
		);
		registerBuiltInLinkRendererStub();

		await expect( builtIn()?.mount( {} as never ) ).resolves.toBeUndefined();
	} );

	it( 'a failed load is survivable', async () => {
		vi.spyOn( ensureVisuals, 'ensureWindowLinkVisuals' ).mockResolvedValue(
			false,
		);
		registerBuiltInLinkRendererStub();

		await expect( builtIn()?.mount( {} as never ) ).resolves.toBeUndefined();
	} );
} );
