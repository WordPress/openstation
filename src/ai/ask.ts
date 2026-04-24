/**
 * `wp.desktop.ai.ask( query, opts? )` — programmatic access to the
 * AI Copilot, the same endpoint the built-in overlay talks to.
 *
 * Three jobs:
 *   1. POST `/wp-desktop/v1/ai/search` with the user's query plus
 *      whichever extension knobs the caller passed (system prompt
 *      override, command-tool harvest opt-in).
 *   2. Resolve with the server's answer payload — transparent for
 *      `answer_type: entity | navigation | chat`.
 *   3. When the server returns `answer_type: 'tool_call'` (the model
 *      decided the user's request matches a slash-command), look up
 *      the command in the client registry, invoke its `run()` with
 *      a `CommandContext`, and fold the return value into the final
 *      resolved shape so every caller has one place to read the
 *      outcome.
 *
 * The `ask()` contract is deliberately narrow — one call, one
 * promise, no streaming events. For live SSE progress, reach for
 * the existing `aiSearchStreamUrl` (admin-ajax) surface; `ask()` is
 * the "give me the answer" API.
 *
 * @since 0.17.0
 */

import {
	listAiCallableCommands,
	findCommand,
	type CommandContext,
	type CommandResult,
	type CommandAdminLink,
	type CommandEntity,
} from '../commands';
import type { DesktopConfig } from '../types';

export interface AskOptions {
	/** AbortSignal for cancellation. Propagates to the underlying `fetch`. */
	signal?: AbortSignal;

	/**
	 * Resume a previous exhausted search from the `continue` pointer
	 * a prior `ask()` returned. Pass them through verbatim.
	 */
	resumeTool?: 'search_posts' | 'search_pages' | 'search_comments';
	startOffset?: number;

	/**
	 * Opt into including the registered slash-commands as tools the
	 * AI can invoke on the user's behalf.
	 *
	 *   - `false` (default) — no command tools are sent.
	 *   - `'aiCallable'`    — every command with `aiCallable: true`
	 *                         is harvested and sent as a tool.
	 *   - `string[]`        — explicit slug allowlist (subset of the
	 *                         `aiCallable: true` set).
	 *   - `( cmd ) => bool` — custom predicate; receives the full
	 *                         `DesktopCommand` and returns whether it
	 *                         should be offered. Use this for per-user
	 *                         gating or env-specific overrides.
	 *
	 * Regardless of the value passed here, only commands the plugin
	 * flagged `aiCallable: true` are ever visible — the predicate
	 * can only narrow, never widen. Security rationale: a command
	 * registration is the authoritative "is this safe for AI
	 * invocation?" signal.
	 */
	tools?: boolean | 'aiCallable' | string[] | ( ( slug: string ) => boolean );

	/**
	 * Context object handed to any command's `run()` when the AI
	 * decides to invoke one. Falls back to a minimal stub that
	 * closes the assistant and opens wp-admin URLs via the window
	 * manager — same as what the built-in overlay provides.
	 */
	commandContext?: CommandContext;

	/**
	 * Ask the AI to compose a natural-language reply *about* the
	 * command it just dispatched. Off by default (one-shot mode —
	 * `res.message` is whatever the plugin's `run()` returned).
	 *
	 * When `true`, after the command runs locally, `ask()` fires a
	 * second `/ai/search` request carrying the tool outcome. The
	 * server runs a single-turn, no-tool OpenAI call that produces
	 * a one- or two-sentence confirmation in the voice of the
	 * system prompt (e.g. "Done — your office light is on now").
	 *
	 * Cost: one extra OpenAI round-trip per command invocation.
	 * Latency: roughly doubles. Use for voice / chat / assistant
	 * surfaces where the conversational reply matters. Skip for
	 * one-tap "execute" buttons where the raw `run()` return is
	 * fine.
	 *
	 * If the follow-up call fails (network, API, etc.), `ask()`
	 * degrades gracefully — the primary `toolCall.result` is
	 * preserved and `message` falls back to the raw `run()` return.
	 *
	 * @since 0.17.0
	 */
	followUp?: boolean;

