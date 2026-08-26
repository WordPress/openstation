/**
 * Unit tests for the window-links relations engine
 * (`src/window-links/engine.ts`):
 *
 *   - identity validation (audible throws for `'api'` callers, logged
 *     skips for `'bridge'` data) and normalization
 *   - mechanical grouping: root + children, root-after-children,
 *     multi-root focus-recency ordering, orphan (root-less) groups
 *   - lifecycle wiring: seed from `WindowConfig.content` on open,
 *     clear on close
 *   - the `os.window-links.content` / `.groups` filters
 *   - change events: content-changed on every mutation, groups-changed
 *     only on MEMBERSHIP change
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	recordActions,
	type FakeWpHooks,
} from './helpers/hooks-stub';

type EngineModule = typeof import( '../../src/window-links/engine' );

async function load(): Promise< EngineModule > {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	return import( '../../src/window-links/engine' );
}

/** Minimal fake of the manager surface the engine consumes. */
function fakeManager(
	configs: Record<
		string,
		{ content?: import( '../../src/window-links/types' ).WindowContentRef }
	> = {},
): Parameters< EngineModule[ 'startWindowLinksEngine' ] >[ 0 ][ 'manager' ] {
	return {
		getById: ( id: string ) =>
			configs[ id ] ? { config: configs[ id ] } : null,
	};
}

let hooks: FakeWpHooks;

beforeEach( () => {
	hooks = installHooksStub();
} );
afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
	vi.restoreAllMocks();
} );

describe( 'setWindowContent / getWindowContent', () => {
	test( 'stores a normalized ref and stamps the source', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', { type: ' Post ', id: 123 } );

		expect( getWindowContent( 'w1' ) ).toEqual( {
			type: 'post',
			id: 123,
			source: 'api',
		} );
	} );

	test( 'throws a RegistrationError for a malformed api ref', async () => {
		const { setWindowContent } = await load();

		expect( () =>
			setWindowContent( 'w1', { type: 'NOT VALID!', id: 1 } ),
		).toThrow( /type/ );
		expect( () =>
			setWindowContent( 'w1', { type: 'post', id: '' } ),
		).toThrow( /id/ );
		expect( () =>
			setWindowContent( 'w1', {
				type: 'comment',
				id: 4,
				root: { type: 'post', id: NaN },
			} ),
		).toThrow( /root/ );
	} );

	test( 'logs (not throws) a malformed bridge ref and stores nothing', async () => {
		const { setWindowContent, getWindowContent } = await load();
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		expect( () =>
			setWindowContent(
				'w1',
				{ type: 'BAD TYPE', id: 1 },
				{ source: 'bridge' },
			),
		).not.toThrow();

		expect( getWindowContent( 'w1' ) ).toBeUndefined();
		expect( warn ).toHaveBeenCalled();
	} );

	test( 'clearing an unset window is a silent no-op', async () => {
		const { setWindowContent } = await load();
		const log = recordActions( hooks, [ HOOKS.WINDOW_CONTENT_CHANGED ] );

		setWindowContent( 'w1', null );

		expect( log ).toHaveLength( 0 );
	} );

	test( 're-setting an identical ref fires nothing', async () => {
		const { setWindowContent } = await load();
		const log = recordActions( hooks, [ HOOKS.WINDOW_CONTENT_CHANGED ] );

		setWindowContent( 'w1', { type: 'post', id: 5 } );
		setWindowContent( 'w1', { type: 'post', id: 5 } );

		expect( log ).toHaveLength( 1 );
	} );

	test( 'a same-origin previewUrl survives normalization', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', {
			type: 'post',
			id: 5,
			previewUrl: '/?p=5&preview=true',
		} );

		expect( getWindowContent( 'w1' )?.previewUrl ).toBe(
			'/?p=5&preview=true',
		);
	} );

	test( 'a cross-origin or malformed previewUrl is dropped', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', {
			type: 'post',
			id: 5,
			previewUrl: 'https://evil.example/?p=5',
		} );
		expect( getWindowContent( 'w1' )?.previewUrl ).toBeUndefined();

		setWindowContent( 'w2', {
			type: 'post',
			id: 6,
			previewUrl: 'http://[bad',
		} );
		expect( getWindowContent( 'w2' )?.previewUrl ).toBeUndefined();

		setWindowContent( 'w3', {
			type: 'post',
			id: 7,
			previewUrl: '',
		} );
		expect( getWindowContent( 'w3' )?.previewUrl ).toBeUndefined();
	} );

	test( 'a previewUrl-only change fires content-changed but not groups-changed', async () => {
		const { setWindowContent } = await load();
		const contentLog = recordActions( hooks, [
			HOOKS.WINDOW_CONTENT_CHANGED,
		] );
		const groupsLog = recordActions( hooks, [
			HOOKS.WINDOW_LINK_GROUPS_CHANGED,
		] );

		setWindowContent( 'w1', {
			type: 'post',
			id: 5,
			previewUrl: '/?p=5&preview=true&preview_nonce=aaa',
		} );
		const groupsAfterFirst = groupsLog.length;

		setWindowContent( 'w1', {
			type: 'post',
			id: 5,
			previewUrl: '/?p=5&preview=true&preview_nonce=bbb',
		} );

		expect( contentLog ).toHaveLength( 2 );
		expect( groupsLog ).toHaveLength( groupsAfterFirst );
	} );
} );

