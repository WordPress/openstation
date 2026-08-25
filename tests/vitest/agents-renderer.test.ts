/**
 * Unit tests for `src/my-wordpress/agents-renderer.ts` — the `agent`
 * entity-kind registration and the list/empty/detail paints.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub } from './helpers/hooks-stub';
import '../../src/my-wordpress/agents-renderer';
import { getEntityRenderer } from '../../src/my-wordpress/kind-registry';
import type { EntityRenderHost } from '../../src/my-wordpress/kind-registry';
import type { MyWordPressEntity } from '../../src/my-wordpress/types';
import type {
	Agent,
	PreviewAgent,
} from '../../src/my-wordpress/agents-types';

const WINDOW_ID = 'desktop-mode-my-wordpress';

const ENTITY: MyWordPressEntity = {
	id: 'agents',
	label: 'Agents',
	icon: 'data:image/svg+xml;base64,x',
	restPath: 'desktop-mode/v1/agents',
	kind: 'agent',
};

const AGENT: Agent = {
	id: 12,
	slug: 'audit',
	name: 'Audit Agent',
	description: 'Audits drafts.',
	instructions: 'Audit the post.',
	role: 'author',
	abilities: [ 'desktop-mode/get-post' ],
	triggers: [],
	model: '',
	rateLimit: 0,
	avatarUrl: 'data:image/svg+xml;base64,x',
};

/**
 * Two of the five shipped definitions, in the shape
 * `openstation_agents_preview_cast()` sends while the flag is off. No
 * id and no `avatarUrl`: neither exists until the seeder has run.
 */
const PREVIEW: PreviewAgent[] = [
	{
		name: 'tl;dr',
		vibes: 'brisk, allergic to preamble',
		description: 'When adding a tl;dr section to a post',
		role: 'editor',
		roleLabel: 'Editor',
		face: { appearance: { hueStart: 24 }, physics: { shapePreset: 'blob' } },
	},
	{
		name: 'Localizer',
		vibes: 'careful, leaves the original alone',
		description: 'Translates a post into a new reviewable draft.',
		role: 'author',
		roleLabel: 'Author',
		face: { appearance: { hueStart: 200 }, physics: { shapePreset: 'star' } },
	},
];

type FetchMock = ReturnType< typeof vi.fn >;

function installConfig( overrides: Record< string, unknown > = {} ): void {
	( window as unknown as Record< string, unknown > ).openStationWindowConfig = {
		[ WINDOW_ID ]: {
			restRoot: 'https://example.test/wp-json/',
			restNonce: 'test-nonce',
			entities: [ ENTITY ],
			perPage: 24,
			editPostUrlBase: '',
			agents: {
				enabled: true,
				canEnable: true,
				canManage: true,
				canInvoke: true,
				aiAvailable: false,
				aiStatusUrl: '',
				connectorsUrl: 'https://example.test/wp-admin/options-connectors.php',
				runWindowId: 'desktop-mode-agent-run',
				...overrides,
			},
		},
	};
}

