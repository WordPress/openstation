/**
 * Drafts widget: the REST query is scoped to the viewer, the time-ago
 * stamps go through full sprintf placeholders (no concatenated
 * fragments), the empty/error states render, and the Trash button
 * refuses to act when it can't get consent.
 *
 * Plus the AI writing assistant: it stays completely absent without a
 * configured provider, the suggestions panel is a disclosure driven by
 * `<os-*>` controls, and accepting a suggestion writes it through
 * `/draft-apply` and reflects the result back into the row.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WidgetContext } from '../../src/widgets/types';

// Import for the side effect: registers window.openStationWidgets['desktop-mode/drafts'].
import '../../src/plugins/drafts-widget/index';

type MountFn = (
	container: HTMLElement,
	ctx: WidgetContext,
) => Promise< () => void >;

const WIDGET_ID = 'desktop-mode/drafts';

function getMount(): MountFn {
	const w = window as unknown as {
		openStationWidgets?: Record< string, MountFn >;
	};
	const mount = w.openStationWidgets?.[ WIDGET_ID ];
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

/** A full suggestions payload; individual tests override what they care about. */
const SUGGESTIONS = {
	titles: [ 'A better title', 'An even better title' ],
	excerpt: 'A crisp one-line summary.',
	tags: [ 'wordpress', 'drafts' ],
	categories: [ 'Announcements' ],
	readiness: { summary: 'Nearly there.', missing: [ 'a conclusion' ] },
};

