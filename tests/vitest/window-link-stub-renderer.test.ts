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
