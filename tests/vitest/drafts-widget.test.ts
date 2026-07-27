/**
 * Drafts widget: the REST query is scoped to the viewer, the time-ago
 * stamps go through full sprintf placeholders (no concatenated
 * fragments), the empty/error states render, and the Trash button
 * refuses to act when it can't get consent.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WidgetContext } from '../../src/widgets/types';

// Import for the side effect: registers window.desktopModeWidgets['desktop-mode/drafts'].
import '../../src/plugins/drafts-widget/index';

type MountFn = (
	container: HTMLElement,
	ctx: WidgetContext,
) => Promise< () => void >;

const WIDGET_ID = 'desktop-mode/drafts';

function getMount(): MountFn {
	const w = window as unknown as {
		desktopModeWidgets?: Record< string, MountFn >;
	};
	const mount = w.desktopModeWidgets?.[ WIDGET_ID ];
	if ( ! mount ) {
		throw new Error( 'drafts widget did not register its mount' );
	}
	return mount;
}

function makeCtx(): WidgetContext {
	return { id: WIDGET_ID, pluginUrl: 'https://example.test/plugin' } as unknown as WidgetContext;
}

/** ISO-8601 UTC stamp (no `Z`, as the REST API emits `modified_gmt`). */
function agoIso( secondsAgo: number ): string {
	return new Date( Date.now() - secondsAgo * 1000 )
		.toISOString()
		.replace( /\.\d+Z$/, '' );
}

function jsonResponse( body: unknown, ok = true ): Response {
	return {
		ok,
		status: ok ? 200 : 500,
		json: () => Promise.resolve( body ),
	} as unknown as Response;
}

interface DesktopStub {
	fetch: ReturnType< typeof vi.fn >;
	confirm?: ReturnType< typeof vi.fn >;
	showToast?: ReturnType< typeof vi.fn >;
	config?: { currentUserId?: number };
}

let desktop: DesktopStub;

/** Install `window.wp.desktop`; trackedFetch resolves it at call time. */
function installShell( opts: {
	drafts?: unknown;
	ok?: boolean;
	userId?: number;
	withConfirm?: boolean;
	confirmAnswer?: boolean;
} = {} ): DesktopStub {
	const {
		drafts = [],
		ok = true,
		userId = 7,
		withConfirm = true,
		confirmAnswer = true,
	} = opts;

	desktop = {
		fetch: vi.fn( ( input: RequestInfo, init?: RequestInit ) => {
			if ( init?.method === 'DELETE' ) {
				return Promise.resolve( jsonResponse( {}, true ) );
			}
			return Promise.resolve( jsonResponse( drafts, ok ) );
		} ),
		showToast: vi.fn(),
		config: { currentUserId: userId },
	};
	if ( withConfirm ) {
		desktop.confirm = vi.fn( () => Promise.resolve( confirmAnswer ) );
	}
	( window as unknown as { wp: unknown } ).wp = { desktop };
	return desktop;
}

/** URL of the first non-DELETE request the widget issued. */
function listRequestUrl(): string {
	const call = desktop.fetch.mock.calls.find(
		( c ) => ( c[ 1 ] as RequestInit | undefined )?.method !== 'DELETE',
	);
	return String( call?.[ 0 ] );
}

let container: HTMLElement;
let teardown: ( () => void ) | null = null;

beforeEach( () => {
	container = document.createElement( 'div' );
	document.body.appendChild( container );
} );

afterEach( () => {
	teardown?.();
	teardown = null;
	container.remove();
	delete ( window as unknown as { wp?: unknown } ).wp;
	vi.restoreAllMocks();
} );

describe( 'drafts widget — REST query', () => {
	test( 'scopes the list to the viewer so an admin sees only their drafts', async () => {
		installShell( { userId: 42 } );
		teardown = await getMount()( container, makeCtx() );

		const url = listRequestUrl();
		expect( url ).toContain( 'author=42' );
		expect( url ).toContain( 'status=draft' );
		expect( url ).toContain( 'context=edit' );
	} );

	test( 'omits the author filter when the shell has not published an id', async () => {
		installShell( { userId: 0 } );
		teardown = await getMount()( container, makeCtx() );

		expect( listRequestUrl() ).not.toContain( 'author=' );
	} );

	test( 'polls without pulsing the activity bus', async () => {
		installShell();
		teardown = await getMount()( container, makeCtx() );

		const opts = desktop.fetch.mock.calls[ 0 ][ 2 ] as {
			source?: string;
			silent?: boolean;
		};
		expect( opts.silent ).toBe( true );
		expect( opts.source ).toBe( 'desktop-mode/drafts' );
	} );
} );

