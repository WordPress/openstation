/**
 * Unit tests for the window actions-menu registry.
 *
 * The registry's job is to let a plugin put a row in every window's ⋯
 * menu without the shell knowing what the row means. Two properties
 * carry most of the weight: the label / icon / visibility resolvers are
 * read fresh on every menu open (so one row can express a toggle), and
 * a plugin throwing inside one of them must not take the menu down —
 * the ⋯ menu is shared surface, and the user's "Reload" lives there.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	isActionChecked,
	isActionVisible,
	listWindowActions,
	registerWindowAction,
	resolveActionIcon,
	resolveActionLabel,
	subscribeWindowActions,
	unregisterWindowAction,
	unregisterWindowActionsByOwner,
} from '../../src/window-actions/registry';
import type { WindowActionDef } from '../../src/window-actions/registry';
import type { Window as DesktopWindow } from '../../src/window';

/** A window double — the registry only ever reads what a def reads. */
const WIN = { id: 'edit-php', config: { native: false } } as unknown as DesktopWindow;

/**
 * @param over Fields to override on a minimal valid def.
 */
function def( over: Partial< WindowActionDef > = {} ): WindowActionDef {
	return {
		id: 'test/action',
		label: 'Do the thing',
		onSelect: () => {},
		...over,
	} as WindowActionDef;
}

afterEach( () => {
	for ( const entry of listWindowActions() ) {
		unregisterWindowAction( entry.id );
	}
} );

describe( 'registration', () => {
	test( 'registers and lists an action', () => {
		registerWindowAction( def() );
		expect( listWindowActions().map( ( a ) => a.id ) ).toEqual( [ 'test/action' ] );
	} );

	test( 're-registering the same id replaces rather than duplicates', () => {
		registerWindowAction( def( { label: 'First' } ) );
		registerWindowAction( def( { label: 'Second' } ) );

		const all = listWindowActions();
		expect( all ).toHaveLength( 1 );
		expect( all[ 0 ].label ).toBe( 'Second' );
	} );

	test( 'lowercases the id so lookups are predictable', () => {
		registerWindowAction( def( { id: 'Test/Action' } ) );
		expect( listWindowActions()[ 0 ].id ).toBe( 'test/action' );
	} );

	test( 'sorts by order, defaulting to 100', () => {
		registerWindowAction( def( { id: 'a', order: 200 } ) );
		registerWindowAction( def( { id: 'b', order: 10 } ) );
		registerWindowAction( def( { id: 'c' } ) );

		expect( listWindowActions().map( ( a ) => a.id ) ).toEqual( [ 'b', 'c', 'a' ] );
	} );

	test( 'unregisters by id', () => {
		registerWindowAction( def() );
		unregisterWindowAction( 'test/action' );
		expect( listWindowActions() ).toHaveLength( 0 );
	} );

	test( 'unregisters everything a departing plugin owned', () => {
		registerWindowAction( def( { id: 'mine/one', owner: 'my-plugin' } ) );
		registerWindowAction( def( { id: 'mine/two', owner: 'my-plugin' } ) );
		registerWindowAction( def( { id: 'theirs/one', owner: 'other-plugin' } ) );

		expect( unregisterWindowActionsByOwner( 'my-plugin' ) ).toBe( 2 );
		expect( listWindowActions().map( ( a ) => a.id ) ).toEqual( [ 'theirs/one' ] );
	} );

	test( 'unregistering an unknown owner removes nothing', () => {
		registerWindowAction( def() );
		expect( unregisterWindowActionsByOwner( 'nobody' ) ).toBe( 0 );
		expect( unregisterWindowActionsByOwner( '' ) ).toBe( 0 );
		expect( listWindowActions() ).toHaveLength( 1 );
	} );
} );

describe( 'validation', () => {
	test( 'rejects a missing id', () => {
		expect( () => registerWindowAction( def( { id: '' } ) ) ).toThrow();
	} );

	test( 'rejects an id outside the slug shape', () => {
		expect( () => registerWindowAction( def( { id: 'Not A Slug!' } ) ) ).toThrow();
	} );

	test( 'rejects a missing or empty label', () => {
		expect( () => registerWindowAction( def( { label: '' } ) ) ).toThrow();
		expect( () =>
			registerWindowAction( def( { label: undefined as unknown as string } ) ),
		).toThrow();
	} );

	test( 'rejects a missing onSelect', () => {
		expect( () =>
			registerWindowAction( def( { onSelect: undefined as never } ) ),
		).toThrow();
	} );

	test( 'rejects a non-function isVisible', () => {
		expect( () =>
			registerWindowAction( def( { isVisible: true as never } ) ),
		).toThrow();
	} );

	test( 'accepts a function label — the shape a toggle needs', () => {
		expect( () =>
			registerWindowAction( def( { label: () => 'Computed' } ) ),
		).not.toThrow();
	} );

	test( 'rejects checkable without a checked reader', () => {
		// A checkbox nobody can ask renders permanently unticked, which
		// reads as broken persistence in the plugin rather than a
		// missing field here.
		expect( () =>
			registerWindowAction( def( { checkable: true } ) ),
		).toThrow();
	} );

	test( 'rejects a non-function checked', () => {
		expect( () =>
			registerWindowAction( def( { checked: true as never } ) ),
		).toThrow();
	} );

	test( 'accepts a complete checkbox row', () => {
		expect( () =>
			registerWindowAction(
				def( { checkable: true, checked: () => true } ),
			),
		).not.toThrow();
	} );
} );

