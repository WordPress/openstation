/**
 * WordPress's own bulk actions, on a selection — the runners and the
 * two rules that make bulk edit correct: only changed fields are
 * written, and taxonomy terms are ADDED rather than replaced.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

const WINDOW_ID = 'desktop-mode-my-wordpress';

type BulkModule = typeof import( '../../src/my-wordpress/bulk-actions' );

const ENTITY = {
	id: 'posts',
	label: 'Posts',
	icon: 'dashicons-admin-post',
	restPath: 'wp/v2/posts',
	kind: 'post' as const,
	post_type: 'post',
};

interface Call {
	url: string;
	method: string;
	body: Record< string, unknown > | null;
}

let calls: Call[] = [];
let toasts: string[] = [];

/**
 * Route every REST call the module makes. Responses are the smallest
 * shape each consumer reads.
 */
function stubFetch(
	overrides: Record< string, () => Response > = {},
): void {
	vi.stubGlobal(
		'fetch',
		vi.fn( ( input: unknown, init: RequestInit = {} ) => {
			const url = String( input );
			calls.push( {
				url,
				method: init.method ?? 'GET',
				body: init.body
					? ( JSON.parse( String( init.body ) ) as Record<
							string,
							unknown
						> )
					: null,
			} );
			for ( const [ match, make ] of Object.entries( overrides ) ) {
				if ( url.includes( match ) ) {
					return Promise.resolve( make() );
				}
			}
			return Promise.resolve( json( [] ) );
		} ),
	);
}

function json( body: unknown, status = 200 ): Response {
	return new Response( JSON.stringify( body ), {
		status,
		headers: { 'Content-Type': 'application/json' },
	} );
}

async function load(): Promise< BulkModule > {
	vi.resetModules();
	calls = [];
	toasts = [];
	// `showToast()` announces itself on the activity bus before it
	// renders, and the render itself lives in the lazy overlay bundle
	// that never loads under jsdom. The intent is the observable.
	const { addFilter } = await import( '../../src/hooks' );
	// The channel's slash is sanitized to a dot on its way to
	// `wp.hooks` (see `hookName()` in `src/activity.ts`).
	addFilter(
		'os.activity.desktop-mode.toast-requested',
		'test/capture',
		( intent: { message?: string } ) => {
			toasts.push( String( intent?.message ?? '' ) );
			return intent;
		},
	);
	( window as unknown as {
		openStationWindowConfig?: Record< string, unknown >;
	} ).openStationWindowConfig = {
		[ WINDOW_ID ]: {
			restRoot: 'http://example.test/wp-json/',
			restNonce: 'nonce',
			siteName: 'Example',
			entities: [ ENTITY ],
			groups: [],
			perPage: 24,
			mediaPerPage: 48,
			previewActions: [],
		},
	};
	return await import( '../../src/my-wordpress/bulk-actions' );
}

/** Drive the modal that `bulkEditEntities` opens. */
async function withModal(
	fill: ( modal: HTMLElement ) => void,
	submit: 'Update' | 'Cancel' = 'Update',
): Promise< void > {
	await vi.waitFor( () => {
		if ( ! document.querySelector( 'os-modal' ) ) {
			throw new Error( 'modal not open yet' );
		}
	} );
	const modal = document.querySelector< HTMLElement >( 'os-modal' )!;
	fill( modal );
	const button = [
		...modal.querySelectorAll< HTMLElement >( 'os-button' ),
	].find( ( b ) => ( b.textContent ?? '' ).trim() === submit );
	button?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
}

function setSelect( modal: HTMLElement, label: string, value: string ): void {
	const row = [
		...modal.querySelectorAll< HTMLElement >( '.os-my-wordpress__bulk-row' ),
	].find(
		( r ) =>
			r.querySelector( '.os-my-wordpress__bulk-label' )?.textContent ===
			label,
	);
	const select = row?.querySelector< HTMLElement >( 'os-select' );
	select?.setAttribute( 'value', value );
}

