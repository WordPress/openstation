/**
 * My WordPress — the Agents section's client tests: the character
 * helpers (seeds, faces, the roster stamp), the wizard locals, and
 * renders of the cast grid, the off-state preview, the detail panes
 * and the wizard steps. Split from `my-wordpress.test.ts` along the
 * same seam as the source parts.
 */
import { describe, expect, it } from 'vitest';
import { mockViewContext } from '../../../src/app-runtime/testing';
import app, {
	agentDefaultRole,
	agentFaceSrc,
	agentsRosterStamp,
	emptyCast,
	type AgentsPayload,
	type AppAgent,
	type AppData,
	type AppState,
	type SectionDef,
} from '../my-wordpress.os';

function section( over: Partial< SectionDef > = {} ): SectionDef {
	return {
		id: 'posts',
		label: 'Posts',
		icon: 'dashicons-admin-post',
		kind: 'post',
		post_type: 'post',
		thumbnails: true,
		count: 3,
		...over,
	};
}

function state( over: Partial< AppState > = {} ): AppState {
	return {
		group: '',
		section: '',
		item: 0,
		into: 0,
		relation: '',
		footprint: 0,
		fpName: '',
		query: '',
		page: 1,
		sort: '',
		selected: [],
		view: 'icons',
		pane: 'define',
		casting: false,
		wstep: 0,
		cast: null,
		agentNotice: '',
		briefError: '',
		...over,
	};
}

function data( over: Partial< AppData > = {} ): AppData {
	return {
		siteName: 'Test Site',
		agentsEnabled: false,
		sections: [ section() ],
		groups: [],
		sortOptions: {},
		list: null,
		detail: null,
		folder: null,
		sub: null,
		subDetail: null,
		authors: [],
		categories: [],
		tags: [],
		previewActions: [],
		agents: null,
		hiddenColumns: {},
		...over,
	};
}
// ----------------------------------------------------------- agents

function agent( over: Partial< AppAgent > = {} ): AppAgent {
	return {
		id: 7,
		slug: 'indexer',
		name: 'Indexer',
		description: 'Keeps the archive tidy.',
		instructions: 'Index things.',
		role: 'author',
		abilities: [ 'search_posts' ],
		triggers: [ { kind: 'chat', config: {} } ],
		model: '',
		rateLimit: 0,
		vibes: 'quiet, relentless',
		face: { appearance: { hueStart: 44 }, physics: { shapePreset: 'star' } },
		faceSeed: 9,
		avatarUrl: 'https://example.test/face-7.svg',
		profileUrl: 'https://example.test/wp-admin/user-edit.php?user_id=7',
		...over,
	};
}

function agentsPayload( over: Partial< AgentsPayload > = {} ): AgentsPayload {
	return {
		enabled: true,
		canEnable: true,
		canManage: true,
		canInvoke: true,
		aiAvailable: true,
		aiReady: true,
		connectorsUrl: 'https://example.test/wp-admin/options-connectors.php',
		runWindowId: 'desktop-mode-agent-run',
		restRoot: 'https://example.test/wp-json/',
		restNonce: 'nonce',
		list: [ agent() ],
		roleLabels: { author: 'Author', editor: 'Editor' },
		abilities: [
			{
				slug: 'search_posts',
				label: 'Search posts',
				description: 'Find entries by keyword.',
				category: 'Content',
				readonly: true,
			},
			{
				slug: 'update_post',
				label: 'Update a post',
				description: 'Rewrite an entry.',
				category: 'Content',
				readonly: false,
			},
		],
		triggerKinds: [
			{ slug: 'chat', label: 'Chat', description: 'Open a conversation.', icon: '', wired: true },
			{
				slug: 'send-to',
				label: 'Send to (right-click menu)',
				description: 'Right-click intake.',
				icon: '',
				wired: true,
				config_schema: { properties: { entityKinds: {} } },
			},
			{ slug: 'hook', label: 'WordPress hook', description: '', icon: '', wired: false },
		],
		hooks: [],
		roles: [
			{ slug: 'author', label: 'Author' },
			{ slug: 'editor', label: 'Editor' },
		],
		...over,
	};
}

function agentsSection(): SectionDef {
	return section( { id: 'agents', label: 'Agents', icon: 'x.svg', kind: 'agent', post_type: '', count: 1 } );
}