	/**
	 * Optional system-prompt override. Two shapes:
	 *   - `string`  — appended to the built-in prompt (safe).
	 *   - `{ mode: 'append' | 'replace', text }` — explicit mode.
	 *
	 * Server-side, `mode: 'replace'` is gated on a capability that
	 * defaults to `manage_options` and is filterable via
	 * `wp_desktop_ai_system_prompt_replace_capability`. Non-admin
	 * callers sending `replace` get a silent downgrade to `append`.
	 */
	systemPrompt?:
		| string
		| { mode: 'append' | 'replace'; text: string };
}

export interface AskToolCall {
	slug: string;
	args: string;
	/** The value the command's `run()` returned (or threw). */
	result: CommandResult | { error: string };
}

export interface AskResult {
	answer_type: 'entity' | 'navigation' | 'chat' | 'tool_call';
	message: string;
	entity?: CommandEntity | null;
	admin_links?: CommandAdminLink[] | null;
	/** Present only when `answer_type === 'tool_call'`. */
	toolCall?: AskToolCall;
	/** Server-issued UUID for tracing across hooks. */
	request_id?: string;
	/** Continuation pointer when the agent exhausted its budget. */
	continue?: { tool: string; offset: number; label: string } | null;
}

interface AskDeps {
	config: () => Pick< DesktopConfig, 'aiSearchUrl' | 'restNonce' > & {
		aiSearchUrl?: string;
		restNonce?: string;
	};
	/**
	 * Builds the default `CommandContext` handed to a command's
	 * `run()` when the caller doesn't pass their own. Required —
	 * `desktop.ts` wires a real one that closes the assistant and
	 * opens windows via the window manager. Tests pass whatever
	 * minimal stub they need.
	 */
	fallbackContext: () => CommandContext;
}

const isAbortError = ( err: unknown ): boolean => {
	// `instanceof DOMException` is the textbook check, but it fails in
	// jsdom / cross-realm when the thrown value's prototype chain
	// doesn't include the current realm's DOMException. Duck-type on
	// `name === 'AbortError'` — matches the platform spec, survives
	// the realm split.
	if ( ! err || typeof err !== 'object' ) {
		return false;
	}
	return ( err as { name?: string } ).name === 'AbortError';
};

const normaliseToolsOpt = (
	tools: AskOptions[ 'tools' ],
): Array< { slug: string; label: string; description: string; hint: string } > => {
	if ( ! tools ) {
		return [];
	}
	const all = listAiCallableCommands();
	if ( tools === true || tools === 'aiCallable' ) {
		return all;
	}
	if ( Array.isArray( tools ) ) {
		// Slugs stored in the registry are already lowercase (enforced
		// at `registerCommand` time), so we can match them directly —
		// the caller's list is compared against canonical slugs, with
		// a `.toLowerCase()` on the caller's side only if they passed
		// mixed-case strings.
		const allowed = new Set( tools.map( ( s ) => s.toLowerCase() ) );
		return all.filter( ( c ) => allowed.has( c.slug ) );
	}
	if ( typeof tools === 'function' ) {
		return all.filter( ( c ) => {
			try {
				return tools( c.slug ) === true;
			} catch {
				return false;
			}
		} );
	}
	return [];
};

const normaliseSystemPrompt = (
	sp: AskOptions[ 'systemPrompt' ],
): { text: string; mode: 'append' | 'replace' } | null => {
	if ( ! sp ) {
		return null;
	}
	if ( typeof sp === 'string' ) {
		return { text: sp, mode: 'append' };
	}
	if (
		typeof sp === 'object' &&
		typeof sp.text === 'string' &&
		sp.text !== ''
	) {
		return {
			text: sp.text,
			mode: sp.mode === 'replace' ? 'replace' : 'append',
		};
	}
	return null;
};

/**
 * Pick the first non-empty string out of the command's return value
 * and the server's initial payload. Used to seed `message` when the
 * follow-up leg is skipped. Extracted so the logic has one home.
 */
