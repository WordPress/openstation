/**
 * The create flow.
 *
 * Five steps and a door: start from an agent that already exists, or
 * describe a new one. The door is the part worth protecting: five
 * complete agents ship with the plugin and the old create form showed
 * them to nobody, so "copies the work, rolls its own face" is the
 * behaviour these tests are here to keep.
 *
 * Powers holds the privilege decisions; Summon holds the doors (the
 * triggers the retired expert form never could reach), as fixed cards.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub } from './helpers/hooks-stub';
import '../../src/my-wordpress/agents-renderer';
import {
	faceHueName,
	faceShapeName,
} from '../../src/my-wordpress/agents-face';
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

const CONCIERGE: Agent = {
	id: 3,
	slug: 'comment-concierge',
	name: 'Comment Concierge',
	description: "Triages a post's comment thread.",
	instructions: 'You are the Comment Concierge. You never post.',
	role: 'editor',
	abilities: [ 'desktop-mode/get-post' ],
	triggers: [],
	model: '',
	rateLimit: 0,
	vibes: 'warm, reads the room, never posts',
	face: { appearance: { hueStart: 95 }, physics: { shapePreset: 'cloud' } },
	faceSeed: 990,
	avatarUrl: 'data:image/svg+xml;base64,x',
};

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
				connectorsUrl: '',
				runWindowId: 'desktop-mode-agent-run',
				...overrides,
			},
		},
	};
}

/**
 * A stand-in abilities catalogue for the tests that care how long the
 * list is. Null means "use the two-row default".
 */
let abilityCatalogue: Array< Record< string, unknown > > | null = null;

/** Whether the mocked provider probe reports a configured provider. */
let aiReady = false;

/**
 * What `POST /agents/draft` answers: a draft, or an Error the route
 * would have turned into a 502.
 */
let draftResponse: Record< string, unknown > | Error | null = null;

/** A catalogue of `count` abilities spread over three categories. */
function bigCatalogue( count: number ): Array< Record< string, unknown > > {
	const categories = [ 'Content', 'Media', 'Allterrain-fields' ];
	return Array.from( { length: count }, ( _, i ) => ( {
		slug: `plugin/ability-${ i }`,
		label: `Ability ${ i }`,
		description: i === 0 ? 'Reads a custom field.' : `Does thing ${ i }.`,
		category: categories[ i % categories.length ],
		readonly: i % 2 === 0,
	} ) );
}

/** Route every catalogue the wizard settles before it paints. */
function mockRoutes( agents: Agent[], onCreate?: ( body: unknown ) => void ) {
	const fetchMock = vi.fn( async ( input: RequestInfo, init?: RequestInit ) => {
		const url = String( input );
		const json = ( data: unknown ) =>
			new Response( JSON.stringify( data ), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			} );

		if ( url.includes( '/agents/roles' ) ) {
			return json( [
				{ slug: 'author', label: 'Author' },
				{ slug: 'editor', label: 'Editor' },
			] );
		}
		if ( url.includes( '/agents/abilities' ) ) {
			if ( abilityCatalogue ) {
				return json( abilityCatalogue );
			}
			return json( [
				{
					slug: 'desktop-mode/get-post',
					label: 'Get post by id',
					description: 'Read one post.',
					category: 'Content',
					readonly: true,
				},
				{
					slug: 'desktop-mode/update-post',
					label: 'Update post',
					description: 'Write a post back.',
					category: 'Content',
					readonly: false,
				},
			] );
		}
		if ( url.includes( '/agents/trigger-kinds' ) ) {
			const entityKinds = {
				type: 'object',
				properties: {
					entityKinds: { type: 'array', items: { type: 'string' } },
				},
			};
			return json( [
				{
					slug: 'chat',
					label: 'Chat',
					description: 'Answers in a chat window.',
					icon: '',
					wired: true,
					config_schema: { type: 'object', properties: {} },
				},
				{
					slug: 'send-to',
					label: 'Send to (right-click menu)',
					description: 'Appears in the right-click menu.',
					icon: '',
					wired: true,
					config_schema: entityKinds,
				},
				{
					slug: 'drag',
					label: 'Drag & drop',
					description: 'Drop a tile onto the agent.',
					icon: '',
					wired: true,
					config_schema: entityKinds,
				},
				{
					slug: 'hook',
					label: 'WordPress hook',
					description: 'Not wired yet.',
					icon: '',
					wired: false,
					config_schema: { type: 'object', properties: { hook: { type: 'string' } } },
				},
			] );
		}
		if ( url.includes( '/agents/hooks-catalogue' ) ) {
			return json( [] );
		}
		if ( url.includes( '/ai/status' ) ) {
			return json( { available: true, providerConfigured: aiReady } );
		}
		if ( url.includes( '/agents/draft' ) ) {
			if ( draftResponse instanceof Error ) {
				return new Response( JSON.stringify( { message: draftResponse.message } ), {
					status: 502,
					headers: { 'Content-Type': 'application/json' },
				} );
			}
			return json( draftResponse ?? {} );
		}
		if ( url.match( /\/agents\/?$/ ) && init?.method === 'POST' ) {
			const body = JSON.parse( String( init.body ) );
			onCreate?.( body );
			return json( { ...CONCIERGE, id: 99, ...body } );
		}
		return json( agents );
	} );
	( window as unknown as Record< string, unknown > ).fetch = fetchMock;
	return fetchMock;
}

