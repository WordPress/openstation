/**
 * Tests for `resolveCommonActions` — the rule that decides what a
 * mixed selection is allowed to offer.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { SelectionAction } from '../../src/selection/actions';

async function load() {
	vi.resetModules();
	return await import( '../../src/selection/actions' );
}

interface Item {
	id: number;
	type: 'post' | 'attachment' | 'folder';
}

const post: Item = { id: 1, type: 'post' };
const attachment: Item = { id: 2, type: 'attachment' };
const folder: Item = { id: 3, type: 'folder' };

/**
 * Action lists modelled on the real file-tile menu: everything can be
 * opened and trashed; only posts navigate-into; only folders rename;
 * only attachments download.
 */
function actionsFor( item: Item ): SelectionAction< Item >[] {
	const list: SelectionAction< Item >[] = [
		{
			id: 'open',
			label: 'Open',
			sort: 10,
			multi: true,
			onClick: vi.fn(),
		},
	];
	if ( item.type === 'post' ) {
		list.push( {
			id: 'navigate-into',
			label: 'Navigate into',
			sort: 20,
			onClick: vi.fn(),
		} );
	}
	if ( item.type === 'folder' ) {
		list.push( {
			id: 'rename-folder',
			label: 'Rename…',
			sort: 30,
			onClick: vi.fn(),
		} );
		list.push( {
			id: 'delete-folder',
			multiId: 'trash',
			label: 'Move folder to Trash',
			sort: 90,
			danger: true,
			multi: true,
			bulkLabel: ( n ) => `Move ${ n } items to Trash`,
			onClick: vi.fn(),
		} );
	} else {
		list.push( {
			id: 'remove',
			multiId: 'trash',
			label: 'Move to Trash',
			sort: 90,
			danger: true,
			multi: true,
			bulkLabel: ( n ) => `Move ${ n } items to Trash`,
			onClick: vi.fn(),
		} );
	}
	if ( item.type === 'attachment' ) {
		list.push( {
			id: 'download',
			label: 'Download',
			sort: 40,
			onClick: vi.fn(),
		} );
	}
	return list;
}