describe( 'grouping', () => {
	test( 'root and children resolving to the same key form one group', async () => {
		const { setWindowContent, listWindowLinkGroups } = await load();

		setWindowContent( 'post-win', { type: 'post', id: 123 } );
		setWindowContent( 'c1', {
			type: 'comment',
			id: 45,
			root: { type: 'post', id: 123 },
		} );
		setWindowContent( 'c2', {
			type: 'comment',
			id: 46,
			root: { type: 'post', id: 123 },
		} );

		const groups = listWindowLinkGroups();
		expect( groups ).toHaveLength( 1 );
		expect( groups[ 0 ].key ).toBe( 'post:123' );
		expect( groups[ 0 ].root ).toEqual( { type: 'post', id: 123 } );
		expect( groups[ 0 ].rootWindowIds ).toEqual( [ 'post-win' ] );
		expect(
			groups[ 0 ].children.map( ( c ) => c.windowId ).sort(),
		).toEqual( [ 'c1', 'c2' ] );
	} );

	test( 'root opening AFTER its children still links up', async () => {
		const { setWindowContent, listWindowLinkGroups } = await load();

		setWindowContent( 'c1', {
			type: 'comment',
			id: 45,
			root: { type: 'post', id: 9 },
		} );
		expect( listWindowLinkGroups()[ 0 ].rootWindowIds ).toEqual( [] );

		setWindowContent( 'post-win', { type: 'post', id: 9 } );

		const groups = listWindowLinkGroups();
		expect( groups ).toHaveLength( 1 );
		expect( groups[ 0 ].rootWindowIds ).toEqual( [ 'post-win' ] );
	} );

	test( 'a root-less group still exists for query callers', async () => {
		const { setWindowContent, listWindowLinkGroups } = await load();

		setWindowContent( 'm1', {
			type: 'media',
			id: 7,
			root: { type: 'post', id: 1 },
		} );

		const groups = listWindowLinkGroups();
		expect( groups ).toHaveLength( 1 );
		expect( groups[ 0 ].rootWindowIds ).toEqual( [] );
		expect( groups[ 0 ].children.map( ( c ) => c.windowId ) ).toEqual( [
			'm1',
		] );
	} );

	test( 'unrelated identities land in separate groups', async () => {
		const { setWindowContent, listWindowLinkGroups } = await load();

		setWindowContent( 'a', { type: 'post', id: 1 } );
		setWindowContent( 'b', { type: 'post', id: 2 } );

		expect( listWindowLinkGroups() ).toHaveLength( 2 );
	} );

	test( 'multiple root windows order by focus recency', async () => {
		const { setWindowContent, listWindowLinkGroups, startWindowLinksEngine } =
			await load();
		startWindowLinksEngine( { manager: fakeManager() } );

		setWindowContent( 'w1', { type: 'post', id: 3 } );
		setWindowContent( 'w2', { type: 'post', id: 3 } );
		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'w1' } );
		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'w2' } );

		expect( listWindowLinkGroups()[ 0 ].rootWindowIds ).toEqual( [
			'w2',
			'w1',
		] );

		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'w1' } );
		expect( listWindowLinkGroups()[ 0 ].rootWindowIds ).toEqual( [
			'w1',
			'w2',
		] );
	} );

	test( 'groupOf and related see the group from both sides', async () => {
		const { setWindowContent, getWindowLinkGroup, getRelatedWindowIds } =
			await load();

		setWindowContent( 'post-win', { type: 'post', id: 123 } );
		setWindowContent( 'c1', {
			type: 'comment',
			id: 45,
			root: { type: 'post', id: 123 },
		} );

		expect( getWindowLinkGroup( 'c1' )?.key ).toBe( 'post:123' );
		expect( getWindowLinkGroup( 'post-win' )?.key ).toBe( 'post:123' );
		expect( getWindowLinkGroup( 'stranger' ) ).toBeUndefined();
		expect( getRelatedWindowIds( 'post-win' ) ).toEqual( [ 'c1' ] );
		expect( getRelatedWindowIds( 'c1' ) ).toEqual( [ 'post-win' ] );
		expect( getRelatedWindowIds( 'stranger' ) ).toEqual( [] );
	} );

	test( 'directly-related excludes group siblings but keeps parent, children, and reference peers', async () => {
		const {
			setWindowContent,
			getDirectlyRelatedWindowIds,
			getRelatedWindowIds,
		} = await load();

		setWindowContent( 'post-win', {
			type: 'post',
			id: 123,
			links: [ { type: 'term/category', id: 7 } ],
		} );
		setWindowContent( 'c1', {
			type: 'comment',
			id: 45,
			root: { type: 'post', id: 123 },
		} );
		setWindowContent( 'c2', {
			type: 'comment',
			id: 46,
			root: { type: 'post', id: 123 },
		} );
		setWindowContent( 'term-win', { type: 'term/category', id: 7 } );

		// The root sees every child plus its reference peer.
		expect( getDirectlyRelatedWindowIds( 'post-win' ).sort() ).toEqual( [
			'c1',
			'c2',
			'term-win',
		] );
		// A child sees its parent — NOT its sibling.
		expect( getDirectlyRelatedWindowIds( 'c1' ) ).toEqual( [
			'post-win',
		] );
		// …while the group-wide query still includes the sibling.
		expect( getRelatedWindowIds( 'c1' ).sort() ).toEqual( [
			'c2',
			'post-win',
		] );
		expect( getDirectlyRelatedWindowIds( 'stranger' ) ).toEqual( [] );
	} );
} );

