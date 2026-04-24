/**
 * Unit tests for `src/ai/ask.ts` — the `wp.desktop.ai.ask()` wrapper.
 *
 * We stub `fetch` (setup test file doesn't, so each test installs its
 * own stub + teardown) and exercise the three branches that matter:
 *   - Normal `answer_type` response — passes through.
 *   - `tool_call` + command found in registry — run() fires locally.
 *   - `tool_call` + command NOT registered — graceful error payload.
 *
 * Network failures are verified separately so the reject path is
 * explicit.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { createAsk } from '../../src/ai/ask';
import { registerCommand, unregisterCommand } from '../../src/commands';

const CONFIG = {
	aiSearchUrl: 'https://example.test/wp-json/wp-desktop/v1/ai/search',
	restNonce: 'test-nonce',
};

type FetchMock = ReturnType< typeof vi.fn >;

function mockFetchOnce( response: unknown, init: Partial< Response > = {} ): FetchMock {
	const body = JSON.stringify( response );
	const fn = vi.fn( async () => ( {
		ok: true,
		status: 200,
		statusText: 'OK',
		json: async () => JSON.parse( body ),
		...init,
	} ) as unknown as Response );
	( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
	return fn;
}

/**
 * Mock a sequence of fetch responses. Each call to `fetch` drains
 * the next entry; exceeding the sequence throws (catches buggy test
 * expectations rather than silently recycling).
 */
function mockFetchSequence( responses: Array< unknown | Error > ): FetchMock {
	let i = 0;
	const fn = vi.fn( async () => {
		if ( i >= responses.length ) {
			throw new Error( 'fetch called more times than mocked' );
		}
		const next = responses[ i++ ];
		if ( next instanceof Error ) {
			throw next;
		}
		const body = JSON.stringify( next );
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => JSON.parse( body ),
		} as unknown as Response;
	} );
	( globalThis as unknown as { fetch: FetchMock } ).fetch = fn;
	return fn;
}