describe( 'resolveCommonActions', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'an empty selection has no actions', async () => {
		const { resolveCommonActions } = await load();
		expect( resolveCommonActions( [], actionsFor ) ).toEqual( [] );
	} );

	test( 'a single item gets its own list, untouched', async () => {
		const { resolveCommonActions } = await load();
		const own = actionsFor( post );
		const resolved = resolveCommonActions( [ post ], () => own );
		// Same array identity: the single-item menu is exactly what
		// the surface built, with no relabelling and no filtering.
		expect( resolved ).toBe( own );
		expect( resolved.map( ( a ) => a.label ) ).toEqual( [
			'Open',
			'Navigate into',
			'Move to Trash',
		] );
	} );

	test( 'a post + an attachment keep only what both offer', async () => {
		const { resolveCommonActions } = await load();
		const resolved = resolveCommonActions(
			[ post, attachment ],
			actionsFor,
		);
		expect( resolved.map( ( a ) => a.id ) ).toEqual( [ 'open', 'trash' ] );
		// Navigate-into is post-only; download is attachment-only.
		expect( resolved.find( ( a ) => a.id === 'navigate-into' ) ).toBeUndefined();
		expect( resolved.find( ( a ) => a.id === 'download' ) ).toBeUndefined();
	} );

	test( 'multiId merges the folder and file trash entries', async () => {
		const { resolveCommonActions } = await load();
		const resolved = resolveCommonActions( [ folder, post ], actionsFor );
		const trash = resolved.find( ( a ) => a.id === 'trash' );
		expect( trash ).toBeDefined();
		expect( trash?.label ).toBe( 'Move 2 items to Trash' );
		expect( trash?.danger ).toBe( true );
		// Rename is folder-only and never reaches a mixed set.
		expect( resolved.find( ( a ) => a.id === 'rename-folder' ) ).toBeUndefined();
	} );

	test( 'an action without multi never reaches a multi-selection', async () => {
		const { resolveCommonActions } = await load();
		const single = ( item: Item ): SelectionAction< Item >[] => [
			{ id: 'shared', label: 'Shared', onClick: vi.fn() },
			{ id: 'both', label: 'Both', multi: true, onClick: vi.fn() },
			...( item.id === 1 ? [] : [] ),
		];
		const resolved = resolveCommonActions( [ post, attachment ], single );
		expect( resolved.map( ( a ) => a.id ) ).toEqual( [ 'both' ] );
	} );

	test( 'one non-multi contributor disqualifies the whole id', async () => {
		const { resolveCommonActions } = await load();
		const mixed = ( item: Item ): SelectionAction< Item >[] => [
			{
				id: 'act',
				label: 'Act',
				multi: item.type === 'post',
				onClick: vi.fn(),
			},
		];
		expect(
			resolveCommonActions( [ post, attachment ], mixed ),
		).toEqual( [] );
	} );

	test( 'default bulk label falls back to "<label> (N items)"', async () => {
		const { resolveCommonActions } = await load();
		const resolved = resolveCommonActions(
			[ post, attachment ],
			actionsFor,
		);
		expect( resolved.find( ( a ) => a.id === 'open' )?.label ).toBe(
			'Open (2 items)',
		);
	} );

	test( 'disabled and danger take the least-forgiving contributor', async () => {
		const { resolveCommonActions } = await load();
		const build = ( item: Item ): SelectionAction< Item >[] => [
			{
				id: 'act',
				label: 'Act',
				multi: true,
				sort: item.id === 1 ? 50 : 10,
				disabled: item.id === 2,
				danger: item.id === 2,
				onClick: vi.fn(),
			},
		];
		const [ action ] = resolveCommonActions( [ post, attachment ], build );
		expect( action.disabled ).toBe( true );
		expect( action.danger ).toBe( true );
		// Sort takes the minimum so the merged entry sits where the
		// earliest contributor would have put it.
		expect( action.sort ).toBe( 10 );
	} );

	test( 'a bulk runner is called once with the whole set', async () => {
		const { resolveCommonActions } = await load();
		const bulk = vi.fn();
		const perItem = vi.fn();
		const build = (): SelectionAction< Item >[] => [
			{ id: 'act', label: 'Act', multi: true, bulk, onClick: perItem },
		];
		const [ action ] = resolveCommonActions(
			[ post, attachment ],
			build,
		);
		await action.onClick( new MouseEvent( 'click' ) );
		expect( bulk ).toHaveBeenCalledTimes( 1 );
		expect( bulk.mock.calls[ 0 ][ 0 ] ).toEqual( [ post, attachment ] );
		expect( perItem ).not.toHaveBeenCalled();
	} );

	test( 'without a bulk runner it fans out to each item’s own handler', async () => {
		const { resolveCommonActions } = await load();
		const calls: number[] = [];
		const build = ( item: Item ): SelectionAction< Item >[] => [
			{
				id: 'act',
				label: 'Act',
				multi: true,
				onClick: () => {
					calls.push( item.id );
				},
			},
		];
		const [ action ] = resolveCommonActions(
			[ post, attachment, folder ],
			build,
		);
		await action.onClick( new MouseEvent( 'click' ) );
		// Each contributor's OWN closure ran, in order.
		expect( calls ).toEqual( [ 1, 2, 3 ] );
	} );

	test( 'one throwing handler does not abort the rest of the fan-out', async () => {
		const spy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => undefined );
		const { resolveCommonActions } = await load();
		const calls: number[] = [];
		const build = ( item: Item ): SelectionAction< Item >[] => [
			{
				id: 'act',
				label: 'Act',
				multi: true,
				onClick: () => {
					if ( item.id === 1 ) {
						throw new Error( 'boom' );
					}
					calls.push( item.id );
				},
			},
		];
		const [ action ] = resolveCommonActions( [ post, attachment ], build );
		await action.onClick( new MouseEvent( 'click' ) );
		expect( calls ).toEqual( [ 2 ] );
		spy.mockRestore();
	} );

	test( 'the os.selection.actions filter can extend a multi-selection', async () => {
		const { resolveCommonActions } = await load();
		const { addFilter } = await import( '../../src/hooks' );
		addFilter(
			'os.selection.actions',
			'test/extra',
			( actions: SelectionAction< Item >[], ctx: { count: number } ) => [
				...actions,
				{
					id: 'extra',
					label: `Extra for ${ ctx.count }`,
					onClick: vi.fn(),
				},
			],
		);
		const resolved = resolveCommonActions(
			[ post, attachment ],
			actionsFor,
		);
		expect( resolved.find( ( a ) => a.id === 'extra' )?.label ).toBe(
			'Extra for 2',
		);
	} );

	test( 'the filter does not run for a single selection', async () => {
		const { resolveCommonActions } = await load();
		const { addFilter } = await import( '../../src/hooks' );
		const spy = vi.fn( ( actions: SelectionAction< Item >[] ) => actions );
		addFilter( 'os.selection.actions', 'test/spy', spy );
		resolveCommonActions( [ post ], actionsFor );
		expect( spy ).not.toHaveBeenCalled();
	} );
} );
