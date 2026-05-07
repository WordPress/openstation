import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import {
	getCurrentLayout,
	setCurrentLayout,
	subscribeLayout,
} from '../../src/layout';

afterEach( () => {
	_resetAllSharedStoresForTests();
} );

describe( '@layout', () => {
	it( 'defaults to classic before the shell publishes', () => {
		expect( getCurrentLayout() ).toBe( 'classic' );
	} );

	it( 'setCurrentLayout writes and reads', () => {
		setCurrentLayout( 'spatial' );
		expect( getCurrentLayout() ).toBe( 'spatial' );
	} );

	it( 'subscribers fire on change', () => {
		const cb = vi.fn();
		subscribeLayout( cb );
		setCurrentLayout( 'unified' );
		expect( cb ).toHaveBeenCalledWith( 'unified' );
	} );

	it( 'no-op when value is unchanged', () => {
		setCurrentLayout( 'unified' );
		const cb = vi.fn();
		subscribeLayout( cb );
		setCurrentLayout( 'unified' );
		expect( cb ).not.toHaveBeenCalled();
	} );

	it( 'unsubscribe stops the callback', () => {
		const cb = vi.fn();
		const off = subscribeLayout( cb );
		off();
		setCurrentLayout( 'spatial' );
		expect( cb ).not.toHaveBeenCalled();
	} );
} );