describe( 'my-wordpress bulk actions', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	} );

	test( 'runBulk collects successes and failures without stopping', async () => {
		const mod = await load();
		const result = await mod.runBulk( [ 1, 2, 3 ], async ( id ) => {
			if ( id === 2 ) {
				throw new Error( 'nope' );
			}
		} );
		expect( result.succeeded ).toEqual( [ 1, 3 ] );
		expect( result.failed ).toBe( 1 );
		expect( result.firstError ).toBe( 'nope' );
	} );

	test( 'reportBulk names the failures', async () => {
		const mod = await load();
		mod.reportBulk(
			{ succeeded: [ 1, 3 ], failed: 1, firstError: 'nope' },
			'%d entry updated',
			'%d entries updated',
		);
		// The reason rides along — a partial failure is exactly the
		// case where the user can see something worked and otherwise
		// has no way to find out why the rest didn't.
		expect( toasts[ 0 ] ).toBe( '2 entries updated · 1 failed — nope' );
	} );

	test( 'reportBulk surfaces the server error when nothing succeeded', async () => {
		const mod = await load();
		mod.reportBulk(
			{ succeeded: [], failed: 2, firstError: 'Sorry, you are not allowed' },
			'%d entry updated',
			'%d entries updated',
		);
		expect( toasts[ 0 ] ).toBe( 'Sorry, you are not allowed' );
	} );

	test( 'bulkSetStatus posts the status to every id', async () => {
		const mod = await load();
		stubFetch();
		await mod.bulkSetStatus(
			ENTITY,
			[ { id: 11 }, { id: 12 } ] as never,
			'publish',
		);
		const writes = calls.filter( ( c ) => c.method === 'POST' );
		expect( writes ).toHaveLength( 2 );
		expect( writes[ 0 ].url ).toContain( 'wp/v2/posts/11' );
		expect( writes[ 0 ].body ).toEqual( { status: 'publish' } );
		expect( toasts[ 0 ] ).toBe( '2 entries updated' );
	} );

	test( 'bulk edit writes ONLY the fields the user changed', async () => {
		const mod = await load();
		stubFetch( {
			'wp/v2/posts?': () =>
				json( [
					{ id: 11, categories: [ 5 ], tags: [] },
					{ id: 12, categories: [], tags: [] },
				] ),
			'wp/v2/users': () => json( [ { id: 3, name: 'Ada' } ] ),
			'wp/v2/categories': () => json( [] ),
		} );

		const run = mod.bulkEditEntities( ENTITY, [
			{ id: 11 },
			{ id: 12 },
		] as never );
		await withModal( ( modal ) => setSelect( modal, 'Status', 'draft' ) );
		await run;

		const writes = calls.filter( ( c ) => c.method === 'POST' );
		expect( writes ).toHaveLength( 2 );
		// Author, comments and sticky were left on "— No change —", so
		// they are absent — not sent as undefined, not sent as the
		// first item's value.
		expect( writes[ 0 ].body ).toEqual( { status: 'draft' } );
		expect( writes[ 1 ].body ).toEqual( { status: 'draft' } );
	} );

	test( 'cancelling the modal writes nothing', async () => {
		const mod = await load();
		stubFetch( {
			'wp/v2/posts?': () => json( [ { id: 11, categories: [] } ] ),
			'wp/v2/users': () => json( [] ),
			'wp/v2/categories': () => json( [] ),
		} );
		const run = mod.bulkEditEntities( ENTITY, [ { id: 11 } ] as never );
		await withModal( () => undefined, 'Cancel' );
		expect( await run ).toEqual( [] );
		expect( calls.filter( ( c ) => c.method === 'POST' ) ).toHaveLength( 0 );
	} );

	test( 'a modal submitted with no changes writes nothing', async () => {
		const mod = await load();
		stubFetch( {
			'wp/v2/posts?': () => json( [ { id: 11, categories: [] } ] ),
			'wp/v2/users': () => json( [] ),
			'wp/v2/categories': () => json( [] ),
		} );
		const run = mod.bulkEditEntities( ENTITY, [ { id: 11 } ] as never );
		await withModal( () => undefined );
		expect( await run ).toEqual( [] );
		expect( calls.filter( ( c ) => c.method === 'POST' ) ).toHaveLength( 0 );
	} );

	test( 'categories are ADDED to each entry, not replaced', async () => {
		const mod = await load();
		stubFetch( {
			'wp/v2/posts?': () =>
				json( [
					{ id: 11, categories: [ 5, 6 ], tags: [] },
					{ id: 12, categories: [ 9 ], tags: [] },
				] ),
			'wp/v2/users': () => json( [] ),
			'wp/v2/categories': () =>
				json( [ { id: 7, name: 'News', parent: 0 } ] ),
		} );

		const run = mod.bulkEditEntities( ENTITY, [
			{ id: 11 },
			{ id: 12 },
		] as never );
		await withModal( ( modal ) => {
			const picker = modal.querySelector( 'os-category-picker' ) as
				HTMLElement & { value: number[] };
			picker.value = [ 7 ];
		} );
		await run;

		const writes = calls.filter( ( c ) => c.method === 'POST' );
		// Each post keeps its own terms and gains the picked one.
		expect( writes[ 0 ].body?.categories ).toEqual( [ 5, 6, 7 ] );
		expect( writes[ 1 ].body?.categories ).toEqual( [ 9, 7 ] );
	} );

	test( 'a post type without taxonomies renders no taxonomy controls', async () => {
		const mod = await load();
		stubFetch( {
			// No `categories` / `tags` keys at all — the REST response
			// for a post type that doesn't register them.
			'wp/v2/posts?': () => json( [ { id: 11 } ] ),
			'wp/v2/users': () => json( [] ),
		} );
		const run = mod.bulkEditEntities( ENTITY, [ { id: 11 } ] as never );
		await withModal( ( modal ) => {
			expect( modal.querySelector( 'os-category-picker' ) ).toBeNull();
			expect( modal.querySelector( 'os-tag-input' ) ).toBeNull();
		}, 'Cancel' );
		await run;
		// …and no request went out for a term list we'd never show.
		expect(
			calls.some( ( c ) => c.url.includes( 'wp/v2/categories' ) ),
		).toBe( false );
	} );

	test( 'sticky is offered for posts and withheld from other types', async () => {
		const mod = await load();
		stubFetch( {
			'wp/v2/posts?': () => json( [ { id: 11 } ] ),
			'wp/v2/users': () => json( [] ),
		} );
		const run = mod.bulkEditEntities( ENTITY, [ { id: 11 } ] as never );
		await withModal( ( modal ) => {
			const labels = [
				...modal.querySelectorAll( '.os-my-wordpress__bulk-label' ),
			].map( ( n ) => n.textContent );
			expect( labels ).toContain( 'Sticky' );
		}, 'Cancel' );
		await run;

		const page = { ...ENTITY, id: 'pages', post_type: 'page' };
		const run2 = mod.bulkEditEntities( page, [ { id: 11 } ] as never );
		await withModal( ( modal ) => {
			const labels = [
				...modal.querySelectorAll( '.os-my-wordpress__bulk-label' ),
			].map( ( n ) => n.textContent );
			expect( labels ).not.toContain( 'Sticky' );
		}, 'Cancel' );
		await run2;
	} );

	test( 'the additive merge re-reads terms after the modal closes', async () => {
		// The pre-modal snapshot is taken before a dialog that stays
		// open for as long as the user takes. The merge is additive, so
		// a stale `existing` silently deletes any term somebody else
		// added while they were thinking.
		const mod = await load();
		let reads = 0;
		stubFetch( {
			'wp/v2/posts?': () => {
				reads += 1;
				// A collaborator adds term 9 while the modal is open.
				return json( [
					{ id: 11, categories: reads === 1 ? [ 4 ] : [ 4, 9 ] },
				] );
			},
			'wp/v2/users': () => json( [] ),
			'wp/v2/categories': () =>
				json( [ { id: 7, name: 'News', parent: 0 } ] ),
		} );

		const run = mod.bulkEditEntities( ENTITY, [ { id: 11 } ] as never );
		await withModal( ( modal ) => {
			const picker = modal.querySelector( 'os-category-picker' ) as
				HTMLElement & { value: number[] };
			picker.value = [ 7 ];
		} );
		await run;

		expect( reads ).toBe( 2 );
		const writes = calls.filter( ( c ) => c.method === 'POST' );
		// 9 survives because the merge used the post-modal read.
		expect( writes[ 0 ].body?.categories ).toEqual( [ 4, 9, 7 ] );
	} );

	test( 'no taxonomy change means no second read', async () => {
		const mod = await load();
		let reads = 0;
		stubFetch( {
			'wp/v2/posts?': () => {
				reads += 1;
				return json( [ { id: 11, categories: [ 4 ] } ] );
			},
			'wp/v2/users': () => json( [] ),
			'wp/v2/categories': () => json( [] ),
		} );
		const run = mod.bulkEditEntities( ENTITY, [ { id: 11 } ] as never );
		await withModal( ( modal ) => setSelect( modal, 'Status', 'draft' ) );
		await run;
		expect( reads ).toBe( 1 );
	} );

	test( 'a partial failure says WHY, not just how many', async () => {
		const mod = await load();
		mod.reportBulk(
			{
				succeeded: [ 1 ],
				failed: 1,
				firstError: 'Sorry, you are not allowed to edit this post.',
			},
			'%d entry updated',
			'%d entries updated',
		);
		expect( toasts[ 0 ] ).toBe(
			'1 entry updated · 1 failed — Sorry, you are not allowed to edit this post.',
		);
	} );

	test( 'a viewer refused the edit context still gets a bulk edit', async () => {
		const mod = await load();
		let firstRead = true;
		stubFetch( {
			'wp/v2/posts?': () => {
				if ( firstRead ) {
					firstRead = false;
					// What the collection endpoint answers a viewer who
					// may not edit this post type at all.
					return json( { code: 'rest_forbidden_context' }, 403 );
				}
				return json( [ { id: 11, categories: [ 4 ] } ] );
			},
			'wp/v2/users': () => json( [] ),
			'wp/v2/categories': () =>
				json( [ { id: 7, name: 'News', parent: 0 } ] ),
		} );

		const run = mod.bulkEditEntities( ENTITY, [ { id: 11 } ] as never );
		await withModal( ( modal ) => {
			const picker = modal.querySelector( 'os-category-picker' ) as
				HTMLElement & { value: number[] };
			picker.value = [ 7 ];
		} );
		await run;

		const reads = calls.filter(
			( c ) => c.method === 'GET' && c.url.includes( 'wp/v2/posts?' ),
		);
		expect( reads[ 0 ].url ).toContain( 'context=edit' );
		expect( reads[ 1 ].url ).toContain( 'context=view' );
		// …and the merge still used the terms it read back.
		const writes = calls.filter( ( c ) => c.method === 'POST' );
		expect( writes[ 0 ].body?.categories ).toEqual( [ 4, 7 ] );
	} );

	test( 'entity actions expose Edit / Publish / Switch to Draft', async () => {
		const mod = await load();
		const draft = mod.entityBulkActions(
			{ entity: ENTITY, onChanged: () => undefined },
			{ id: 11, status: 'draft' } as never,
		);
		// A draft can be published but is already a draft.
		expect( draft.map( ( a ) => a.id ) ).toEqual( [
			'bulk-edit',
			'publish',
		] );

		const published = mod.entityBulkActions(
			{ entity: ENTITY, onChanged: () => undefined },
			{ id: 12, status: 'publish' } as never,
		);
		expect( published.map( ( a ) => a.id ) ).toEqual( [
			'bulk-edit',
			'to-draft',
		] );
		// Every one of them is multi-safe and carries a batched runner.
		for ( const action of [ ...draft, ...published ] ) {
			expect( action.multi ).toBe( true );
			expect( typeof action.bulk ).toBe( 'function' );
		}
	} );

	test( 'media Detach clears the parent, and only shows for attached files', async () => {
		const mod = await load();
		stubFetch();
		const attached = mod.mediaBulkActions(
			{ onChanged: () => undefined },
			{ id: 21, post: 5 } as never,
		);
		expect( attached.map( ( a ) => a.id ) ).toEqual( [ 'detach' ] );

		const loose = mod.mediaBulkActions(
			{ onChanged: () => undefined },
			{ id: 22, post: 0 } as never,
		);
		expect( loose ).toEqual( [] );

		await attached[ 0 ].bulk!( [
			{ id: 21 },
			{ id: 23 },
		] as never );
		const writes = calls.filter( ( c ) => c.method === 'POST' );
		expect( writes ).toHaveLength( 2 );
		expect( writes[ 0 ].body ).toEqual( { post: 0 } );
		expect( toasts[ 0 ] ).toBe( '2 files detached' );
	} );

	test( 'deleting users asks what happens to their content', async () => {
		const mod = await load();
		stubFetch( { 'wp/v2/users': () => json( [ { id: 3, name: 'Ada' } ] ) } );
		const removed: number[][] = [];
		const actions = mod.userBulkActions(
			{ onChanged: () => undefined, onRemoved: ( ids ) => removed.push( ids ) },
			{ id: 7 } as never,
		);
		const del = actions.find( ( a ) => a.id === 'delete-user' )!;

		const run = del.bulk!( [ { id: 7 }, { id: 8 } ] as never );
		await withModal( ( modal ) => {
			const labels = [
				...modal.querySelectorAll( 'os-option' ),
			].map( ( n ) => n.textContent );
			// Core's two answers: delete the content, or reassign it.
			expect( labels ).toContain( 'Delete all their content' );
			expect( labels ).toContain( 'Attribute all content to Ada' );
			setSelect( modal, 'Their content', '3' );
		}, 'Delete' );
		await run;

		const deletes = calls.filter( ( c ) => c.method === 'DELETE' );
		expect( deletes ).toHaveLength( 2 );
		expect( deletes[ 0 ].url ).toContain( 'force=true' );
		expect( deletes[ 0 ].url ).toContain( 'reassign=3' );
		expect( removed[ 0 ] ).toEqual( [ 7, 8 ] );
	} );

	test( 'change role posts the picked role to every user', async () => {
		const mod = await load();
		stubFetch();
		(
			window as unknown as {
				openStationConfig?: Record< string, unknown >;
			}
		).openStationConfig = {
			shareEligibleRoles: [ { slug: 'editor', name: 'Editor' } ],
		};
		const actions = mod.userBulkActions(
			{ onChanged: () => undefined, onRemoved: () => undefined },
			{ id: 7 } as never,
		);
		const role = actions.find( ( a ) => a.id === 'change-role' )!;
		const run = role.bulk!( [ { id: 7 }, { id: 8 } ] as never );
		await withModal(
			( modal ) => setSelect( modal, 'New role', 'editor' ),
			'Change role',
		);
		await run;

		const writes = calls.filter( ( c ) => c.method === 'POST' );
		expect( writes ).toHaveLength( 2 );
		expect( writes[ 0 ].body ).toEqual( { roles: [ 'editor' ] } );
		expect( toasts[ 0 ] ).toBe( '2 users updated' );
	} );

	test( 'copy links puts one URL per line on the clipboard', async () => {
		const mod = await load();
		const writeText = vi.fn( async () => undefined );
		vi.stubGlobal( 'navigator', { clipboard: { writeText } } );
		await mod.copyLinks(
			[ { link: 'https://a.test/1' }, { link: '' }, { link: 'https://a.test/2' } ],
			( i ) => i.link,
		);
		expect( writeText ).toHaveBeenCalledWith(
			'https://a.test/1\nhttps://a.test/2',
		);
		expect( toasts[ 0 ] ).toBe( '2 links copied.' );
	} );

	test( 'copy links explains itself when the clipboard is unreachable', async () => {
		const mod = await load();
		vi.stubGlobal( 'navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error( 'denied' );
				},
			},
		} );
		await mod.copyLinks( [ { link: 'https://a.test/1' } ], ( i ) => i.link );
		expect( toasts[ 0 ] ).toContain( 'secure (https) connection' );
	} );
} );