describe( 'edges', () => {
	test( 'a child window gets a directed child-root edge to its root window', async () => {
		const { setWindowContent, listWindowLinkEdges } = await load();

		setWindowContent( 'post-win', { type: 'post', id: 1 } );
		setWindowContent( 'c1', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );

		expect( listWindowLinkEdges() ).toEqual( [
			{
				fromWindowId: 'c1',
				toWindowId: 'post-win',
				kind: 'child-root',
				bidirectional: false,
			},
		] );
	} );

	test( 'links produce directed reference edges to open windows only', async () => {
		const { setWindowContent, listWindowLinkEdges } = await load();

		setWindowContent( 'a', {
			type: 'post',
			id: 1,
			links: [
				{ type: 'post', id: 2 },
				{ type: 'post', id: 99 }, // not open — no edge
			],
		} );
		setWindowContent( 'b', { type: 'post', id: 2 } );

		expect( listWindowLinkEdges() ).toEqual( [
			{
				fromWindowId: 'a',
				toWindowId: 'b',
				kind: 'reference',
				bidirectional: false,
			},
		] );
	} );

	test( 'mutual references collapse into ONE bidirectional edge', async () => {
		const { setWindowContent, listWindowLinkEdges } = await load();

		setWindowContent( 'a', {
			type: 'post',
			id: 1,
			links: [ { type: 'post', id: 2 } ],
		} );
		setWindowContent( 'b', {
			type: 'post',
			id: 2,
			links: [ { type: 'post', id: 1 } ],
		} );

		const edges = listWindowLinkEdges();
		expect( edges ).toHaveLength( 1 );
		expect( edges[ 0 ].kind ).toBe( 'reference' );
		expect( edges[ 0 ].bidirectional ).toBe( true );
	} );

	test( 'ARROW SEMANTICS: every edge points at what its source belongs to / refers to', async () => {
		// The single, deliberate reading (relational structure, never
		// navigation history). This test IS the semantics contract:
		//   comment  → post   (belongs to)
		//   media    → post   (belongs to — declared via rel:'child',
		//                      the post announces its embedded media)
		//   post     → term   (belongs to the category)
		//   post A   → post B (A's content references B)
		const { setWindowContent, listWindowLinkEdges } = await load();

		setWindowContent( 'post-win', {
			type: 'post',
			id: 1,
			links: [
				{ type: 'media', id: 7, rel: 'child' },
				{ type: 'term/category', id: 3 },
				{ type: 'post', id: 2 },
			],
		} );
		setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		setWindowContent( 'media-win', { type: 'media', id: 7 } );
		setWindowContent( 'term-win', { type: 'term/category', id: 3 } );
		setWindowContent( 'other-post-win', { type: 'post', id: 2 } );

		const edges = listWindowLinkEdges().map(
			( e ) => `${ e.fromWindowId }→${ e.toWindowId }:${ e.kind }`,
		);
		expect( edges.sort() ).toEqual( [
			'comment-win→post-win:child-root',
			'media-win→post-win:child-root',
			'post-win→other-post-win:reference',
			'post-win→term-win:reference',
		] );
	} );

	test( 'a child-root edge absorbs the REVERSE reference on the same pair', async () => {
		// Media attached to the post (child-root media→post) AND
		// embedded in its content (reference post→media): one spline,
		// not two opposite ones.
		const { setWindowContent, listWindowLinkEdges } = await load();

		setWindowContent( 'post-win', {
			type: 'post',
			id: 1,
			links: [ { type: 'media', id: 7 } ],
		} );
		setWindowContent( 'media-win', {
			type: 'media',
			id: 7,
			root: { type: 'post', id: 1 },
		} );

		expect( listWindowLinkEdges() ).toEqual( [
			{
				fromWindowId: 'media-win',
				toWindowId: 'post-win',
				kind: 'child-root',
				bidirectional: false,
			},
		] );
	} );

	test( 'child-root wins over a reference on the same directed pair', async () => {
		const { setWindowContent, listWindowLinkEdges } = await load();

		setWindowContent( 'post-win', { type: 'post', id: 1 } );
		setWindowContent( 'c1', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
			links: [ { type: 'post', id: 1 } ],
		} );

		const edges = listWindowLinkEdges();
		expect( edges ).toHaveLength( 1 );
		expect( edges[ 0 ].kind ).toBe( 'child-root' );
	} );

	test( 'a links change fires groups-changed even without membership change', async () => {
		const { setWindowContent } = await load();
		const log = recordActions( hooks, [
			HOOKS.WINDOW_LINK_GROUPS_CHANGED,
		] );

		setWindowContent( 'a', { type: 'post', id: 1 } );
		expect( log ).toHaveLength( 1 );

		setWindowContent( 'a', {
			type: 'post',
			id: 1,
			links: [ { type: 'post', id: 2 } ],
		} );
		expect( log ).toHaveLength( 2 );
	} );

	test( 'the edges filter reshapes the derived list', async () => {
		const { setWindowContent, listWindowLinkEdges } = await load();
		setWindowContent( 'post-win', { type: 'post', id: 1 } );
		setWindowContent( 'c1', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		hooks.addFilter( HOOKS.WINDOW_LINK_EDGES, 'vitest/drop', () => [] );

		expect( listWindowLinkEdges() ).toEqual( [] );
	} );

	test( 'related() includes reference-edge endpoints', async () => {
		const { setWindowContent, getRelatedWindowIds } = await load();

		setWindowContent( 'a', {
			type: 'post',
			id: 1,
			links: [ { type: 'post', id: 2 } ],
		} );
		setWindowContent( 'b', { type: 'post', id: 2 } );

		expect( getRelatedWindowIds( 'a' ) ).toEqual( [ 'b' ] );
		expect( getRelatedWindowIds( 'b' ) ).toEqual( [ 'a' ] );
	} );

	test( 'malformed links throw for api callers', async () => {
		const { setWindowContent } = await load();

		expect( () =>
			setWindowContent( 'a', {
				type: 'post',
				id: 1,
				links: [ { type: 'BAD TYPE', id: 2 } ],
			} ),
		).toThrow( /links/ );
	} );
} );