/** Install `window.wp.os`; trackedFetch resolves it at call time. */
function installShell( opts: {
	drafts?: unknown;
	ok?: boolean;
	userId?: number;
	withConfirm?: boolean;
	confirmAnswer?: boolean;
	/** Mirrors `openStationConfig.aiAssistant.providerConfigured`. */
	ai?: boolean;
	suggestions?: unknown;
	suggestionsOk?: boolean;
	applyOk?: boolean;
} = {} ): DesktopStub {
	const {
		drafts = [],
		ok = true,
		userId = 7,
		withConfirm = true,
		confirmAnswer = true,
		ai = false,
		suggestions = SUGGESTIONS,
		suggestionsOk = true,
		applyOk = true,
	} = opts;

	desktop = {
		fetch: vi.fn( ( input: RequestInfo, init?: RequestInit ) => {
			const url = String( input );
			if ( init?.method === 'DELETE' ) {
				return Promise.resolve( jsonResponse( {}, true ) );
			}
			if ( url.includes( 'draft-suggestions' ) ) {
				return Promise.resolve(
					jsonResponse( suggestions, suggestionsOk ),
				);
			}
			if ( url.includes( 'draft-apply' ) ) {
				return Promise.resolve( jsonResponse( { applied: {} }, applyOk ) );
			}
			return Promise.resolve( jsonResponse( drafts, ok ) );
		} ),
		showToast: vi.fn(),
		config: { currentUserId: userId },
	};
	if ( withConfirm ) {
		desktop.confirm = vi.fn( () => Promise.resolve( confirmAnswer ) );
	}
	( window as unknown as { wp: unknown } ).wp = { os: desktop };
	( window as unknown as { openStationConfig: unknown } ).openStationConfig = {
		aiAssistant: { providerConfigured: ai },
	};
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
	delete ( window as unknown as { openStationConfig?: unknown } )
		.openStationConfig;
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

	test( 'names the window it opens, so the stamp cannot run into the title', async () => {
		installShell( {
			drafts: [
				{
					id: 99,
					title: { rendered: 'Ginza after work' },
					modified_gmt: agoIso( 356 * 86400 ),
				},
			],
		} );
		teardown = await getMount()( container, makeCtx() );

		const link = container.querySelector( '.dm-drafts__link' ) as HTMLAnchorElement;
		// Without this the interceptor reads the anchor's text, and the
		// two spans have no whitespace between them to read. The stamp
		// stays in the row; the window is named after the draft.
		expect( link.dataset.osWindowTitle ).toBe( 'Ginza after work' );
		expect( link.textContent ).toBe( 'Ginza after work356d ago' );
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

describe( 'drafts widget — AI writing assistant', () => {
	const oneDraft = [
		{ id: 12, title: { rendered: 'Rough notes' }, modified_gmt: agoIso( 90 ) },
	];

	/** Open the panel for the first row and wait for it to finish loading. */
	async function openPanel(): Promise< HTMLElement > {
		( container.querySelector( '.dm-drafts__spark' ) as HTMLElement ).click();
		const panel = container.querySelector(
			'.dm-drafts__suggest',
		) as HTMLElement;
		await vi.waitFor( () => {
			expect( panel.querySelector( '.dm-drafts__suggest-hint' ) ).not.toBeNull();
		} );
		return panel;
	}

	test( 'renders no suggest button when no AI provider is configured', async () => {
		installShell( { drafts: oneDraft, ai: false } );
		teardown = await getMount()( container, makeCtx() );

		expect( container.querySelector( '.dm-drafts__spark' ) ).toBeNull();
		// …and the rest of the row is untouched.
		expect( container.querySelector( '.dm-drafts__trash' ) ).not.toBeNull();
	} );

	test( 'renders the suggest button as a collapsed os-button disclosure', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );

		const spark = container.querySelector( '.dm-drafts__spark' ) as HTMLElement;
		expect( spark.tagName.toLowerCase() ).toBe( 'os-button' );
		expect( spark.getAttribute( 'aria-expanded' ) ).toBe( 'false' );
		// Named by slotted text rather than a host `aria-label`, which
		// `<os-button>` cannot carry — see the accessible-names block.
		expect(
			spark.querySelector( '.screen-reader-text' )?.textContent,
		).toBe( 'Suggest title, excerpt & tags' );
	} );

	test( 'row actions are os-button components, not bare buttons', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );

		const row = container.querySelector( '.dm-drafts__row' ) as HTMLElement;
		expect( row.querySelector( 'button' ) ).toBeNull();
		expect( row.querySelectorAll( 'os-button' ) ).toHaveLength( 2 );
	} );

	test( 'opening the panel asks the REST route for suggestions and marks itself expanded', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );

		const spark = container.querySelector( '.dm-drafts__spark' ) as HTMLElement;
		spark.click();

		// The panel appears immediately with a spinner while the round-trip runs.
		const panel = container.querySelector( '.dm-drafts__suggest' ) as HTMLElement;
		expect( panel ).not.toBeNull();
		const spinner = panel.querySelector( 'os-spinner' ) as HTMLElement;
		expect( spinner ).not.toBeNull();
		// The default mark-and-rings artwork is illegible at this size —
		// the panel must ask for the bare inline arc.
		expect( spinner.getAttribute( 'preset' ) ).toBe( 'inline' );
		expect( spark.getAttribute( 'aria-expanded' ) ).toBe( 'true' );
		expect( spark.getAttribute( 'aria-controls' ) ).toBe( panel.id );

		await vi.waitFor( () => {
			expect(
				panel.querySelector( '.dm-drafts__suggest-hint' ),
			).not.toBeNull();
		} );

		const call = desktop.fetch.mock.calls.find( ( c ) =>
			String( c[ 0 ] ).includes( 'draft-suggestions' ),
		);
		expect( call ).toBeTruthy();
		expect( ( call?.[ 1 ] as RequestInit ).method ).toBe( 'POST' );
		expect(
			JSON.parse( String( ( call?.[ 1 ] as RequestInit ).body ) ),
		).toEqual( { post_id: 12 } );
	} );

	test( 'renders every suggestion group as a tap-to-apply os-button', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );
		const panel = await openPanel();

		const items = [ ...panel.querySelectorAll( '.dm-drafts__suggest-item' ) ];
		const pills = [ ...panel.querySelectorAll( '.dm-drafts__suggest-tag' ) ];
		// 2 titles + 1 excerpt.
		expect( items.map( ( i ) => i.textContent ) ).toEqual( [
			'A better title',
			'An even better title',
			'A crisp one-line summary.',
		] );
		// 2 tags + 1 category.
		expect( pills.map( ( p ) => p.textContent ) ).toEqual( [
			'wordpress',
			'drafts',
			'Announcements',
		] );
		for ( const el of [ ...items, ...pills ] ) {
			expect( el.tagName.toLowerCase() ).toBe( 'os-button' );
		}
	} );

	test( 'readiness renders as a warning notice while something is missing', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );
		const panel = await openPanel();

		const notice = panel.querySelector( 'os-notice' ) as HTMLElement;
		expect( notice.getAttribute( 'tone' ) ).toBe( 'warning' );
		expect(
			notice.querySelector( '.dm-drafts__readiness-summary' )?.textContent,
		).toBe( 'Nearly there.' );
		expect(
			[ ...notice.querySelectorAll( '.dm-drafts__readiness-missing li' ) ].map(
				( li ) => li.textContent,
			),
		).toEqual( [ 'a conclusion' ] );
	} );

	test( 'panel notices carry the contrast-override class', async () => {
		// `dm-drafts__notice` re-points <os-notice>'s color surface at
		// currentColor. Without it the component falls back to its
		// light-surface palette (#1d2327 text) and disappears into a dark
		// glass widget card — a regression that is invisible to a DOM
		// assertion unless it is spelled out here.
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );
		const panel = await openPanel();

		const readiness = panel.querySelector( 'os-notice' ) as HTMLElement;
		expect( readiness.classList.contains( 'dm-drafts__notice' ) ).toBe( true );
		expect( readiness.classList.contains( 'dm-drafts__readiness' ) ).toBe(
			true,
		);
	} );

	test( 'readiness flips to a success notice when nothing is missing', async () => {
		installShell( {
			drafts: oneDraft,
			ai: true,
			suggestions: {
				...SUGGESTIONS,
				readiness: { summary: 'Looks ready to publish.', missing: [] },
			},
		} );
		teardown = await getMount()( container, makeCtx() );
		const panel = await openPanel();

		const notice = panel.querySelector( 'os-notice' ) as HTMLElement;
		expect( notice.getAttribute( 'tone' ) ).toBe( 'success' );
		expect(
			notice.querySelector( '.dm-drafts__readiness-missing' ),
		).toBeNull();
	} );

	test( 'accepting a title writes it through draft-apply and updates the row', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );
		const panel = await openPanel();

		const first = panel.querySelector(
			'.dm-drafts__suggest-item',
		) as HTMLElement;
		first.click();

		await vi.waitFor( () => {
			expect( first.classList.contains( 'is-applied' ) ).toBe( true );
		} );

		const call = desktop.fetch.mock.calls.find( ( c ) =>
			String( c[ 0 ] ).includes( 'draft-apply' ),
		);
		expect( JSON.parse( String( ( call?.[ 1 ] as RequestInit ).body ) ) ).toEqual(
			{ post_id: 12, title: 'A better title' },
		);
		// The row's title reflects the accepted suggestion without a refetch…
		expect( container.querySelector( '.dm-drafts__name' )?.textContent ).toBe(
			'A better title',
		);
		// …the button locks so a double-click can't apply it twice, via
		// aria-disabled rather than the component's `disabled` (which
		// would dim it to 50% opacity and gut its contrast on a dark
		// glass card)…
		expect( first.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
		expect( first.hasAttribute( 'disabled' ) ).toBe( false );
		expect(
			first.querySelector( '.dm-drafts__applied-check' ),
		).not.toBeNull();
		// …and the user gets told.
		expect( desktop.showToast ).toHaveBeenCalledWith( {
			message: 'Title updated.',
		} );
	} );

	test( 'a tag pill applies only that tag', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );
		const panel = await openPanel();

		( panel.querySelector( '.dm-drafts__suggest-tag' ) as HTMLElement ).click();

		await vi.waitFor( () => {
			expect(
				desktop.fetch.mock.calls.some( ( c ) =>
					String( c[ 0 ] ).includes( 'draft-apply' ),
				),
			).toBe( true );
		} );
		const call = desktop.fetch.mock.calls.find( ( c ) =>
			String( c[ 0 ] ).includes( 'draft-apply' ),
		);
		expect( JSON.parse( String( ( call?.[ 1 ] as RequestInit ).body ) ) ).toEqual(
			{ post_id: 12, tags: [ 'wordpress' ] },
		);
	} );

	test( 'a failed apply toasts an error and leaves the suggestion re-tryable', async () => {
		installShell( { drafts: oneDraft, ai: true, applyOk: false } );
		teardown = await getMount()( container, makeCtx() );
		const panel = await openPanel();

		const first = panel.querySelector(
			'.dm-drafts__suggest-item',
		) as HTMLElement;
		first.click();

		await vi.waitFor( () => {
			expect( desktop.showToast ).toHaveBeenCalledWith( {
				message: 'Could not apply the suggestion.',
				type: 'error',
			} );
		} );
		expect( first.classList.contains( 'is-applied' ) ).toBe( false );
		expect( first.hasAttribute( 'aria-disabled' ) ).toBe( false );
		expect( first.hasAttribute( 'busy' ) ).toBe( false );
	} );

	test( 'a failed suggestions request degrades to an error notice', async () => {
		installShell( { drafts: oneDraft, ai: true, suggestionsOk: false } );
		teardown = await getMount()( container, makeCtx() );

		( container.querySelector( '.dm-drafts__spark' ) as HTMLElement ).click();
		const panel = container.querySelector( '.dm-drafts__suggest' ) as HTMLElement;

		await vi.waitFor( () => {
			const notice = panel.querySelector( 'os-notice' );
			expect( notice?.getAttribute( 'tone' ) ).toBe( 'error' );
		} );
		expect( panel.textContent ).toContain( 'Could not get suggestions.' );
		expect(
			panel.querySelector( 'os-notice' )?.classList.contains(
				'dm-drafts__notice',
			),
		).toBe( true );
	} );

	test( 'clicking the button again closes the panel and collapses the disclosure', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );
		await openPanel();

		const spark = container.querySelector( '.dm-drafts__spark' ) as HTMLElement;
		spark.click();

		expect( container.querySelector( '.dm-drafts__suggest' ) ).toBeNull();
		expect( spark.getAttribute( 'aria-expanded' ) ).toBe( 'false' );
	} );

	test( 'the poll refresh is suppressed while a panel is open', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );
		await openPanel();

		desktop.fetch.mockClear();
		// The blur nudge is the same code path the 60s poller uses.
		document.dispatchEvent( new Event( 'os-window-blurred' ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 700 ) );

		expect(
			desktop.fetch.mock.calls.some( ( c ) =>
				String( c[ 0 ] ).includes( '/wp/v2/posts' ),
			),
		).toBe( false );
		// The panel survived.
		expect( container.querySelector( '.dm-drafts__suggest' ) ).not.toBeNull();
	} );
} );