function makeHost(): EntityRenderHost {
	const body = document.createElement( 'div' );
	document.body.appendChild( body );
	return {
		body,
		route: { kind: 'list', entityId: 'agents' },
		navigate: vi.fn(),
		addTeardown: vi.fn(),
	} as unknown as EntityRenderHost;
}

const flush = async () => {
	for ( let i = 0; i < 8; i++ ) {
		await Promise.resolve();
		await new Promise( ( r ) => setTimeout( r, 0 ) );
	}
};

const click = ( el: Element | null ) => {
	expect( el, 'element to click was not found' ).not.toBeNull();
	el!.dispatchEvent( new CustomEvent( 'os-card-click', { bubbles: true } ) );
};

const press = ( host: EntityRenderHost, label: string ) => {
	const button = [ ...host.body.querySelectorAll( 'os-button' ) ].find(
		( b ) => ( b.textContent ?? '' ).trim() === label,
	);
	expect( button, `no button labelled "${ label }"` ).toBeDefined();
	button!.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
};

const setField = ( host: EntityRenderHost, label: string, value: string ) => {
	const field = [
		...host.body.querySelectorAll( 'os-text-field, os-textarea' ),
	].find( ( f ) => f.getAttribute( 'label' ) === label );
	expect( field, `no field labelled "${ label }"` ).toBeDefined();
	field!.dispatchEvent(
		new CustomEvent( 'os-input-change', { detail: { value }, bubbles: true } ),
	);
};