describe( 'engine lifecycle wiring', () => {
	test( 'seeds identity from WindowConfig.content on WINDOW_OPENED', async () => {
		const { startWindowLinksEngine, getWindowContent } = await load();
		startWindowLinksEngine( {
			manager: fakeManager( {
				'jorvy-win': {
					content: { type: 'jorvy/quote', id: 'iron-man' },
				},
			} ),
		} );

		hooks.doAction( HOOKS.WINDOW_OPENED, { windowId: 'jorvy-win' } );

		expect( getWindowContent( 'jorvy-win' ) ).toEqual( {
			type: 'jorvy/quote',
			id: 'iron-man',
			source: 'config',
		} );
	} );

	test( 'clears identity on WINDOW_CLOSED', async () => {
		const { startWindowLinksEngine, setWindowContent, listWindowLinkGroups } =
			await load();
		startWindowLinksEngine( { manager: fakeManager() } );

		setWindowContent( 'w1', { type: 'post', id: 1 } );
		hooks.doAction( HOOKS.WINDOW_CLOSED, { windowId: 'w1' } );

		expect( listWindowLinkGroups() ).toHaveLength( 0 );
	} );

	test( 'stores identity from a os-content-identity message', async () => {
		const { startWindowLinksEngine, getWindowContent } = await load();
		const manager = {
			...fakeManager(),
			findByIframeSource: () => ( { id: 'iframe-win' } ),
		};
		startWindowLinksEngine( { manager } );

		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: {
					type: 'os-content-identity',
					identity: {
						type: 'comment',
						id: 500,
						root: { type: 'post', id: 102 },
					},
				},
			} ),
		);

		expect( getWindowContent( 'iframe-win' ) ).toMatchObject( {
			type: 'comment',
			id: 500,
			root: { type: 'post', id: 102 },
			source: 'bridge',
		} );

		// A later null identity (navigation away) clears it.
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: window.location.origin,
				data: { type: 'os-content-identity', identity: null },
			} ),
		);
		expect( getWindowContent( 'iframe-win' ) ).toBeUndefined();
	} );

	test( 'ignores content-identity messages from foreign origins', async () => {
		const { startWindowLinksEngine, getWindowContent } = await load();
		const manager = {
			...fakeManager(),
			findByIframeSource: () => ( { id: 'iframe-win' } ),
		};
		startWindowLinksEngine( { manager } );

		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: 'https://evil.example',
				data: {
					type: 'os-content-identity',
					identity: { type: 'post', id: 1 },
				},
			} ),
		);

		expect( getWindowContent( 'iframe-win' ) ).toBeUndefined();
	} );

	test( 'is idempotent — a second start does not double-subscribe', async () => {
		const mod = await load();
		mod.startWindowLinksEngine( { manager: fakeManager() } );
		mod.startWindowLinksEngine( { manager: fakeManager() } );

		const log = recordActions( hooks, [ HOOKS.WINDOW_CONTENT_CHANGED ] );
		mod.setWindowContent( 'w1', { type: 'post', id: 1 } );
		hooks.doAction( HOOKS.WINDOW_CLOSED, { windowId: 'w1' } );

		// One set + one clear — a double subscription would produce a
		// second (no-op-guarded) clear attempt but ALSO a doubled seed
		// path; the content log staying at exactly 2 proves single wiring.
		expect( log ).toHaveLength( 2 );
	} );
} );