describe( 'drafts widget — focus across refreshes', () => {
	const twoDrafts = [
		{ id: 5, title: { rendered: 'First' }, modified_gmt: agoIso( 60 ) },
		{ id: 6, title: { rendered: 'Second' }, modified_gmt: agoIso( 120 ) },
	];

	/** Fire the blur nudge — the same rebuild the 60s poller drives. */
	async function poll(): Promise< void > {
		document.dispatchEvent( new Event( 'os-window-blurred' ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 700 ) );
	}

	function linkFor( id: number ): HTMLElement {
		return container.querySelector(
			`.dm-drafts__row[data-draft-id="${ id }"] .dm-drafts__link`,
		) as HTMLElement;
	}

	test( 'a refresh leaves the keyboard on the draft it was on', async () => {
		installShell( { drafts: twoDrafts } );
		teardown = await getMount()( container, makeCtx() );

		linkFor( 6 ).focus();
		await poll();

		// Same draft, and the node itself is the one the rebuild made.
		expect( document.activeElement ).toBe( linkFor( 6 ) );
	} );

	// The control branch (trash / spark rather than the link) is not
	// covered here: `<os-button>` puts its real button in a shadow root,
	// and jsdom implements neither `delegatesFocus` nor a focusable host,
	// so the row's buttons cannot take focus in this environment. It is
	// exercised in a browser instead.
	test( 'a vanished draft hands focus to the row that took its place', async () => {
		installShell( { drafts: twoDrafts } );
		teardown = await getMount()( container, makeCtx() );

		linkFor( 5 ).focus();
		// The draft is gone by the time the refresh lands.
		desktop.fetch.mockImplementation( () =>
			Promise.resolve( jsonResponse( [ twoDrafts[ 1 ] ] ) ),
		);
		await poll();

		expect( document.activeElement ).toBe( linkFor( 6 ) );
		expect( document.activeElement ).not.toBe( document.body );
	} );

	test( 'a refresh does not steal focus back from elsewhere', async () => {
		installShell( { drafts: twoDrafts } );
		teardown = await getMount()( container, makeCtx() );

		const outside = document.createElement( 'button' );
		document.body.appendChild( outside );
		outside.focus();
		await poll();

		expect( document.activeElement ).toBe( outside );
		outside.remove();
	} );
} );

