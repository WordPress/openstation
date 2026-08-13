/**
 * Unit tests for `src/my-wordpress/agents-renderer.ts` — the `agent`
 * entity-kind registration and the list/empty/detail paints.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import '../../src/my-wordpress/agents-renderer';
import { getEntityRenderer } from '../../src/my-wordpress/kind-registry';
import type { EntityRenderHost } from '../../src/my-wordpress/kind-registry';
import type { MyWordPressEntity } from '../../src/my-wordpress/types';
import type { Agent } from '../../src/my-wordpress/agents-types';

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

		const row = host.body.querySelector( '.dm-agents__row' );
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

		// First agent auto-selects; the detail head + tabs paint.
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
			expect( host.body.querySelector( '.dm-agents__layout' ) ).not.toBeNull();
			expect(
				host.body.querySelector( '.dm-agents.is-disabled' ),
			).not.toBeNull();
		} );

		test( 'disables the create button rather than hiding it', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			const create = host.body.querySelector( '.dm-agents__create' );
			expect( create ).not.toBeNull();
			expect( create!.hasAttribute( 'disabled' ) ).toBe( true );
		} );

		test( 'offers an admin the Features tab from the empty state CTA', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const openOsSettings = vi.fn();
			( window as unknown as Record< string, unknown > ).wp = {
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

		test( 'dims the sidebar but never the way out', async () => {
			installConfig( { enabled: false } );
			mockAgentList( [] );
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();

			// `.is-disabled` scopes its opacity to the sidebar — a
			// greyed-out CTA in a greyed-out pane is a dead end.
			const root = host.body.querySelector( '.dm-agents' );
			expect( root!.classList.contains( 'is-disabled' ) ).toBe( true );
			expect(
				host.body.querySelector( '.dm-agents__detail .dm-agents__enable' ),
			).not.toBeNull();
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
				'.dm-agents__row[data-agent-id="31"]',
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

	describe( 'guided create flow', () => {
		/**
		 * URL-keyed fetch mock: the wizard touches the list, the AI
		 * status probe, and both catalogues in one journey.
		 */
		function mockAgentRoutes(
			opts: { providerConfigured?: boolean } = {},
		): FetchMock {
			const respond = ( body: unknown ): Response =>
				( {
					ok: true,
					status: 200,
					json: async () => body,
				} ) as unknown as Response;
			const fn = vi.fn( async ( input: RequestInfo ) => {
				const url = String( input );
				if ( url.includes( '/ai/status' ) ) {
					return respond( {
						available: true,
						providerConfigured: opts.providerConfigured === true,
					} );
				}
				if ( url.includes( '/agents/roles' ) ) {
					return respond( [
						{ slug: 'author', label: 'Author' },
						{ slug: 'editor', label: 'Editor' },
					] );
				}
				if ( url.includes( '/agents/abilities' ) ) {
					return respond( [
						{
							slug: 'desktop-mode/get-post',
							label: 'Read posts',
							description: 'Reads a post.',
							category: 'Content',
							readonly: true,
						},
					] );
				}
				if ( url.includes( '/agents/trigger-kinds' ) ) {
					return respond( [] );
				}
				if ( url.includes( '/agents/hooks-catalogue' ) ) {
					return respond( [] );
				}
				return respond( [] );
			} );
			( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
			return fn;
		}

		function openCreate( host: ReturnType< typeof makeHost > ): void {
			host.body
				.querySelector< HTMLElement >( '.dm-agents__create' )!
				.click();
		}

		function setField(
			host: ReturnType< typeof makeHost >,
			selector: string,
			value: string,
		): void {
			host.body.querySelector( selector )!.dispatchEvent(
				new CustomEvent( 'os-input-change', { detail: { value } } ),
			);
		}

		test( 'create opens on the guided Describe step', async () => {
			mockAgentRoutes();
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();
			openCreate( host );
			await flush();

			const steps = Array.from(
				host.body.querySelectorAll( '.dm-agents__wizard-step-label' ),
			).map( ( el ) => el.textContent?.trim() );
			expect( steps ).toEqual( [ 'Describe', 'Refine', 'Launch' ] );
			expect(
				host.body.querySelector( '.dm-agents__brief' ),
			).not.toBeNull();
		} );

		test( 'the Expert segment shows the classic form', async () => {
			mockAgentRoutes();
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();
			openCreate( host );
			await flush();

			host.body.querySelector( 'os-segmented' )!.dispatchEvent(
				new CustomEvent( 'os-pick', { detail: { value: 'expert' } } ),
			);
			await flush();

			expect(
				host.body.querySelector( '.dm-agents__wizard-steps' ),
			).toBeNull();
			const buttons = Array.from(
				host.body.querySelectorAll( 'os-button' ),
			).map( ( el ) => el.textContent?.trim() );
			expect( buttons ).toContain( 'Create' );
		} );

		test( 'continuing without AI seeds the instructions from the brief', async () => {
			mockAgentRoutes();
			const host = makeHost();

			getEntityRenderer( 'agent' )!( host, ENTITY );
			await flush();
			openCreate( host );
			await flush();

			setField(
				host,
				'.dm-agents__brief',
				'Watch comments and draft replies.',
			);
			// aiAvailable is false in the default config, so the lone
			// advance button reads Continue.
			const advance = Array.from(
				host.body.querySelectorAll< HTMLElement >( 'os-button' ),
			).find( ( el ) => el.textContent?.trim() === 'Continue' );
			expect( advance ).toBeDefined();
			advance!.click();
			await flush();

			const instructions = Array.from(
				host.body.querySelectorAll( 'os-textarea' ),
			).find(
				( el ) =>
					el.getAttribute( 'label' ) ===
					'Instructions (system prompt)',
			);
			expect( instructions?.getAttribute( 'value' ) ).toBe(
				'Watch comments and draft replies.',
			);
		} );

		test( 'Draft it for me fills the Refine step from the model reply', async () => {
			installConfig( {
				aiAvailable: true,
				aiStatusUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/status',
			} );
			mockAgentRoutes( { providerConfigured: true } );
			const ask = vi.fn( async () => ( {
				message: JSON.stringify( {
					name: 'Comment Concierge',
					description: 'Reach for it when comments pile up.',
					instructions: 'Read new comments and draft kind replies.',
					role: 'editor',
					abilities: [
						'desktop-mode/get-post',
						'not-a-real-ability',
					],
				} ),
			} ) );
			( window as unknown as Record< string, unknown > ).wp = {
				os: { ai: { ask } },
			};
			try {
				const host = makeHost();

				getEntityRenderer( 'agent' )!( host, ENTITY );
				await flush();
				openCreate( host );
				await flush();

				setField(
					host,
					'.dm-agents__brief',
					'Answer comments for me.',
				);
				const draft = Array.from(
					host.body.querySelectorAll< HTMLElement >( 'os-button' ),
				).find(
					( el ) => el.textContent?.trim() === 'Draft it for me',
				);
				expect( draft ).toBeDefined();
				draft!.click();
				await flush();
				await flush();

				expect( ask ).toHaveBeenCalledTimes( 1 );
				const nameField = Array.from(
					host.body.querySelectorAll( 'os-text-field' ),
				).find( ( el ) => el.getAttribute( 'label' ) === 'Name' );
				expect( nameField?.getAttribute( 'value' ) ).toBe(
					'Comment Concierge',
				);
				// The unknown ability slug is dropped, the known one kept.
				const ticked = Array.from(
					host.body.querySelectorAll( 'os-checkbox-label' ),
				).filter( ( el ) => el.hasAttribute( 'checked' ) );
				expect( ticked ).toHaveLength( 1 );
			} finally {
				delete ( window as unknown as Record< string, unknown > ).wp;
			}
		} );
	} );
} );