describe( 'resolvers', () => {
	test( 'a string label passes through', () => {
		expect( resolveActionLabel( def( { label: 'Plain' } ), WIN ) ).toBe( 'Plain' );
	} );

	test( 'a function label is called with the window', () => {
		const label = vi.fn( ( w: DesktopWindow ) => `Free ${ w.id }` );
		expect( resolveActionLabel( def( { label } ), WIN ) ).toBe( 'Free edit-php' );
		expect( label ).toHaveBeenCalledWith( WIN );
	} );

	test( 'a throwing label resolves to empty rather than breaking the menu', () => {
		const throwing = () => {
			throw new Error( 'boom' );
		};
		expect( resolveActionLabel( def( { label: throwing } ), WIN ) ).toBe( '' );
	} );

	test( 'icon is optional and resolves the same way', () => {
		expect( resolveActionIcon( def(), WIN ) ).toBe( '' );
		expect( resolveActionIcon( def( { icon: 'dashicons-desktop' } ), WIN ) ).toBe(
			'dashicons-desktop',
		);
		expect(
			resolveActionIcon( def( { icon: () => 'dashicons-star-filled' } ), WIN ),
		).toBe( 'dashicons-star-filled' );
	} );

	test( 'a throwing icon resolves to no glyph', () => {
		const throwing = () => {
			throw new Error( 'boom' );
		};
		expect( resolveActionIcon( def( { icon: throwing } ), WIN ) ).toBe( '' );
	} );
} );

describe( 'visibility', () => {
	test( 'an action with no predicate shows on every window', () => {
		expect( isActionVisible( def(), WIN ) ).toBe( true );
	} );

	test( 'the predicate decides, and receives the window', () => {
		const isVisible = vi.fn( ( w: DesktopWindow ) => ! w.config.native );
		expect( isActionVisible( def( { isVisible } ), WIN ) ).toBe( true );
		expect( isVisible ).toHaveBeenCalledWith( WIN );

		const native = { id: 'os-files', config: { native: true } } as unknown as DesktopWindow;
		expect( isActionVisible( def( { isVisible } ), native ) ).toBe( false );
	} );

	test( 'a throwing predicate hides the row rather than breaking the menu', () => {
		// One plugin's bug must not cost the user their "Reload".
		const isVisible = () => {
			throw new Error( 'boom' );
		};
		expect( isActionVisible( def( { isVisible } ), WIN ) ).toBe( false );
	} );
} );

describe( 'check state', () => {
	test( 'a verb row is never checked', () => {
		expect( isActionChecked( def( { checked: () => true } ), WIN ) ).toBe(
			false,
		);
	} );

	test( 'the reader decides, and receives the window', () => {
		const checked = vi.fn( ( w: DesktopWindow ) => w.id === 'edit-php' );
		expect(
			isActionChecked( def( { checkable: true, checked } ), WIN ),
		).toBe( true );
		expect( checked ).toHaveBeenCalledWith( WIN );
	} );

	test( 'a throwing reader paints unchecked rather than dropping the row', () => {
		// Losing the indicator is recoverable on the next open; losing
		// the row is not.
		const checked = () => {
			throw new Error( 'boom' );
		};
		expect(
			isActionChecked( def( { checkable: true, checked } ), WIN ),
		).toBe( false );
	} );

	test( 'the reader is re-read, never cached', () => {
		let on = false;
		const entry = def( { checkable: true, checked: () => on } );
		expect( isActionChecked( entry, WIN ) ).toBe( false );
		on = true;
		expect( isActionChecked( entry, WIN ) ).toBe( true );
	} );
} );

describe( 'subscribers', () => {
	test( 'fire on register and unregister', () => {
		const listener = vi.fn();
		const off = subscribeWindowActions( listener );

		registerWindowAction( def() );
		expect( listener ).toHaveBeenCalledTimes( 1 );

		unregisterWindowAction( 'test/action' );
		expect( listener ).toHaveBeenCalledTimes( 2 );

		off();
		registerWindowAction( def() );
		expect( listener ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'do not fire when unregistering something that was not there', () => {
		const listener = vi.fn();
		const off = subscribeWindowActions( listener );
		unregisterWindowAction( 'never/registered' );
		expect( listener ).not.toHaveBeenCalled();
		off();
	} );

	test( 'a throwing subscriber does not stop the others repainting', () => {
		const good = vi.fn();
		const offBad = subscribeWindowActions( () => {
			throw new Error( 'boom' );
		} );
		const offGood = subscribeWindowActions( good );

		expect( () => registerWindowAction( def() ) ).not.toThrow();
		expect( good ).toHaveBeenCalled();

		offBad();
		offGood();
	} );
} );