function mockAgentList( agents: Agent[] ): FetchMock {
	const fn = vi.fn( async () => ( {
		ok: true,
		status: 200,
		json: async () => agents,
	} ) as unknown as Response );
	( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
	return fn;
}

function makeHost(): EntityRenderHost & { teardowns: Array< () => void > } {
	const body = document.createElement( 'div' );
	document.body.appendChild( body );
	const teardowns: Array< () => void > = [];
	return {
		body,
		route: { kind: 'list', entityId: 'agents' },
		navigate: () => void 0,
		addTeardown: ( fn: () => void ) => teardowns.push( fn ),
		teardowns,
	};
}

async function flush(): Promise< void > {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

beforeEach( () => {
	// The renderer subscribes to the extended-options bus, which needs
	// a live `window.wp.hooks`.
	installHooksStub();
	installConfig();
} );

afterEach( () => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	delete ( window as unknown as Record< string, unknown > )
		.openStationWindowConfig;
} );

describe( 'agents entity kind', () => {
	test( 'registers the `agent` kind in the registry', () => {
		expect( getEntityRenderer( 'agent' ) ).toBeTypeOf( 'function' );
	} );

	test( 'paints the agent list with name, description, and role', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		const row = host.body.querySelector( '.dm-agents__cast-card' );
		expect( row ).not.toBeNull();
		expect( row!.textContent ).toContain( 'Audit Agent' );
		expect( row!.textContent ).toContain( 'Audits drafts.' );
		expect( row!.textContent ).toContain( 'author' );
	} );

	test( 'selecting an agent shows the Define pane with its fields', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		// Nothing auto-selects any more: the cast is the landing
		// view, so opening an agent is a click.
		host.body
			.querySelector< HTMLElement >( '.dm-agents__cast-card' )!
			.dispatchEvent(
				new CustomEvent( 'os-card-click', { bubbles: true } ),
			);
		await flush();

		// The detail head + tabs paint.
		expect(
			host.body.querySelector( '.dm-agents__detail-head' ),
		).not.toBeNull();
		const tabs = Array.from(
			host.body.querySelectorAll( '.dm-agents__tab' ),
		).map( ( el ) => el.textContent?.trim() );
		expect( tabs ).toEqual( [ 'Define', 'Tools', 'Triggers' ] );

		const nameField = host.body.querySelector( 'os-text-field' );
		expect( nameField?.getAttribute( 'value' ) ).toBe( 'Audit Agent' );
	} );

	test( 'empty list paints the empty state with a create CTA', async () => {
		mockAgentList( [] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( host.body.querySelector( 'os-empty-state' ) ).not.toBeNull();
		const create = host.body.querySelector( '.dm-agents__create' );
		expect( create ).not.toBeNull();
	} );

	test( 'without manage capability there is no create button', async () => {
		installConfig( { canManage: false } );
		mockAgentList( [] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( host.body.querySelector( '.dm-agents__create' ) ).toBeNull();
	} );

	describe( 'framework turned off', () => {
		test( 'renders the section without fetching anything', async () => {
			installConfig( { enabled: false } );
			const fetchMock = mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// The REST routes are not registered while the option is
			// off — a fetch here would be a guaranteed 404.
			expect( fetchMock ).not.toHaveBeenCalled();
			expect( host.body.querySelector( '.dm-agents__view' ) ).not.toBeNull();
			expect(
				host.body.querySelector( '.dm-agents.is-disabled' ),
			).not.toBeNull();
		} );

		test( 'offers the way to turn it on, not a dead create button', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// There is nothing to create INTO while the framework is
			// off, so the off state offers the switch rather than a
			// greyed-out "Create agent" that explains nothing.
			expect( host.body.querySelector( '.dm-agents__create' ) ).toBeNull();
			const enable = host.body.querySelector( '.dm-agents__enable' );
			expect( enable ).not.toBeNull();
			expect( enable!.hasAttribute( 'disabled' ) ).toBe( false );
		} );

		test( 'offers an admin the Features tab from the empty state CTA', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const openOsSettings = vi.fn();
			( window as unknown as Record< string, unknown > ).wp = {
			// Keep the hooks bus the stub installed: the renderer
			// subscribes to it, and replacing `wp` wholesale would
			// take it away.
			...( window.wp ?? {} ),
				os: { openOsSettings },
			};
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			const cta = host.body.querySelector< HTMLElement >(
				'.dm-agents__enable',
			);
			expect( cta ).not.toBeNull();
			expect( cta!.getAttribute( 'slot' ) ).toBe( 'cta' );
			cta!.click();
			expect( openOsSettings ).toHaveBeenCalledWith( { tabId: 'features' } );

			delete ( window as unknown as Record< string, unknown > ).wp;
		} );

		test( 'says it once — no banner duplicating the empty state', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// The pane always renders while off (nothing is fetched, so
			// the list is always empty), which is exactly why a banner
			// on top would be the same sentence twice. It also carried
			// a dismiss button that could not dismiss anything.
			expect( host.body.querySelector( 'os-notice' ) ).toBeNull();
			expect( host.body.querySelectorAll( 'os-empty-state' ) ).toHaveLength(
				1,
			);
		} );

		test( 'without manage_options it points at an administrator instead', async () => {
			installConfig( { enabled: false, canEnable: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			expect( host.body.querySelector( '.dm-agents__enable' ) ).toBeNull();
			expect(
				host.body
					.querySelector( 'os-empty-state' )!
					.getAttribute( 'description' ),
			).toContain( 'administrator' );
		} );

		test( 'the empty state explains the feature is off, not that agents are missing', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			const empty = host.body.querySelector( 'os-empty-state' );
			expect( empty?.getAttribute( 'heading' ) ).toBe(
				'Agents are turned off',
			);
		} );

		test( 'marks itself disabled but never dims the way out', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// The flag still marks the section, for anything that
			// styles on it. What must not happen is the one control
			// that changes the situation being the greyed-out one.
			const root = host.body.querySelector( '.dm-agents' );
			expect( root!.classList.contains( 'is-disabled' ) ).toBe( true );
			const enable = host.body.querySelector( '.dm-agents__enable' );
			expect( enable ).not.toBeNull();
			expect( enable!.hasAttribute( 'disabled' ) ).toBe( false );
		} );

		test( 'shows the cast the site would get, from the config alone', async () => {
			installConfig( { enabled: false, preview: PREVIEW } );
			const fetchMock = mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// The whole point of shipping the roster on the config: the
			// five agents do not exist as users yet, so there is
			// nothing to fetch and the routes would 404 anyway.
			expect( fetchMock ).not.toHaveBeenCalled();
			const cards = host.body.querySelectorAll(
				'.dm-agents__cast--preview .dm-agents__cast-card',
			);
			expect( cards ).toHaveLength( 2 );
			expect( host.body.textContent ).toContain( 'tl;dr' );
			expect( host.body.textContent ).toContain(
				'brisk, allergic to preamble',
			);
		} );

		test( 'draws a preview face client-side, with no avatar URL to read', async () => {
			installConfig( { enabled: false, preview: PREVIEW } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// Faces are rendered to disk on save, and nothing has
			// saved: a preview portrait has to come from the look.
			const faces = host.body.querySelectorAll< HTMLImageElement >(
				'.dm-agents__cast--preview .dm-agents__cast-face',
			);
			expect( faces ).toHaveLength( 2 );
			for ( const face of faces ) {
				expect( face.src.startsWith( 'data:image/svg+xml' ) ).toBe( true );
			}
			// Two different looks must not render one portrait twice.
			expect( faces[ 0 ].src ).not.toBe( faces[ 1 ].src );
		} );

		test( 'the preview is inert: nothing to select, nothing to open', async () => {
			installConfig( { enabled: false, preview: PREVIEW } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			const cards = host.body.querySelectorAll(
				'.dm-agents__cast--preview .dm-agents__cast-card',
			);
			for ( const card of cards ) {
				// `interactive` is what makes an `<os-card>` clickable
				// and focusable, and `data-agent-id` is what a click
				// would select. Neither belongs on a card backed by no
				// user.
				expect( card.hasAttribute( 'interactive' ) ).toBe( false );
				expect( card.hasAttribute( 'data-agent-id' ) ).toBe( false );
			}
		} );

		test( 'the preview stays readable to a screen reader', async () => {
			installConfig( { enabled: false, preview: PREVIEW } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// Inert is not hidden. These five names ARE the argument for
			// turning the feature on; hiding them leaves a screen reader
			// with the button and none of the reasons to press it.
			const strip = host.body.querySelector( '.dm-agents__cast--preview' );
			expect( strip!.getAttribute( 'aria-hidden' ) ).toBeNull();
			expect( strip!.getAttribute( 'role' ) ).toBe( 'list' );
		} );

		test( 'the role badge is translated, not the raw slug', async () => {
			installConfig( { enabled: false, preview: PREVIEW } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// A real card resolves its label from `/agents/roles`, which
			// does not exist while off. Without the label on the payload
			// the badge would fall back to `editor` in English.
			const badges = host.body.querySelectorAll(
				'.dm-agents__cast--preview os-badge',
			);
			expect(
				Array.from( badges ).map( ( b ) => b.textContent!.trim() ),
			).toEqual( [ 'Editor', 'Author' ] );
		} );

		test( 'keeps the way out on screen, above the crew', async () => {
			installConfig( { enabled: false, preview: PREVIEW } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// Five cards are taller than the window. A CTA rendered
			// after them starts below the fold, which is the same dead
			// end as grinding it out — the one control that changes the
			// situation has to be reachable without scrolling for it.
			const bar = host.body.querySelector( '.dm-agents__off-head' );
			const strip = host.body.querySelector( '.dm-agents__cast--preview' );
			expect( bar ).not.toBeNull();
			expect( strip ).not.toBeNull();
			expect(
				bar!.compareDocumentPosition( strip! ) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
			expect( bar!.querySelector( '.dm-agents__enable' ) ).not.toBeNull();

			// And it says it once: the bar replaces the empty state
			// rather than sitting on top of it.
			expect( host.body.querySelector( 'os-empty-state' ) ).toBeNull();
			expect( host.body.querySelector( 'os-notice' ) ).toBeNull();
		} );

		test( 'still points a non-admin at an administrator, with no dead button', async () => {
			installConfig( {
				enabled: false,
				canEnable: false,
				preview: PREVIEW,
			} );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			expect( host.body.querySelector( '.dm-agents__enable' ) ).toBeNull();
			expect(
				host.body.querySelector( '.dm-agents__off-copy p' )!.textContent,
			).toContain( 'administrator' );
			// The crew is still worth showing to someone who has to go
			// and ask for it — it is what they would be asking for.
			expect(
				host.body.querySelectorAll(
					'.dm-agents__cast--preview .dm-agents__cast-card',
				),
			).toHaveLength( 2 );
		} );

		test( 'falls back to the plain off state when no roster is sent', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// A filter can empty the roster, and an older PHP side sends
			// no `preview` at all. Neither should leave a stray heading
			// over nothing.
			expect(
				host.body.querySelector( '.dm-agents__cast--preview' ),
			).toBeNull();
			expect( host.body.querySelector( '.dm-agents__cast-head' ) ).toBeNull();
			expect( host.body.querySelector( 'os-empty-state' ) ).not.toBeNull();
		} );
	} );

	test( 'missing AI client paints the warning notice', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		const notice = host.body.querySelector( 'os-notice' );
		expect( notice ).not.toBeNull();
		expect( notice!.textContent ).toContain( 'AI Client' );
	} );

	test( 'the Connectors link opens a desktop window, not a new tab', async () => {
		// A `target="_blank"` link to a same-origin admin URL is inside
		// an installed PWA's scope, so clicking it relaunched the app.
		// The shell's window manager is where the settings screen goes.
		installConfig( {
			aiAvailable: true,
			aiStatusUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/status',
		} );
		const fetchMock = vi.fn( async ( input: RequestInfo ) => {
			const url = String( input );
			const body = url.includes( '/ai/status' )
				? { available: true, providerConfigured: false }
				: [];
			return { ok: true, status: 200, json: async () => body } as unknown as Response;
		} );
		( globalThis as unknown as { fetch: typeof fetchMock } ).fetch = fetchMock;
		const open = vi.fn();
		const wp = ( window as unknown as { wp: Record< string, unknown > } ).wp;
		wp.os = {
			deriveWindowId: ( url: string ) =>
				`derived:${ new URL( url ).pathname.split( '/' ).pop() }`,
			windowManager: { open },
		};
		try {
			const host = makeHost();
			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();
			await flush();

			const link = host.body.querySelector( 'os-notice a' ) as HTMLAnchorElement | null;
			expect( link ).not.toBeNull();
			expect( link!.textContent ).toContain( 'Open Connectors settings' );
			expect( link!.hasAttribute( 'target' ) ).toBe( false );
			// The href stays real for middle-click and "copy link".
			expect( link!.getAttribute( 'href' ) ).toBe(
				'https://example.test/wp-admin/options-connectors.php',
			);

			const click = new MouseEvent( 'click', { bubbles: true, cancelable: true, button: 0 } );
			link!.dispatchEvent( click );
			expect( click.defaultPrevented ).toBe( true );
			expect( open ).toHaveBeenCalledTimes( 1 );
			expect( open.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
				id: 'derived:options-connectors.php',
				url: 'https://example.test/wp-admin/options-connectors.php',
				title: 'Connectors',
			} );

			// A modified click is the browser's: the shell stays out of it.
			// Read the verdict at the document, after the link's own
			// handler ran, then cancel it so jsdom does not try to
			// navigate a page it cannot.
			let leftToBrowser = false;
			const atDocument = ( e: Event ) => {
				leftToBrowser = ! e.defaultPrevented;
				e.preventDefault();
			};
			document.addEventListener( 'click', atDocument, { once: true } );
			link!.dispatchEvent(
				new MouseEvent( 'click', {
					bubbles: true,
					cancelable: true,
					button: 0,
					metaKey: true,
				} ),
			);
			expect( leftToBrowser ).toBe( true );
			expect( open ).toHaveBeenCalledTimes( 1 );
		} finally {
			delete wp.os;
		}
	} );

	test( 'agent rows register drop targets gated by the drag trigger', async () => {
		interface StubTarget {
			id: string;
			element: HTMLElement;
			accept( payload: {
				type: string;
				data: Record< string, unknown >;
			} ): boolean;
		}
		const targets: StubTarget[] = [];
		( window as unknown as Record< string, unknown > ).wp = {
			// Keep the hooks bus the stub installed: the renderer
			// subscribes to it, and replacing `wp` wholesale would
			// take it away.
			...( window.wp ?? {} ),
			os: {
				dragManager: {
					registerDropTarget: ( target: StubTarget ) => {
						targets.push( target );
						return () => void 0;
					},
				},
			},
		};

		try {
			mockAgentList( [
				{
					...AGENT,
					id: 21,
					name: 'Media Agent',
					triggers: [
						{ kind: 'drag', config: { entityKinds: [ 'media' ] } },
					],
				},
				{ ...AGENT, id: 22, name: 'No Drag Agent', triggers: [] },
			] );
			const host = makeHost();
			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			const mediaTarget = targets.find( ( t ) =>
				t.id.endsWith( '-21' ),
			);
			const noDragTarget = targets.find( ( t ) =>
				t.id.endsWith( '-22' ),
			);
			expect( mediaTarget ).toBeDefined();
			expect( noDragTarget ).toBeDefined();

			const mediaPayload = {
				type: 'shortcut',
				data: { kind: 'attachment', ref: '44', title: 'Hornet' },
			};
			const postPayload = {
				type: 'shortcut',
				data: { kind: 'post', ref: '7', title: 'Draft' },
			};
			expect( mediaTarget!.accept( mediaPayload ) ).toBe( true );
			expect( mediaTarget!.accept( postPayload ) ).toBe( false );
			// No drag trigger configured — every drop is rejected.
			expect( noDragTarget!.accept( mediaPayload ) ).toBe( false );

			// Teardown deregisters cleanly (host teardowns run).
			host.teardowns.forEach( ( fn ) => fn() );
		} finally {
			delete ( window as unknown as Record< string, unknown > ).wp;
		}
	} );

	test( 'agent rows are draggable out as user shortcuts', async () => {
		const started: Array< Record< string, unknown > > = [];
		( window as unknown as Record< string, unknown > ).wp = {
			// Keep the hooks bus the stub installed: the renderer
			// subscribes to it, and replacing `wp` wholesale would
			// take it away.
			...( window.wp ?? {} ),
			os: {
				dragManager: {
					registerDropTarget: () => () => void 0,
					start: ( session: Record< string, unknown > ) => {
						started.push( session );
					},
				},
			},
		};

		try {
			mockAgentList( [ { ...AGENT, id: 31, name: 'Draggable' } ] );
			const host = makeHost();
			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			const row = host.body.querySelector< HTMLElement >(
				'.dm-agents__cast-card[data-agent-id="31"]',
			);
			expect( row ).not.toBeNull();
			// jsdom has no PointerEvent; the handler only reads the
			// MouseEvent fields (button, clientX/Y).
			row!.dispatchEvent(
				new MouseEvent( 'pointerdown', {
					button: 0,
					bubbles: true,
					clientX: 10,
					clientY: 10,
				} ),
			);

			expect( started ).toHaveLength( 1 );
			const payload = started[ 0 ].payload as {
				type: string;
				data: Record< string, unknown >;
			};
			expect( payload.type ).toBe( 'shortcut' );
			expect( payload.data.kind ).toBe( 'user' );
			expect( payload.data.ref ).toBe( '31' );
			expect( payload.data.title ).toBe( 'Draggable' );

			host.teardowns.forEach( ( fn ) => fn() );
		} finally {
			delete ( window as unknown as Record< string, unknown > ).wp;
		}
	} );

	test( 'list REST failures paint the error notice', async () => {
		const fn = vi.fn( async () => ( {
			ok: false,
			status: 500,
			json: async () => ( { message: 'kaboom' } ),
		} ) as unknown as Response );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( host.body.textContent ).toContain( 'kaboom' );
	} );
} );

describe( 'faces for agents that never picked one', () => {
	/**
	 * A list route plus a PATCH route, so the backfill has something
	 * to write to and the test can read what it wrote.
	 */
	function mockListAndPatch( agents: Agent[] ) {
		const patched: Array< { id: string; body: Record< string, unknown > } > =
			[];
		const fn = vi.fn( async ( input: RequestInfo, init?: RequestInit ) => {
			const url = String( input );
			const match = url.match( /\/agents\/(\d+)$/ );
			if ( match && init?.method === 'POST' ) {
				const body = JSON.parse( String( init.body ) );
				patched.push( { id: match[ 1 ], body } );
				const before = agents.find(
					( a ) => a.id === Number( match[ 1 ] ),
				);
				return {
					ok: true,
					status: 200,
					json: async () => ( { ...before, ...body } ),
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => agents,
			} as unknown as Response;
		} );
		( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
		return patched;
	}

	test( 'an agent with a seed and no face has one rolled and stored', async () => {
		// The state Dani hit: agents that reached the grid wearing the
		// fallback robot. Anything that made an agent without a picker
		// (a plugin, WP-CLI, an older version) lands here, and the
		// seed every agent gets at creation is what the roll uses.
		const patched = mockListAndPatch( [
			{
				...AGENT,
				id: 41,
				name: 'Faceless',
				face: { appearance: {}, physics: {} },
				faceSeed: 1234,
			},
		] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();
		await flush();

		expect( patched ).toHaveLength( 1 );
		expect( patched[ 0 ].id ).toBe( '41' );
		const face = patched[ 0 ].body.face as {
			appearance: Record< string, unknown >;
			physics: Record< string, unknown >;
		};
		expect( Object.keys( face.appearance ).length ).toBeGreaterThan( 0 );
		expect( face.physics.shapePreset ).toBeTruthy();
		// Derived, so the same seed has to give the same face: an
		// agent whose portrait changed per page load is not a
		// character.
		expect( patched[ 0 ].body.faceSeed ).toBe( 1234 );
	} );

	test( 'an agent that already has a face is left alone', async () => {
		const patched = mockListAndPatch( [
			{
				...AGENT,
				id: 42,
				face: {
					appearance: { hueStart: 200 },
					physics: { shapePreset: 'star' },
				},
				faceSeed: 7,
			},
		] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();
		await flush();

		expect( patched ).toHaveLength( 0 );
	} );

	test( 'a reader never writes', async () => {
		installConfig( { canManage: false } );
		const patched = mockListAndPatch( [
			{
				...AGENT,
				id: 43,
				face: { appearance: {}, physics: {} },
				faceSeed: 99,
			},
		] );
		const host = makeHost();

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();
		await flush();

		expect( patched ).toHaveLength( 0 );
		// The grid still shows a face: it is drawn from the seed on
		// the spot, so a read-only viewer sees the crew rather than a
		// row of identical robots.
		const img = host.body.querySelector< HTMLImageElement >(
			'.dm-agents__cast-face',
		);
		expect( img ).not.toBeNull();
		expect( img!.getAttribute( 'src' ) ).toContain( 'image/svg+xml' );
	} );
} );

describe( 'the Agents feature being toggled while the view is open', () => {
	test( 'switching it off repaints instead of leaving a dead view', async () => {
		// Turning the flag off unregisters the section's REST routes,
		// so a view that carried on regardless answered its next
		// request with "No route was found matching the URL and
		// request method".
		mockAgentList( [ AGENT ] );
		const host = makeHost();
		const navigated: unknown[] = [];
		host.navigate = ( route ) => navigated.push( route );

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		const hooks = ( window.wp as unknown as {
			hooks: { doAction: ( name: string, payload: unknown ) => void };
		} ).hooks;
		hooks.doAction( 'os.extended-options.changed', {
			options: { agents: false },
		} );

		expect( navigated ).toHaveLength( 1 );
		expect( navigated[ 0 ] ).toEqual( { kind: 'list', entityId: 'agents' } );
	} );

	test( 'a save that did not move the agents flag repaints nothing', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();
		const navigated: unknown[] = [];
		host.navigate = ( route ) => navigated.push( route );

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		const hooks = ( window.wp as unknown as {
			hooks: { doAction: ( name: string, payload: unknown ) => void };
		} ).hooks;
		// Someone toggled Games, not Agents.
		hooks.doAction( 'os.extended-options.changed', {
			options: { agents: true, games: true },
		} );

		expect( navigated ).toHaveLength( 0 );
	} );

	test( 'the subscription goes away with the view', async () => {
		mockAgentList( [ AGENT ] );
		const host = makeHost();
		const navigated: unknown[] = [];
		host.navigate = ( route ) => navigated.push( route );

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();
		host.teardowns.forEach( ( fn ) => fn() );

		const hooks = ( window.wp as unknown as {
			hooks: { doAction: ( name: string, payload: unknown ) => void };
		} ).hooks;
		hooks.doAction( 'os.extended-options.changed', {
			options: { agents: false },
		} );

		expect( navigated ).toHaveLength( 0 );
	} );
} );

describe( 'the status bar', () => {
	test( 'the section counts its cast rather than leaving the folder count up', async () => {
		// The status rail is the window's, not the view's, so a
		// section that never wrote to it kept whatever the root folder
		// had left there: "11 folders", under a screen with none.
		const root = document.createElement( 'div' );
		root.setAttribute( 'data-os-my-wordpress-root', '' );
		const status = document.createElement( 'div' );
		status.setAttribute( 'data-os-my-wordpress-status', '' );
		status.textContent = '11 folders';
		root.appendChild( status );
		document.body.appendChild( root );

		mockAgentList( [ AGENT, { ...AGENT, id: 13, name: 'Second' } ] );
		const host = makeHost();
		root.appendChild( host.body );

		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( status.textContent ).toContain( '2 agents' );
		expect( status.textContent ).not.toContain( 'folders' );
	} );
} );