describe( 'drafts widget — rendering', () => {
	test( 'renders a row per draft, newest-relative stamps included', async () => {
		installShell( {
			drafts: [
				{ id: 1, title: { rendered: 'Half a thought' }, modified_gmt: agoIso( 30 ) },
				{ id: 2, title: { rendered: 'Later' }, modified_gmt: agoIso( 7200 ) },
			],
		} );
		teardown = await getMount()( container, makeCtx() );

		const names = [ ...container.querySelectorAll( '.dm-drafts__name' ) ].map(
			( n ) => n.textContent,
		);
		expect( names ).toEqual( [ 'Half a thought', 'Later' ] );

		const stamps = [ ...container.querySelectorAll( '.dm-drafts__time' ) ].map(
			( n ) => n.textContent,
		);
		expect( stamps[ 0 ] ).toBe( 'just now' );
		// Full placeholder, not a bare "h ago" fragment glued to a number.
		expect( stamps[ 1 ] ).toBe( '2h ago' );
	} );

	test( 'links each row at the editor so the shell interceptor can claim it', async () => {
		installShell( {
			drafts: [ { id: 99, title: { rendered: 'X' }, modified_gmt: agoIso( 10 ) } ],
		} );
		teardown = await getMount()( container, makeCtx() );

		const link = container.querySelector( '.dm-drafts__link' ) as HTMLAnchorElement;
		expect( link.getAttribute( 'href' ) ).toContain( 'post.php?post=99&action=edit' );
	} );

	test( 'falls back to a placeholder when a draft has no title', async () => {
		installShell( {
			drafts: [ { id: 3, title: { rendered: '' }, modified_gmt: agoIso( 10 ) } ],
		} );
		teardown = await getMount()( container, makeCtx() );

		expect(
			container.querySelector( '.dm-drafts__name' )?.textContent,
		).toBe( '(no title)' );
	} );

	test( 'shows the empty state with no drafts', async () => {
		installShell( { drafts: [] } );
		teardown = await getMount()( container, makeCtx() );

		expect( container.querySelector( '.dm-drafts__empty' )?.textContent ).toBe(
			'No drafts — all caught up.',
		);
		expect( container.querySelector( '.dm-drafts__list' ) ).toBeNull();
	} );

	test( 'shows the error state when the request fails', async () => {
		installShell( { ok: false } );
		teardown = await getMount()( container, makeCtx() );

		expect( container.querySelector( '.dm-drafts__empty' )?.textContent ).toBe(
			'Could not load drafts.',
		);
	} );
} );

describe( 'drafts widget — Trash', () => {
	const oneDraft = [
		{ id: 5, title: { rendered: 'Doomed' }, modified_gmt: agoIso( 60 ) },
	];

	test( 'confirms before deleting, then issues the DELETE', async () => {
		installShell( { drafts: oneDraft, confirmAnswer: true } );
		teardown = await getMount()( container, makeCtx() );

		( container.querySelector( '.dm-drafts__trash' ) as HTMLElement ).click();
		await vi.waitFor( () => {
			expect(
				desktop.fetch.mock.calls.some(
					( c ) => ( c[ 1 ] as RequestInit | undefined )?.method === 'DELETE',
				),
			).toBe( true );
		} );

		expect( desktop.confirm ).toHaveBeenCalled();
		const confirmArgs = desktop.confirm?.mock.calls[ 0 ][ 0 ] as { danger?: boolean };
		expect( confirmArgs.danger ).toBe( true );
	} );

	test( 'does nothing when the user declines', async () => {
		installShell( { drafts: oneDraft, confirmAnswer: false } );
		teardown = await getMount()( container, makeCtx() );
		desktop.fetch.mockClear();

		( container.querySelector( '.dm-drafts__trash' ) as HTMLElement ).click();
		await Promise.resolve();
		await Promise.resolve();

		expect(
			desktop.fetch.mock.calls.some(
				( c ) => ( c[ 1 ] as RequestInit | undefined )?.method === 'DELETE',
			),
		).toBe( false );
	} );

	test( 'refuses to trash when no confirm dialog is available', async () => {
		installShell( { drafts: oneDraft, withConfirm: false } );
		teardown = await getMount()( container, makeCtx() );
		desktop.fetch.mockClear();

		( container.querySelector( '.dm-drafts__trash' ) as HTMLElement ).click();
		await Promise.resolve();
		await Promise.resolve();

		expect(
			desktop.fetch.mock.calls.some(
				( c ) => ( c[ 1 ] as RequestInit | undefined )?.method === 'DELETE',
			),
		).toBe( false );
	} );
} );

describe( 'drafts widget — teardown', () => {
	test( 'detaches its window-lifecycle listeners', async () => {
		installShell();
		const remove = vi.spyOn( document, 'removeEventListener' );
		teardown = await getMount()( container, makeCtx() );

		teardown();
		teardown = null;

		const events = remove.mock.calls.map( ( c ) => c[ 0 ] );
		expect( events ).toContain( 'desktop-mode-window-closed' );
		expect( events ).toContain( 'desktop-mode-window-blurred' );
	} );
} );