describe( 'drafts widget — accessible names', () => {
	const oneDraft = [
		{ id: 5, title: { rendered: 'Doomed' }, modified_gmt: agoIso( 60 ) },
	];

	test( 'row actions carry a slotted name, not a host aria-label', async () => {
		installShell( { drafts: oneDraft, ai: true } );
		teardown = await getMount()( container, makeCtx() );

		for ( const cls of [ 'dm-drafts__trash', 'dm-drafts__spark' ] ) {
			const btn = container.querySelector( `.${ cls }` ) as HTMLElement;
			// `<os-button>` drops a host aria-label: it renders its real
			// button in a shadow root and a custom element has no role to
			// hang the label on. The name has to be inside the button.
			expect( btn.getAttribute( 'aria-label' ) ).toBeNull();
			const name = btn.querySelector( '.screen-reader-text' );
			expect( name?.textContent?.trim() ).toBeTruthy();
			// The tooltip stays for the pointer.
			expect( btn.getAttribute( 'title' ) ).toBe( name?.textContent );
		}
	} );

	test( 'the dashicon is hidden from the name', async () => {
		installShell( { drafts: oneDraft } );
		teardown = await getMount()( container, makeCtx() );

		const icon = container.querySelector( '.dm-drafts__trash .dashicons' );
		expect( icon?.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
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
		expect( events ).toContain( 'os-window-closed' );
		expect( events ).toContain( 'os-window-blurred' );
	} );
} );
