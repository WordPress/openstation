import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	_resetDeprecationWarningsForTests,
	installDeprecatedAlias,
} from '../../src/api/deprecated';

afterEach( () => {
	_resetDeprecationWarningsForTests();
} );

describe( 'installDeprecatedAlias', () => {
	it( 'forwards calls to the canonical method', () => {
		const target: Record< string, unknown > = {
			newName: vi.fn().mockReturnValue( 42 ),
		};
		installDeprecatedAlias( target, 'oldName', 'newName' );
		const out = ( target.oldName as ( ...a: unknown[] ) => unknown )( 'arg' );
		expect( out ).toBe( 42 );
		expect( target.newName ).toHaveBeenCalledWith( 'arg' );
	} );

	it( 'warns exactly once across multiple calls', () => {
		const target: Record< string, unknown > = {
			newName: () => {},
		};
		installDeprecatedAlias( target, 'oldName', 'newName' );
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		( target.oldName as ( ...a: unknown[] ) => unknown )();
		( target.oldName as ( ...a: unknown[] ) => unknown )();
		( target.oldName as ( ...a: unknown[] ) => unknown )();
		expect( warn ).toHaveBeenCalledTimes( 1 );
		expect( warn.mock.calls[ 0 ][ 0 ] ).toContain( 'oldName' );
		expect( warn.mock.calls[ 0 ][ 0 ] ).toContain( 'newName' );
		warn.mockRestore();
	} );

	it( 'includes the hint when provided', () => {
		const target: Record< string, unknown > = { newName: () => {} };
		installDeprecatedAlias(
			target,
			'oldName',
			'newName',
			'will be removed in 2.0',
		);
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		( target.oldName as ( ...a: unknown[] ) => unknown )();
		expect( warn.mock.calls[ 0 ][ 0 ] ).toContain( 'will be removed in 2.0' );
		warn.mockRestore();
	} );

	it( 'throws if the canonical method is missing when called', () => {
		const target: Record< string, unknown > = {};
		installDeprecatedAlias( target, 'oldName', 'newName' );
		expect( () =>
			( target.oldName as ( ...a: unknown[] ) => unknown )(),
		).toThrow( /not available/ );
	} );
} );