describe( 'the guided create flow', () => {
	beforeEach( () => {
		// The renderer subscribes to the extended-options bus, which
		// needs a live `window.wp.hooks`.
		installHooksStub();
		installConfig();
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		delete ( window as unknown as Record< string, unknown > ).openStationWindowConfig;
		abilityCatalogue = null;
		aiReady = false;
		draftResponse = null;
		vi.restoreAllMocks();
	} );

	async function openWizard( agents: Agent[] = [ CONCIERGE ] ) {
		const created: unknown[] = [];
		const fetchMock = mockRoutes( agents, ( b ) => created.push( b ) );
		const host = makeHost();
		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();
		click( host.body.querySelector( '.dm-agents__cast-new' ) );
		await flush();
		return { host, created, fetchMock };
	}

	test( 'the cast is the landing view, not somebody\'s detail page', async () => {
		mockRoutes( [ CONCIERGE ] );
		const host = makeHost();
		getEntityRenderer( 'agent' )!( host, ENTITY );
		await flush();

		expect( host.body.querySelector( '.dm-agents__cast' ) ).not.toBeNull();
		expect( host.body.querySelector( '.dm-agents__detail' ) ).toBeNull();
	} );

	test( 'the new-agent tile opens the wizard on Describe', async () => {
		const { host } = await openWizard();
		expect( host.body.querySelector( '.dm-agents__wizard' ) ).not.toBeNull();
		expect( host.body.querySelector( '.dm-agents__brief' ) ).not.toBeNull();
	} );

	test( 'Describe offers the agents that already exist as starting points', async () => {
		// The whole point of the door: five complete agents ship with
		// the plugin, and the old form showed them to nobody.
		const { host } = await openWizard();
		const starters = host.body.querySelectorAll( '.dm-agents__starter' );
		expect( starters ).toHaveLength( 1 );
		expect( starters[ 0 ].textContent ).toContain( 'Comment Concierge' );
	} );

	test( 'starting from someone copies the work but never the face', async () => {
		const { host } = await openWizard();
		click( host.body.querySelector( '.dm-agents__starter' ) );
		await flush();

		// Lands on Meet with the copy prefilled.
		const name = [ ...host.body.querySelectorAll( 'os-text-field' ) ].find(
			( f ) => f.getAttribute( 'label' ) === 'Name',
		);
		expect( name!.getAttribute( 'value' ) ).toBe( 'Comment Concierge copy' );

		const vibes = [ ...host.body.querySelectorAll( 'os-text-field' ) ].find(
			( f ) => f.getAttribute( 'label' ) === 'Vibes',
		);
		expect( vibes!.getAttribute( 'value' ) ).toBe(
			'warm, reads the room, never posts',
		);

		// Two agents wearing one face is exactly the confusion faces
		// exist to remove, so a copy rolls its own.
		const portrait = host.body.querySelector( '.dm-agents__portrait-face' );
		expect( portrait ).not.toBeNull();
		expect( portrait!.getAttribute( 'src' ) ).not.toBe( CONCIERGE.avatarUrl );
	} );

	test( 'the face strip offers alternatives and shuffling moves on', async () => {
		const { host } = await openWizard();
		press( host, 'Continue' );
		await flush();

		const before = host.body.querySelectorAll( '.dm-agents__face-pick' );
		expect( before.length ).toBeGreaterThan( 1 );
		const firstSrc = before[ 0 ].querySelector( 'img' )!.getAttribute( 'src' );

		press( host, 'Surprise me' );
		await flush();

		const after = host.body.querySelectorAll( '.dm-agents__face-pick' );
		expect(
			after[ 0 ].querySelector( 'img' )!.getAttribute( 'src' ),
		).not.toBe( firstSrc );
	} );

	test( 'Powers shows the abilities grouped, described, and badged', async () => {
		const { host } = await openWizard();
		press( host, 'Continue' );
		await flush();
		setField( host, 'Name', 'Nearly There' );
		press( host, 'Continue' );
		await flush();

		expect( host.body.textContent ).toContain( 'Content' );
		expect( host.body.textContent ).toContain( 'Read one post.' );
		const badges = [ ...host.body.querySelectorAll( 'os-badge' ) ].map(
			( b ) => ( b.textContent ?? '' ).trim(),
		);
		expect( badges ).toContain( 'read-only' );
		expect( badges ).toContain( 'can modify' );
	} );

	test( 'creates in one request, abilities included', async () => {
		// PR #603 attached abilities with a second PATCH, which left a
		// half-made agent behind whenever the second call failed. The
		// create route has always taken them.
		const { host, created, fetchMock } = await openWizard();
		press( host, 'Continue' );
		await flush();
		setField( host, 'Name', 'Nearly There' );
		setField( host, 'Vibes', 'encouraging, a little nagging' );
		press( host, 'Continue' );
		await flush();

		const checkbox = host.body.querySelector( 'os-checkbox-label' );
		checkbox!.dispatchEvent(
			new CustomEvent( 'os-checkbox-change', {
				detail: { checked: true },
				bubbles: true,
			} ),
		);
		await flush();
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();
		press( host, 'Create agent' );
		await flush();

		expect( created ).toHaveLength( 1 );
		const body = created[ 0 ] as Record< string, unknown >;
		expect( body.name ).toBe( 'Nearly There' );
		expect( body.vibes ).toBe( 'encouraging, a little nagging' );
		expect( body.abilities ).toEqual( [ 'desktop-mode/get-post' ] );
		expect( body.face ).toBeTruthy();
		expect( body.faceSeed ).toBeGreaterThan( 0 );

		// One POST to /agents, not two.
		const posts = fetchMock.mock.calls.filter(
			( c ) => ( c[ 1 ] as RequestInit | undefined )?.method === 'POST',
		);
		expect( posts ).toHaveLength( 1 );
	} );

	test( 'will not create an agent with no name', async () => {
		const { host, created } = await openWizard();
		press( host, 'Continue' );
		await flush();
		// Continue is disabled without a name, so Launch is unreachable
		// by the button; going there directly still refuses.
		const cont = [ ...host.body.querySelectorAll( 'os-button' ) ].find(
			( b ) => ( b.textContent ?? '' ).trim() === 'Continue',
		);
		expect( cont!.hasAttribute( 'disabled' ) ).toBe( true );
		expect( created ).toHaveLength( 0 );
	} );

	test( 'there is one door, and it is the guided one', async () => {
		// The expert segment used to sit here. It was the only way to
		// mint an agent with no face and no voice, and it could not
		// reach triggers at all, so it lost on both counts.
		const { host } = await openWizard();

		expect( host.body.querySelector( 'os-segmented' ) ).toBeNull();
		expect( host.body.querySelector( 'os-steps' ) ).not.toBeNull();
		const titles = [ ...host.body.querySelectorAll( 'os-step' ) ].map( ( s ) =>
			s.getAttribute( 'title' ),
		);
		expect( titles ).toEqual( [ 'Describe', 'Meet', 'Powers', 'Summon', 'Launch' ] );
	} );

	test( 'Summon draws the doors as fixed cards, chat always on', async () => {
		// There used to be an "Add trigger" select over added rows. With
		// three wired kinds and chat always available there was nothing
		// to add, only doors to open, so each wired kind is a card and
		// the unwired ones stay out of sight.
		const { host } = await openWizard();
		press( host, 'Continue' );
		await flush();
		setField( host, 'Name', 'Deep Cut' );
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();

		const cards = [ ...host.body.querySelectorAll( '.dm-agents__trigger' ) ].map(
			( c ) => c.querySelector( 'strong' )?.textContent?.trim(),
		);
		expect( cards ).toEqual( [ 'Chat', 'Send to (right-click menu)', 'Drag & drop' ] );
		expect( host.body.textContent ).toContain( 'Always on' );
		expect( host.body.textContent ).not.toContain( 'WordPress hook' );
		expect(
			[ ...host.body.querySelectorAll( 'os-select' ) ].find(
				( f ) => f.getAttribute( 'label' ) === 'Add trigger',
			),
		).toBeUndefined();
		// The brief is the system prompt; there is no second field for it.
		const labels = [ ...host.body.querySelectorAll( 'os-textarea' ) ].map(
			( f ) => f.getAttribute( 'label' ),
		);
		expect( labels ).not.toContain( 'Instructions (system prompt)' );
	} );

	test( 'a door opened on Summon rides along on the create', async () => {
		const { host, created } = await openWizard();
		press( host, 'Continue' );
		await flush();
		setField( host, 'Name', 'Hooked Up' );
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();

		const drag = [ ...host.body.querySelectorAll( '.dm-agents__trigger' ) ].find(
			( c ) => c.querySelector( 'strong' )?.textContent?.trim() === 'Drag & drop',
		);
		const post = [ ...drag!.querySelectorAll( 'os-checkbox-label' ) ].find(
			( c ) => c.getAttribute( 'label' ) === 'post',
		);
		post!.dispatchEvent(
			new CustomEvent( 'os-checkbox-change', {
				detail: { checked: true },
				bubbles: true,
			} ),
		);
		await flush();
		press( host, 'Continue' );
		await flush();
		// Launch names what was opened, so the review is a review.
		expect( host.body.textContent ).toContain( 'Starts from: Chat, Drag & drop.' );
		press( host, 'Create agent' );
		await flush();

		expect( created ).toHaveLength( 1 );
		const body = created[ 0 ] as Record< string, unknown >;
		expect( body.triggers ).toEqual( [
			{ kind: 'chat', config: {} },
			{ kind: 'drag', config: { entityKinds: [ 'post' ] } },
		] );
	} );

	test( 'unticking the last kind closes the door again', async () => {
		const { host, created } = await openWizard();
		press( host, 'Continue' );
		await flush();
		setField( host, 'Name', 'Door Test' );
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();

		const tick = ( kind: string, checked: boolean ) => {
			const card = [ ...host.body.querySelectorAll( '.dm-agents__trigger' ) ].find(
				( c ) => c.querySelector( 'strong' )?.textContent?.trim() === 'Send to (right-click menu)',
			);
			const box = [ ...card!.querySelectorAll( 'os-checkbox-label' ) ].find(
				( c ) => c.getAttribute( 'label' ) === kind,
			);
			box!.dispatchEvent(
				new CustomEvent( 'os-checkbox-change', { detail: { checked }, bubbles: true } ),
			);
		};
		tick( 'post', true );
		await flush();
		tick( 'page', true );
		await flush();
		tick( 'post', false );
		await flush();
		tick( 'page', false );
		await flush();
		press( host, 'Continue' );
		await flush();
		press( host, 'Create agent' );
		await flush();

		const body = created[ 0 ] as Record< string, unknown >;
		expect( body.triggers ).toEqual( [ { kind: 'chat', config: {} } ] );
	} );

	test( 'Draft it for me fills the cast from the draft route', async () => {
		// Drafting used to ride the Copilot search route, whose own
		// answer schema wrapped the draft in a chat message. Now it is
		// one call to /agents/draft and the answer lands on the cast.
		aiReady = true;
		installConfig( {
			aiAvailable: true,
			aiStatusUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/status',
		} );
		draftResponse = {
			name: 'Categorizer',
			description: 'Files posts under the right categories.',
			vibes: 'tidy, decisive',
			instructions: 'Read each post. Pick the categories that fit.',
			role: 'editor',
			abilities: [ 'desktop-mode/get-post' ],
		};
		const { host, fetchMock } = await openWizard();
		setField( host, 'What should this agent do? (system prompt)', 'Categorizer' );
		press( host, 'Draft it for me' );
		await flush();

		const draftCall = fetchMock.mock.calls.find( ( c ) =>
			String( c[ 0 ] ).includes( '/agents/draft' ),
		) as [ string, RequestInit ];
		expect( JSON.parse( String( draftCall[ 1 ].body ) ) ).toEqual( { brief: 'Categorizer' } );

		// Meet, filled in.
		const name = [ ...host.body.querySelectorAll( 'os-text-field' ) ].find(
			( f ) => f.getAttribute( 'label' ) === 'Name',
		);
		expect( name!.getAttribute( 'value' ) ).toBe( 'Categorizer' );
		const vibes = [ ...host.body.querySelectorAll( 'os-text-field' ) ].find(
			( f ) => f.getAttribute( 'label' ) === 'Vibes',
		);
		expect( vibes!.getAttribute( 'value' ) ).toBe( 'tidy, decisive' );

		press( host, 'Continue' );
		await flush();
		// Powers, with the role and the ability the draft picked.
		const role = host.body.querySelector( '.dm-agents__role-select' );
		expect( role!.getAttribute( 'value' ) ).toBe( 'editor' );
		const ticked = [ ...host.body.querySelectorAll( 'os-checkbox-label' ) ].filter(
			( c ) => c.hasAttribute( 'checked' ),
		);
		expect( ticked.map( ( c ) => c.getAttribute( 'label' ) ) ).toEqual( [ 'Get post by id' ] );

		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();
		const instr = host.body.querySelector( '.dm-agents__summary-instr' );
		expect( instr!.textContent ).toContain( 'Read each post.' );
	} );

	test( 'an empty brief gets its error under the field, not in the banner', async () => {
		aiReady = true;
		installConfig( {
			aiAvailable: true,
			aiStatusUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/status',
		} );
		const { host } = await openWizard();
		press( host, 'Draft it for me' );
		await flush();

		expect( host.body.querySelector( 'os-notice' ) ).toBeNull();
		const row = host.body.querySelector( '.dm-agents__brief-row' );
		expect( row!.getAttribute( 'error' ) ).toBe(
			'Describe the agent first. A sentence is enough.',
		);
		// The row must be a defined element here, not a bare tag: an
		// unregistered <os-field-row> renders its children and nothing
		// else, which is exactly how the message went missing once.
		expect( customElements.get( 'os-field-row' ) ).toBeDefined();
		await flush();
		expect( row!.shadowRoot?.textContent ).toContain(
			'Describe the agent first. A sentence is enough.',
		);
		expect( host.body.querySelector( '.dm-agents__brief' )!.hasAttribute( 'invalid' ) ).toBe(
			true,
		);

		// Typing is the fix, and the error goes as soon as it starts.
		setField( host, 'What should this agent do? (system prompt)', 'W' );
		await flush();
		expect( host.body.querySelector( '.dm-agents__brief-row' )!.getAttribute( 'error' ) ).toBeFalsy();
		expect( host.body.querySelector( '.dm-agents__brief' )!.hasAttribute( 'invalid' ) ).toBe(
			false,
		);
	} );

	test( 'a failed draft keeps Describe, with the reason under the brief', async () => {
		aiReady = true;
		installConfig( {
			aiAvailable: true,
			aiStatusUrl: 'https://example.test/wp-json/desktop-mode/v1/ai/status',
		} );
		draftResponse = new Error(
			'The draft came back in a shape that could not be read. Try again, or fill the fields in yourself.',
		);
		const { host } = await openWizard();
		setField( host, 'What should this agent do? (system prompt)', 'Categorizer' );
		press( host, 'Draft it for me' );
		await flush();

		// Still on Describe: the brief is there, Meet's Name is not.
		expect( host.body.querySelector( '.dm-agents__brief' ) ).not.toBeNull();
		expect(
			[ ...host.body.querySelectorAll( 'os-text-field' ) ].find(
				( f ) => f.getAttribute( 'label' ) === 'Name',
			),
		).toBeUndefined();
		expect( host.body.querySelector( 'os-notice' ) ).toBeNull();
		expect( host.body.querySelector( '.dm-agents__brief-row' )!.getAttribute( 'error' ) ).toContain(
			'could not be read',
		);
	} );

	test( 'creating with no name marks the Name field, not the banner', async () => {
		const { host, created } = await openWizard();
		press( host, 'Continue' );
		await flush();
		// Continue is disabled on Meet; go around it through the trail
		// is not possible forwards, so drive the create directly by
		// filling, walking to Launch, and clearing the name on the way.
		setField( host, 'Name', 'Temp' );
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();
		// Back to Meet through the trail, blank the name, and forward.
		const meet = [ ...host.body.querySelectorAll( 'os-step' ) ].find(
			( s ) => s.getAttribute( 'title' ) === 'Meet',
		);
		meet!.dispatchEvent( new CustomEvent( 'os-step-click', { bubbles: true } ) );
		await flush();
		setField( host, 'Name', '' );
		await flush();
		expect(
			[ ...host.body.querySelectorAll( 'os-button' ) ]
				.find( ( b ) => ( b.textContent ?? '' ).trim() === 'Continue' )!
				.hasAttribute( 'disabled' ),
		).toBe( true );
		expect( created ).toHaveLength( 0 );
	} );

	test( 'without an AI provider the brief still seeds the instructions', async () => {
		const { host } = await openWizard();
		setField(
			host,
			'What should this agent do? (system prompt)',
			'Watch my drafts.',
		);
		press( host, 'Continue' );
		await flush();

		// Meet is a character card, not a form: no instructions field
		// here. The brief seeded them in state, and the Launch summary
		// is where they surface — quote them there or the no-AI path
		// looks like it threw the brief away.
		expect(
			[ ...host.body.querySelectorAll( 'os-textarea' ) ].find(
				( f ) =>
					f.getAttribute( 'label' ) === 'Instructions (system prompt)',
			),
		).toBeUndefined();

		setField( host, 'Name', 'Draft Watcher' );
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();
		press( host, 'Continue' );
		await flush();

		const instr = host.body.querySelector( '.dm-agents__summary-instr' );
		expect( instr ).not.toBeNull();
		expect( instr!.textContent ).toContain( 'Watch my drafts.' );
	} );

	test( 'the portrait is captioned with its silhouette and hue', async () => {
		const { host } = await openWizard();
		press( host, 'Continue' );
		await flush();

		// Two chips under the portrait: the face as two words. Derived
		// from the look, so they must always be present and non-empty.
		const chips = [
			...host.body.querySelectorAll( '.dm-agents__portrait-chips os-chip' ),
		].map( ( c ) => c.getAttribute( 'label' ) );
		expect( chips ).toHaveLength( 2 );
		for ( const label of chips ) {
			expect( label ).toBeTruthy();
		}
	} );

	/** Walk to Powers with the catalogue the test installed. */
	async function openPowers() {
		const { host } = await openWizard();
		press( host, 'Continue' );
		await flush();
		setField( host, 'Name', 'Overloaded' );
		press( host, 'Continue' );
		await flush();
		return host;
	}

	test( 'a short ability list stays open and unfiltered', async () => {
		// Two abilities and two groups. Collapsing those, or putting a
		// search box over them, would be ceremony over a list you can
		// read in one glance.
		const host = await openPowers();

		const search = [ ...host.body.querySelectorAll( 'os-text-field' ) ].find(
			( f ) => f.getAttribute( 'label' ) === 'Search abilities',
		);
		expect( search ).toBeUndefined();
		const groups = [
			...host.body.querySelectorAll< HTMLDetailsElement >(
				'.dm-agents__ability-group',
			),
		];
		expect( groups.length ).toBeGreaterThan( 0 );
		expect( groups.every( ( g ) => g.open ) ).toBe( true );
	} );

	test( 'a long ability list gets a search box and starts collapsed', async () => {
		// Dani's site renders about fifty. Flat and all-open, that is a
		// wall to scroll with the group headings as its only landmarks.
		abilityCatalogue = bigCatalogue( 50 );
		const host = await openPowers();

		const search = [ ...host.body.querySelectorAll( 'os-text-field' ) ].find(
			( f ) => f.getAttribute( 'label' ) === 'Search abilities',
		);
		expect( search ).toBeDefined();

		const groups = [
			...host.body.querySelectorAll< HTMLDetailsElement >(
				'.dm-agents__ability-group',
			),
		];
		expect( groups ).toHaveLength( 3 );
		expect( groups.some( ( g ) => g.open ) ).toBe( false );
		// A closed group still says how much is in it.
		expect( host.body.textContent ).toContain( 'Allterrain-fields' );
	} );

	test( 'searching narrows the list and opens what matched', async () => {
		abilityCatalogue = bigCatalogue( 50 );
		const host = await openPowers();

		setField( host, 'Search abilities', 'custom field' );
		await flush();

		const groups = [
			...host.body.querySelectorAll< HTMLDetailsElement >(
				'.dm-agents__ability-group',
			),
		];
		// One ability matches, on its description rather than its
		// label. Plugin authors name abilities for themselves, and
		// "the one that reads custom fields" is what people remember.
		expect( groups ).toHaveLength( 1 );
		expect( groups[ 0 ].open ) .toBe( true );
		expect(
			groups[ 0 ].querySelectorAll( 'os-checkbox-label' ),
		).toHaveLength( 1 );
	} );

	test( 'a search that matches nothing says so', async () => {
		abilityCatalogue = bigCatalogue( 50 );
		const host = await openPowers();

		setField( host, 'Search abilities', 'zzzz' );
		await flush();

		expect( host.body.textContent ).toContain( 'No ability matches "zzzz"' );
	} );

	test( 'a ticked ability keeps its group open', async () => {
		// A checked box folded out of sight is how someone loses track
		// of what they granted.
		abilityCatalogue = bigCatalogue( 50 );
		const host = await openPowers();

		const first = host.body.querySelector( 'os-checkbox-label' );
		expect( first ).not.toBeNull();
		first!.dispatchEvent(
			new CustomEvent( 'os-checkbox-change', {
				detail: { checked: true },
				bubbles: true,
			} ),
		);
		await flush();

		const open = [
			...host.body.querySelectorAll< HTMLDetailsElement >(
				'.dm-agents__ability-group',
			),
		].filter( ( g ) => g.open );
		expect( open ).toHaveLength( 1 );
		expect( open[ 0 ].textContent ).toContain( '1 of' );
	} );
} );