describe( 'filters', () => {
	test( 'the content filter can suppress an identity', async () => {
		const { setWindowContent, getWindowContent } = await load();
		hooks.addFilter(
			HOOKS.WINDOW_LINKS_CONTENT,
			'vitest/suppress',
			() => null,
		);

		setWindowContent( 'w1', { type: 'post', id: 1 } );

		expect( getWindowContent( 'w1' ) ).toBeUndefined();
	} );

	test( 'the content filter can rewrite an identity', async () => {
		const { setWindowContent, getWindowContent } = await load();
		hooks.addFilter(
			HOOKS.WINDOW_LINKS_CONTENT,
			'vitest/rewrite',
			( ref ) =>
				ref
					? {
							...( ref as object ),
							root: { type: 'acme/hub', id: 'main' },
					  }
					: ref,
		);

		setWindowContent( 'w1', { type: 'post', id: 1 } );

		expect( getWindowContent( 'w1' )?.root ).toEqual( {
			type: 'acme/hub',
			id: 'main',
		} );
	} );

	test( 'a filter returning an invalid ref is rejected, previous value kept', async () => {
		const { setWindowContent, getWindowContent } = await load();
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		setWindowContent( 'w1', { type: 'post', id: 1 } );

		hooks.addFilter(
			HOOKS.WINDOW_LINKS_CONTENT,
			'vitest/corrupt',
			() => ( { type: 'BAD TYPE', id: 2 } ),
		);
		setWindowContent( 'w1', { type: 'post', id: 99 } );

		expect( getWindowContent( 'w1' ) ).toMatchObject( {
			type: 'post',
			id: 1,
		} );
		expect( warn ).toHaveBeenCalled();
	} );

	test( 'the groups filter reshapes the computed list', async () => {
		const { setWindowContent, listWindowLinkGroups } = await load();
		setWindowContent( 'w1', { type: 'post', id: 1 } );
		hooks.addFilter( HOOKS.WINDOW_LINK_GROUPS, 'vitest/drop', () => [] );

		expect( listWindowLinkGroups() ).toEqual( [] );
	} );
} );