describe( 'agents helpers', () => {
	it( 'emptyCast rolls a face from the seed and keeps chat on', () => {
		const cast = emptyCast( 'author', 42 );
		expect( cast.role ).toBe( 'author' );
		expect( cast.faceSeed ).toBe( 42 );
		expect( cast.stripSeed ).toBe( 42 );
		expect( cast.triggers ).toEqual( [ { kind: 'chat', config: {} } ] );
		expect( Object.keys( cast.face.appearance ).length ).toBeGreaterThan( 0 );
		// Deterministic: the same seed always gives the same face.
		expect( emptyCast( 'author', 42 ).face ).toEqual( cast.face );
	} );

	it( 'agentDefaultRole prefers author and falls back to the first allowed role', () => {
		expect( agentDefaultRole( null ) ).toBe( 'author' );
		expect( agentDefaultRole( [ { slug: 'author', label: 'Author' } ] ) ).toBe( 'author' );
		expect( agentDefaultRole( [ { slug: 'editor', label: 'Editor' } ] ) ).toBe( 'editor' );
	} );

	it( 'agentFaceSrc prefers the written portrait and falls back to the seed roll', () => {
		expect( agentFaceSrc( agent(), 88 ) ).toBe( 'https://example.test/face-7.svg' );
		const rolled = agentFaceSrc( agent( { face: { appearance: {}, physics: {} } } ), 88 );
		expect( rolled.startsWith( 'data:image/svg+xml' ) ).toBe( true );
		// No face, no seed: whatever avatar the server sent (the glyph).
		expect(
			agentFaceSrc( agent( { face: { appearance: {}, physics: {} }, faceSeed: 0 } ), 88 ),
		).toBe( 'https://example.test/face-7.svg' );
	} );

	it( 'agentsRosterStamp captures who exists and which doors they answer', () => {
		const a = agent();
		const stamp = agentsRosterStamp( [ a ] );
		expect( agentsRosterStamp( [ a ] ) ).toBe( stamp );
		expect(
			agentsRosterStamp( [ { ...a, triggers: [ ...a.triggers, { kind: 'send-to', config: {} } ] } ] ),
		).not.toBe( stamp );
		expect( agentsRosterStamp( [ a, agent( { id: 8 } ) ] ) ).not.toBe( stamp );
	} );

	it( 'wizard locals reduce without a request', () => {
		expect( app.hasLocal( 'agent-start' ) ).toBe( true );
		expect( app.hasLocal( 'agent-create' ) ).toBe( false );
		const started = app.runLocal(
			'agent-start',
			state( { section: 'agents' } ),
			{},
			data( { agents: agentsPayload() } ),
		) as AppState;
		expect( started.casting ).toBe( true );
		expect( started.wstep ).toBe( 0 );
		expect( ( started.cast as { role: string } ).role ).toBe( 'author' );

		const copied = app.runLocal(
			'agent-start',
			state( { section: 'agents' } ),
			{ from: agent() },
			data( { agents: agentsPayload() } ),
		) as AppState;
		expect( copied.wstep ).toBe( 1 );
		const cast = copied.cast as { name: string; copiedFrom: string; faceSeed: number };
		expect( cast.name ).toContain( 'Indexer' );
		expect( cast.copiedFrom ).toBe( 'Indexer' );
		// A copy takes the work but not the face.
		expect( cast.faceSeed ).not.toBe( 9 );

		const stepped = app.runLocal( 'agent-step', copied, { step: 3 }, data() ) as AppState;
		expect( stepped.wstep ).toBe( 3 );
		const cancelled = app.runLocal( 'agent-cancel', stepped, {}, data() ) as AppState;
		expect( cancelled.casting ).toBe( false );
		expect( cancelled.cast ).toBeNull();
	} );
} );