describe( 'wp.desktop.ai.ask()', () => {
	let originalFetch: typeof fetch | undefined;

	beforeEach( () => {
		originalFetch = ( globalThis as unknown as { fetch?: typeof fetch } ).fetch;
	} );

	afterEach( () => {
		( globalThis as unknown as { fetch?: typeof fetch } ).fetch =
			originalFetch;
	} );

	test( 'posts query + X-WP-Nonce, returns the server payload verbatim', async () => {
		const fetchFn = mockFetchOnce( {
			answer_type: 'chat',
			message: 'Hello.',
			entity: null,
			admin_links: null,
			request_id: 'req-1',
		} );
		const ask = createAsk( { config: () => CONFIG } );

		const res = await ask( 'hi' );

		expect( fetchFn ).toHaveBeenCalledTimes( 1 );
		const [ url, opts ] = fetchFn.mock.calls[ 0 ] as [
			string,
			RequestInit,
		];
		expect( url ).toBe( CONFIG.aiSearchUrl );
		expect( opts.method ).toBe( 'POST' );
		expect(
			( opts.headers as Record< string, string > )[ 'X-WP-Nonce' ],
		).toBe( CONFIG.restNonce );
		expect( JSON.parse( opts.body as string ) ).toEqual( {
			query: 'hi',
		} );

		expect( res.answer_type ).toBe( 'chat' );
		expect( res.message ).toBe( 'Hello.' );
		expect( res.request_id ).toBe( 'req-1' );
	} );

	test( 'empty/whitespace query short-circuits without hitting the network', async () => {
		const fetchFn = mockFetchOnce( { answer_type: 'chat', message: '' } );
		const ask = createAsk( { config: () => CONFIG } );
		const res = await ask( '   ' );
		expect( fetchFn ).not.toHaveBeenCalled();
		expect( res.answer_type ).toBe( 'chat' );
	} );

	test( 'tools: "aiCallable" sends only opted-in commands', async () => {
		registerCommand( {
			slug: 'turn_lights',
			label: 'Turn lights',
			description: 'Toggle smart lights.',
			hint: 'ON or OFF',
			aiCallable: true,
			run: () => 'lights toggled',
		} );
		registerCommand( {
			slug: 'delete_all_posts',
			label: 'Delete all posts',
			aiCallable: false,
			run: () => 'nope',
		} );

		const fetchFn = mockFetchOnce( {
			answer_type: 'chat',
			message: 'ok',
		} );
		const ask = createAsk( { config: () => CONFIG } );
		await ask( 'turn lights on', { tools: 'aiCallable' } );

		const body = JSON.parse(
			fetchFn.mock.calls[ 0 ][ 1 ].body as string,
		);
		expect( Array.isArray( body.command_tools ) ).toBe( true );
		const slugs = body.command_tools.map( ( c: { slug: string } ) => c.slug );
		expect( slugs ).toContain( 'turn_lights' );
		expect( slugs ).not.toContain( 'delete_all_posts' );

		unregisterCommand( 'turn_lights' );
		unregisterCommand( 'delete_all_posts' );
	} );

	test( 'tool_call response invokes the registered command run() locally', async () => {
		const run = vi.fn( ( args: string ) => `did it: ${ args }` );
		registerCommand( {
			slug: 'turn_lights',
			label: 'Turn lights',
			aiCallable: true,
			run,
		} );
		mockFetchOnce( {
			answer_type: 'tool_call',
			message: '',
			tool: { slug: 'turn_lights', args: 'ON' },
			request_id: 'req-tc',
		} );
		const ask = createAsk( { config: () => CONFIG } );

		const res = await ask( 'hey turn on the lights', {
			tools: 'aiCallable',
		} );

		expect( run ).toHaveBeenCalledWith( 'ON', expect.any( Object ) );
		expect( res.answer_type ).toBe( 'tool_call' );
		expect( res.toolCall?.slug ).toBe( 'turn_lights' );
		expect( res.toolCall?.args ).toBe( 'ON' );
		expect( res.toolCall?.result ).toBe( 'did it: ON' );
		// String return lifted into message so callers have a uniform spot.
		expect( res.message ).toBe( 'did it: ON' );

		unregisterCommand( 'turn_lights' );
	} );

	test( 'tool_call for an unknown command returns a structured error', async () => {
		mockFetchOnce( {
			answer_type: 'tool_call',
			message: '',
			tool: { slug: 'ghost_command', args: '' },
		} );
		const ask = createAsk( { config: () => CONFIG } );
		const res = await ask( 'ping' );
		expect( res.answer_type ).toBe( 'tool_call' );
		expect( res.toolCall?.result ).toEqual( {
			error: 'command_not_found',
		} );
	} );

	test( 'thrown command run() is caught and reported', async () => {
		registerCommand( {
			slug: 'explodes',
			label: 'Explodes',
			aiCallable: true,
			run: () => {
				throw new Error( 'kaboom' );
			},
		} );
		mockFetchOnce( {
			answer_type: 'tool_call',
			message: '',
			tool: { slug: 'explodes', args: '' },
		} );
		const ask = createAsk( { config: () => CONFIG } );
		const res = await ask( 'x', { tools: 'aiCallable' } );
		expect( ( res.toolCall?.result as { error: string } ).error ).toBe(
			'kaboom',
		);
		unregisterCommand( 'explodes' );
	} );

	test( 'systemPrompt string maps to { mode: append, text }', async () => {
		const fetchFn = mockFetchOnce( {
			answer_type: 'chat',
			message: 'ok',
		} );
		const ask = createAsk( { config: () => CONFIG } );
		await ask( 'hi', { systemPrompt: 'You are friendly.' } );
		const body = JSON.parse(
			fetchFn.mock.calls[ 0 ][ 1 ].body as string,
		);
		expect( body.system_prompt_text ).toBe( 'You are friendly.' );
		expect( body.system_prompt_mode ).toBe( 'append' );
	} );

	test( 'systemPrompt object passes mode through', async () => {
		const fetchFn = mockFetchOnce( {
			answer_type: 'chat',
			message: 'ok',
		} );
		const ask = createAsk( { config: () => CONFIG } );
		await ask( 'hi', {
			systemPrompt: { mode: 'replace', text: 'Only answer in haiku.' },
		} );
		const body = JSON.parse(
			fetchFn.mock.calls[ 0 ][ 1 ].body as string,
		);
		expect( body.system_prompt_mode ).toBe( 'replace' );
		expect( body.system_prompt_text ).toBe( 'Only answer in haiku.' );
	} );

	test( 'http error is surfaced as a rejection', async () => {
		( globalThis as unknown as { fetch: FetchMock } ).fetch = vi.fn(
			async () =>
				( {
					ok: false,
					status: 403,
					statusText: 'Forbidden',
					json: async () => ( { message: 'AI disabled' } ),
				} ) as unknown as Response,
		);
		const ask = createAsk( { config: () => CONFIG } );
		await expect( ask( 'hi' ) ).rejects.toThrow( /AI disabled/ );
	} );

	test( 'missing aiSearchUrl throws a readable error before fetching', async () => {
		const ask = createAsk( {
			config: () => ( { aiSearchUrl: '', restNonce: '' } ),
		} );
		await expect( ask( 'hi' ) ).rejects.toThrow(
			/aiSearchUrl \/ restNonce missing/,
		);
	} );

	// -------------------------------------------------------------------
	// followUp: true — opt-in second-leg agentic flow
	// -------------------------------------------------------------------

	test( 'followUp: true fires a second fetch with the tool outcome', async () => {
		registerCommand( {
			slug: 'turn_lights',
			label: 'Turn lights',
			aiCallable: true,
			run: () => 'Light is ON.',
		} );

		const fetchFn = mockFetchSequence( [
			// Leg 1 — model picks the command.
			{
				answer_type: 'tool_call',
				message: '',
				tool: { slug: 'turn_lights', args: 'ON' },
				request_id: 'req-1',
			},
			// Leg 2 — server composes a friendly reply.
			{
				answer_type: 'chat',
				message: 'Done — your office light is on now.',
				request_id: 'req-1',
			},
		] );

		const ask = createAsk( { config: () => CONFIG } );
		const res = await ask( 'turn on the lights', {
			tools: 'aiCallable',
			followUp: true,
		} );

		expect( fetchFn ).toHaveBeenCalledTimes( 2 );

		// Leg 2's body carries the follow_up object with tool + result.
		const leg2Body = JSON.parse(
			fetchFn.mock.calls[ 1 ][ 1 ].body as string,
		);
		expect( leg2Body.follow_up.tool ).toEqual( {
			slug: 'turn_lights',
			args: 'ON',
		} );
		// String returns get wrapped as { value: … } for serialisation.
		expect( leg2Body.follow_up.result ).toEqual( {
			value: 'Light is ON.',
		} );

		// The composed reply wins over the raw run() string.
		expect( res.message ).toBe( 'Done — your office light is on now.' );
		expect( res.toolCall?.result ).toBe( 'Light is ON.' );

		unregisterCommand( 'turn_lights' );
	} );

	test( 'followUp: true preserves object command returns verbatim', async () => {
		registerCommand( {
			slug: 'count_things',
			label: 'Count things',
			aiCallable: true,
			run: () => ( { total: 42, breakdown: [ 1, 2, 39 ] } ),
		} );

		const fetchFn = mockFetchSequence( [
			{
				answer_type: 'tool_call',
				message: '',
				tool: { slug: 'count_things', args: '' },
			},
			{ answer_type: 'chat', message: 'Counted 42 items.' },
		] );

		const ask = createAsk( { config: () => CONFIG } );
		await ask( 'how many things are there', {
			tools: 'aiCallable',
			followUp: true,
		} );

		const leg2Body = JSON.parse(
			fetchFn.mock.calls[ 1 ][ 1 ].body as string,
		);
		// Object returns pass through unwrapped.
		expect( leg2Body.follow_up.result ).toEqual( {
			total: 42,
			breakdown: [ 1, 2, 39 ],
		} );

		unregisterCommand( 'count_things' );
	} );

	test( 'followUp: true forwards systemPrompt to the second leg', async () => {
		registerCommand( {
			slug: 'noop',
			label: 'No-op',
			aiCallable: true,
			run: () => 'ok',
		} );

		const fetchFn = mockFetchSequence( [
			{
				answer_type: 'tool_call',
				message: '',
				tool: { slug: 'noop', args: '' },
			},
			{ answer_type: 'chat', message: 'Done.' },
		] );

		const ask = createAsk( { config: () => CONFIG } );
		await ask( 'noop', {
			tools: 'aiCallable',
			followUp: true,
			systemPrompt: 'Reply in haiku.',
		} );

		const leg2 = JSON.parse(
			fetchFn.mock.calls[ 1 ][ 1 ].body as string,
		);
		expect( leg2.system_prompt_text ).toBe( 'Reply in haiku.' );
		expect( leg2.system_prompt_mode ).toBe( 'append' );

		unregisterCommand( 'noop' );
	} );

	test( 'followUp: true degrades gracefully when leg 2 fails', async () => {
		registerCommand( {
			slug: 'unreliable',
			label: 'Unreliable',
			aiCallable: true,
			run: () => 'primary result',
		} );

		mockFetchSequence( [
			{
				answer_type: 'tool_call',
				message: '',
				tool: { slug: 'unreliable', args: '' },
			},
			new Error( 'network fail on leg 2' ),
		] );

		const ask = createAsk( { config: () => CONFIG } );
		const res = await ask( 'try it', {
			tools: 'aiCallable',
			followUp: true,
		} );

		// The command *did* run, so we keep the primary result + the
		// one-shot fallback message. No exception surfaces.
		expect( res.toolCall?.result ).toBe( 'primary result' );
		expect( res.message ).toBe( 'primary result' );

		unregisterCommand( 'unreliable' );
	} );

	test( 'followUp: true skips leg 2 when answer_type is not tool_call', async () => {
		const fetchFn = mockFetchSequence( [
			{ answer_type: 'chat', message: 'just chatting' },
		] );

		const ask = createAsk( { config: () => CONFIG } );
		const res = await ask( 'hello', { followUp: true } );

		// Only one fetch — follow-up is only relevant for tool_call.
		expect( fetchFn ).toHaveBeenCalledTimes( 1 );
		expect( res.message ).toBe( 'just chatting' );
	} );

	test( 'followUp: true aborts cleanly if the caller cancels during leg 2', async () => {
		registerCommand( {
			slug: 'abortable',
			label: 'Abortable',
			aiCallable: true,
			run: () => 'primary',
		} );

		// jsdom's `DOMException` is flaky around the second constructor
		// arg (doesn't reliably set `name`), so build the AbortError
		// shape directly — all `ask()` checks is `err.name`.
		const abortErr = Object.assign( new Error( 'aborted' ), {
			name: 'AbortError',
		} );
		mockFetchSequence( [
			{
				answer_type: 'tool_call',
				message: '',
				tool: { slug: 'abortable', args: '' },
			},
			abortErr,
		] );

		const controller = new AbortController();
		const ask = createAsk( { config: () => CONFIG } );
		await expect(
			ask( 'try', {
				tools: 'aiCallable',
				followUp: true,
				signal: controller.signal,
			} ),
		).rejects.toBe( abortErr );

		unregisterCommand( 'abortable' );
	} );
} );