describe( 'face captions', () => {
	test( 'names the hue the way the mockup does', () => {
		// The two calibration points the design names out loud:
		// 44° is amber, 188° is teal.
		expect( faceHueName( { appearance: { hueStart: 44 }, physics: {} } ) ).toBe(
			'amber',
		);
		expect( faceHueName( { appearance: { hueStart: 188 }, physics: {} } ) ).toBe(
			'teal',
		);
	} );

	test( 'a hue is a point on a wheel, wherever the number came from', () => {
		// hueStart ranges over [-720, 720]; the name must not care.
		expect( faceHueName( { appearance: { hueStart: -316 }, physics: {} } ) ).toBe(
			faceHueName( { appearance: { hueStart: 44 }, physics: {} } ),
		);
		expect( faceHueName( { appearance: { hueStart: 404 }, physics: {} } ) ).toBe(
			faceHueName( { appearance: { hueStart: 44 }, physics: {} } ),
		);
	} );

	test( 'an empty look is captioned as the shipped Mio, not as a blank', () => {
		expect( faceShapeName( null ) ).not.toBe( '' );
		expect( faceHueName( null ) ).not.toBe( '' );
		expect( faceShapeName( { appearance: {}, physics: {} } ) ).not.toBe( '' );
	} );

	test( 'the silhouette chip is the preset word', () => {
		expect(
			faceShapeName( { appearance: {}, physics: { shapePreset: 'star' } } ),
		).toBe( 'star' );
	} );
} );