function liftMessage(
	payloadMessage: string | undefined,
	result: CommandResult | { error: string },
): string {
	const seed = payloadMessage ?? '';
	if ( seed !== '' ) {
		return seed;
	}
	if ( typeof result === 'string' && result !== '' ) {
		return result;
	}
	if (
		result &&
		typeof result === 'object' &&
		'message' in result &&
		typeof ( result as { message?: string } ).message === 'string'
	) {
		return ( result as { message: string } ).message;
	}
	return '';
}

/**
 * Serialise the command's return value into the shape
 * `/ai/search`'s `follow_up.result` expects. Non-object returns
 * (string / void) get wrapped as `{ value: … }` so the server
 * always sees an object it can JSON-encode.
 */
function serialiseOutcome(
	result: CommandResult | { error: string } | undefined,
): Record< string, unknown > {
	if ( result === undefined ) {
		return { value: null };
	}
	if ( typeof result === 'object' && result !== null ) {
		return result as Record< string, unknown >;
	}
	return { value: result };
}

/**
 * Factory — binds to a config getter so the caller (desktop.ts) can
 * hand in the live shell config without this module reading globals.
 *
 * @since 0.17.0
 */
export function createAsk( deps: AskDeps ) {
	// ------------------------------------------------------------
	// Helper — POST to /ai/search + normalise errors. Used for both
	// the primary leg and the follow-up leg. Keeps network + error
	// semantics in one place.
	// ------------------------------------------------------------
	const postToSearch = async (
		body: Record< string, unknown >,
		signal: AbortSignal | undefined,
	): Promise< Response > => {
		const config = deps.config();
		const url = config.aiSearchUrl ?? '';
		const nonce = config.restNonce ?? '';
		if ( ! url || ! nonce ) {
			throw new Error(
				'[wp-desktop-mode] wp.desktop.ai.ask: aiSearchUrl / restNonce missing from config. AI Copilot may not be enabled.',
			);
		}
		try {
			return await fetch( url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': nonce,
				},
				body: JSON.stringify( body ),
				signal,
			} );
		} catch ( err ) {
			if ( isAbortError( err ) ) {
				throw err;
			}
			throw new Error(
				`[wp-desktop-mode] wp.desktop.ai.ask: network error — ${ String(
					( err as Error )?.message ?? err,
				) }`,
			);
		}
	};

	// ------------------------------------------------------------
	// Helper — when the server returned `tool_call`, find the
	// command in the client registry, build a CommandContext, run
	// it, and catch failures into a structured `{ error }` payload
	// so the `AskResult` shape stays uniform.
	// ------------------------------------------------------------
	const dispatchToolCall = async (
		payload: AskResult & { tool?: { slug: string; args: string } },
		opts: AskOptions,
	): Promise<
		| {
			ok: true;
			slug: string;
			args: string;
			result: CommandResult | { error: string };
		}
		| {
			ok: false;
			response: AskResult;
		}
	> => {
		const slug = payload.tool?.slug ?? '';
		const args = payload.tool?.args ?? '';
		const cmd = findCommand( slug );
		if ( ! cmd ) {
			return {
				ok: false,
				response: {
					answer_type: 'tool_call',
					message: `Command /${ slug } was not registered on this page.`,
					entity: null,
					admin_links: null,
					toolCall: {
						slug,
						args,
						result: { error: 'command_not_found' },
					},
					request_id: payload.request_id,
				},
			};
		}

		const ctx: CommandContext = opts.commandContext ?? deps.fallbackContext();

		let result: CommandResult | { error: string };
		try {
			result = await Promise.resolve( cmd.run( args, ctx ) );
		} catch ( err ) {
			result = { error: String( ( err as Error )?.message ?? err ) };
		}
		return { ok: true, slug, args, result };
	};

	// ------------------------------------------------------------
	// Helper — second-leg fetch that asks the server to compose a
	// natural-language reply about the command outcome. Swallows
	// network / HTTP failures so the command result is never lost
	// to a degraded follow-up; `AbortError` still propagates so
	// `AbortController.abort()` behaves uniformly across legs.
	// ------------------------------------------------------------
	const composeFollowUp = async (
		text: string,
		slug: string,
		args: string,
		result: CommandResult | { error: string },
		sp: { text: string; mode: 'append' | 'replace' } | null,
		signal: AbortSignal | undefined,
	): Promise< string | null > => {
		const body: Record< string, unknown > = {
			query: text,
			follow_up: {
				tool: { slug, args },
				result: serialiseOutcome( result ),
			},
		};
		if ( sp ) {
			body.system_prompt_text = sp.text;
			body.system_prompt_mode = sp.mode;
		}

		let res: Response;
		try {
			res = await postToSearch( body, signal );
		} catch ( err ) {
			if ( isAbortError( err ) ) {
				throw err;
			}
			// Degrade — primary result wins.
			return null;
		}
		if ( ! res.ok ) {
			return null;
		}
		const payload = ( await res.json().catch( () => ( {} ) ) ) as {
			message?: string;
		};
		const message = typeof payload.message === 'string' ? payload.message.trim() : '';
		return message !== '' ? payload.message ?? null : null;
	};

	return async function ask(
		query: string,
		opts: AskOptions = {},
	): Promise< AskResult > {
		const text = ( query ?? '' ).trim();
		if ( text === '' ) {
			// Empty query with non-default options is almost certainly
			// a caller bug (someone built up an `opts` object then
			// forgot to populate `query`). Throw loudly for the mixed
			// case; preserve the silent no-op only for bare empty
			// calls where the caller may legitimately want a harmless
			// noop (e.g. debouncing an input field).
			const hasMeaningfulOpts =
				opts.tools !== undefined ||
				opts.systemPrompt !== undefined ||
				opts.followUp === true ||
				opts.resumeTool !== undefined ||
				opts.commandContext !== undefined;
			if ( hasMeaningfulOpts ) {
				throw new Error(
					'[wp-desktop-mode] wp.desktop.ai.ask: empty query passed with non-default options — likely a caller bug. Provide a query or call without options.',
				);
			}
			return {
				answer_type: 'chat',
				message: '',
				entity: null,
				admin_links: null,
			};
		}

		const commandTools = normaliseToolsOpt( opts.tools );
		const sp = normaliseSystemPrompt( opts.systemPrompt );

		// The REST endpoint's request body uses snake_case field names
		// (WordPress convention) — assigned via property access, which
		// the camelcase ESLint rule allows; only bare-identifier
		// locals are required to be camelCase.
		const body: Record< string, unknown > = { query: text };
		if ( opts.resumeTool ) {
			body.resume_tool = opts.resumeTool;
		}
		if ( typeof opts.startOffset === 'number' ) {
			body.start_offset = opts.startOffset;
		}
		if ( commandTools.length > 0 ) {
			body.command_tools = commandTools;
		}
		if ( sp ) {
			body.system_prompt_text = sp.text;
			body.system_prompt_mode = sp.mode;
		}

		const res = await postToSearch( body, opts.signal );

		if ( ! res.ok ) {
			const detail = await res
				.json()
				.catch( () => ( { message: res.statusText } ) );
			throw new Error(
				`[wp-desktop-mode] wp.desktop.ai.ask: HTTP ${ res.status } — ${
					( detail as { message?: string } ).message ?? res.statusText
				}`,
			);
		}

		const payload = ( await res.json() ) as AskResult & {
			tool?: { slug: string; args: string };
		};

		if ( payload.answer_type !== 'tool_call' || ! payload.tool ) {
			return {
				answer_type: payload.answer_type,
				message: payload.message ?? '',
				entity: payload.entity ?? null,
				admin_links: payload.admin_links ?? null,
				request_id: payload.request_id,
				continue: payload.continue ?? null,
			};
		}

		const dispatch = await dispatchToolCall( payload, opts );
		if ( ! dispatch.ok ) {
			return dispatch.response;
		}

		const { slug, args, result } = dispatch;
		let message = liftMessage( payload.message, result );

		if ( opts.followUp === true ) {
			const composed = await composeFollowUp(
				text,
				slug,
				args,
				result,
				sp,
				opts.signal,
			);
			if ( composed !== null ) {
				message = composed;
			}
		}

		return {
			answer_type: 'tool_call',
			message,
			entity: null,
			admin_links: null,
			toolCall: { slug, args, result },
			request_id: payload.request_id,
		};
	};
}

export type AskFn = ReturnType< typeof createAsk >;