describe( 'agents view', () => {
	function mountAgents(
		s: Partial< AppState >,
		payload: AgentsPayload,
		dispatch: ( action: string, args?: Record< string, unknown > ) => Promise< boolean > = async () => true,
	): HTMLElement {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		app.render( mockViewContext( {
			state: state( { section: 'agents', ...s } ),
			data: data( { sections: [ section(), agentsSection() ], agents: payload } ),
			root,
			dispatch,
		} ) );
		return root;
	}

	it( 'paints the cast grid with faces, vibes, role badges and the door', () => {
		const root = mountAgents( {}, agentsPayload() );
		expect( root.querySelector( '.dm-agents' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Your cast' );
		expect( root.textContent ).toContain( 'Indexer' );
		expect( root.textContent ).toContain( 'quiet, relentless' );
		expect( root.textContent ).toContain( 'Author' );
		expect( root.querySelector( '.dm-agents__cast-card[data-agent-id="7"]' ) ).not.toBeNull();
		expect( root.querySelector( '.dm-agents__cast-new' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Cast a new agent' );
		// The footer counts the cast, and no search band renders.
		expect( root.textContent ).toContain( '1 agent' );
		expect( root.querySelector( '.os-mywp__search' ) ).toBeNull();
	} );

	it( 'the off state draws the preview crew, greyed, above the enable bar', () => {
		const root = mountAgents(
			{},
			agentsPayload( {
				enabled: false,
				list: [],
				abilities: [],
				roles: null,
				preview: [
					{
						name: 'Localizer',
						vibes: 'multilingual',
						description: 'Translates everything.',
						role: 'editor',
						roleLabel: 'Editor',
						face: { appearance: {}, physics: {} },
					},
				],
			} ),
		);
		expect( root.querySelector( '.dm-agents.is-disabled' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Agents are turned off' );
		expect( root.textContent ).toContain( 'The crew you would get' );
		expect( root.textContent ).toContain( 'Localizer' );
		expect( root.querySelector( '.dm-agents__cast--preview' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Turn on Agents' );
		// Inert: preview cards carry no id and no interactivity.
		expect( root.querySelector( '.dm-agents__cast--preview [data-agent-id]' ) ).toBeNull();
	} );

	it( 'the detail view carries the tabs, the verbs and the ability checklist', () => {
		const root = mountAgents( { item: 7, pane: 'tools' }, agentsPayload() );
		expect( root.textContent ).toContain( '@agent-indexer' );
		expect( root.textContent ).toContain( 'Open profile' );
		expect( root.textContent ).toContain( 'Chat' );
		expect( root.querySelector( '[os-action="agent-delete"]' ) ).not.toBeNull();
		// The Tools pane: both abilities, with their access badges.
		expect( root.querySelector( 'os-checkbox-label[label="Search posts"]' ) ).not.toBeNull();
		expect( root.querySelector( 'os-checkbox-label[label="Update a post"]' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'read-only' );
		expect( root.textContent ).toContain( 'can modify' );
	} );

	it( 'the wizard walks Describe with the starters and the AI door', () => {
		const root = mountAgents(
			{ casting: true, wstep: 0, cast: emptyCast( 'author', 5 ) },
			agentsPayload(),
		);
		expect( root.textContent ).toContain( 'New agent' );
		expect( root.querySelectorAll( 'os-step' ) ).toHaveLength( 5 );
		expect( root.textContent ).toContain( 'Start from someone' );
		expect( root.textContent ).toContain( 'Draft it for me' );
		expect( root.textContent ).toContain( 'I will fill it in myself' );
	} );

	it( 'Meet shows the portrait, twelve candidates and the identity chips', () => {
		const root = mountAgents(
			{ casting: true, wstep: 1, cast: emptyCast( 'author', 5 ) },
			agentsPayload(),
		);
		expect( root.querySelector( '.dm-agents__portrait-face' ) ).not.toBeNull();
		expect( root.querySelectorAll( '.dm-agents__face-pick' ) ).toHaveLength( 12 );
		expect( root.querySelector( '.dm-agents__face-pick.is-picked' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Surprise me' );
		expect( root.querySelector( 'os-text-field[label="Vibes"]' ) ).not.toBeNull();
		// The silhouette + hue chips are derived from the look.
		expect( root.querySelectorAll( '.dm-agents__portrait-chips os-chip' ) ).toHaveLength( 2 );
	} );

	it( 'Launch summarizes the character and offers Create and chat when AI is ready', () => {
		const cast = emptyCast( 'author', 5 );
		cast.name = 'Casey';
		cast.vibes = 'calm';
		cast.abilities = [ 'search_posts' ];
		const root = mountAgents( { casting: true, wstep: 4, cast }, agentsPayload() );
		expect( root.textContent ).toContain( 'Casey' );
		expect( root.textContent ).toContain( 'Create agent' );
		expect( root.textContent ).toContain( 'Create and chat' );
		expect( root.querySelector( '.dm-agents__chips os-chip[label="Search posts"]' ) ).not.toBeNull();

		const noAi = mountAgents(
			{ casting: true, wstep: 4, cast },
			agentsPayload( { aiReady: false } ),
		);
		expect( noAi.textContent ).not.toContain( 'Create and chat' );
		expect( noAi.textContent ).toContain(
			'No AI provider is configured — agents cannot run until a connector is set up.',
		);
	} );
} );