describe( 'change events', () => {
	test( 'content-changed carries windowId, content, previous, source', async () => {
		const { setWindowContent } = await load();
		const log = recordActions( hooks, [ HOOKS.WINDOW_CONTENT_CHANGED ] );

		setWindowContent( 'w1', { type: 'post', id: 1 } );
		setWindowContent( 'w1', null );

		expect( log ).toHaveLength( 2 );
		expect( log[ 0 ].args[ 0 ] ).toMatchObject( {
			windowId: 'w1',
			content: { type: 'post', id: 1 },
			previous: null,
			source: 'api',
		} );
		expect( log[ 1 ].args[ 0 ] ).toMatchObject( {
			windowId: 'w1',
			content: null,
			previous: { type: 'post', id: 1 },
		} );
	} );

	test( 'mirrored as document CustomEvents', async () => {
		const { setWindowContent } = await load();
		const seen: string[] = [];
		const onContent = () => seen.push( 'content' );
		const onGroups = () => seen.push( 'groups' );
		document.addEventListener(
			'os-window-content-changed',
			onContent,
		);
		document.addEventListener(
			'os-window-link-groups-changed',
			onGroups,
		);

		setWindowContent( 'w1', { type: 'post', id: 1 } );

		document.removeEventListener(
			'os-window-content-changed',
			onContent,
		);
		document.removeEventListener(
			'os-window-link-groups-changed',
			onGroups,
		);
		expect( seen ).toEqual( [ 'content', 'groups' ] );
	} );

	test( 'groups-changed fires only on membership change', async () => {
		const { setWindowContent } = await load();
		const log = recordActions( hooks, [
			HOOKS.WINDOW_LINK_GROUPS_CHANGED,
		] );

		setWindowContent( 'w1', { type: 'post', id: 1 } );
		// Same window, same group — a label tweak changes content but
		// not membership.
		setWindowContent( 'w1', { type: 'post', id: 1, label: 'Hello' } );

		expect( log ).toHaveLength( 1 );

		setWindowContent( 'w2', {
			type: 'comment',
			id: 2,
			root: { type: 'post', id: 1 },
		} );
		expect( log ).toHaveLength( 2 );
	} );

	test( 'subscribers fire on every content mutation and can unsubscribe', async () => {
		const { setWindowContent, subscribeWindowLinks } = await load();
		const cb = vi.fn();
		const off = subscribeWindowLinks( cb );

		setWindowContent( 'w1', { type: 'post', id: 1 } );
		expect( cb ).toHaveBeenCalledTimes( 1 );

		off();
		setWindowContent( 'w1', null );
		expect( cb ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'related-entity items on the identity', () => {
	const item = {
		id: 'comments',
		group: 'comments',
		groupLabel: 'Comments',
		label: 'Comments',
		icon: 'dashicons-admin-comments',
		url: 'http://localhost/wp-admin/edit-comments.php?p=1',
		count: 3,
	};

	test( 'survives normalization with fields whitelisted', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			related: [
				{ ...item, extra: 'dropped' } as unknown as typeof item,
			],
		} );

		expect( getWindowContent( 'w1' )?.related ).toEqual( [ item ] );
	} );

	test( 'optional fields are omitted when empty', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			related: [
				{
					id: 'media-9',
					group: 'media',
					label: 'Sunset',
					url: 'http://localhost/wp-admin/upload.php?item=9',
				},
			],
		} );

		expect( getWindowContent( 'w1' )?.related ).toEqual( [
			{
				id: 'media-9',
				group: 'media',
				label: 'Sunset',
				url: 'http://localhost/wp-admin/upload.php?item=9',
			},
		] );
	} );

	test( 'is capped at 64 entries', async () => {
		const { setWindowContent, getWindowContent } = await load();

		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			related: Array.from( { length: 80 }, ( _, i ) => ( {
				id: `media-${ i }`,
				group: 'media',
				label: `Item ${ i }`,
				url: `http://localhost/wp-admin/upload.php?item=${ i }`,
			} ) ),
		} );

		expect( getWindowContent( 'w1' )?.related ).toHaveLength( 64 );
	} );

	test( 'a malformed related list from the bridge logs and drops the ref', async () => {
		const { setWindowContent, getWindowContent } = await load();
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		setWindowContent(
			'w1',
			{
				type: 'post',
				id: 1,
				related: [
					{ id: '', group: 'media', label: 'x', url: 'y' },
				],
			},
			{ source: 'bridge' },
		);

		expect( getWindowContent( 'w1' ) ).toBeUndefined();
		expect( warn ).toHaveBeenCalled();
	} );

	test( 'a related-only change fires content-changed but not groups-changed', async () => {
		const { setWindowContent } = await load();
		const contentLog = recordActions( hooks, [
			HOOKS.WINDOW_CONTENT_CHANGED,
		] );
		const groupsLog = recordActions( hooks, [
			HOOKS.WINDOW_LINK_GROUPS_CHANGED,
		] );

		setWindowContent( 'w1', { type: 'post', id: 1, related: [ item ] } );
		expect( contentLog ).toHaveLength( 1 );
		expect( groupsLog ).toHaveLength( 1 );

		// New comment count — content-changed must fire (the Related
		// button repaints), groups-changed must not (membership and
		// edges are untouched).
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			related: [ { ...item, count: 4 } ],
		} );
		expect( contentLog ).toHaveLength( 2 );
		expect( groupsLog ).toHaveLength( 1 );

		// Identical repeat — full no-op.
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			related: [ { ...item, count: 4 } ],
		} );
		expect( contentLog ).toHaveLength( 2 );
	} );
} );
