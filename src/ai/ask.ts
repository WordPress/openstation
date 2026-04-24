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

import { listAiCallableCommands, findCommand } from '../commands';
import type {
	CommandContext,
	CommandResult,
	CommandAdminLink,
	CommandEntity,
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
	fallbackContext?: () => CommandContext;
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
 * Factory — binds to a config getter so the caller (desktop.ts) can
 * hand in the live shell config without this module reading globals.
 *
 * @since 0.17.0
 */
export function createAsk( deps: AskDeps ) {
	return async function ask(
		query: string,
		opts: AskOptions = {},
	): Promise< AskResult > {
		const text = ( query ?? '' ).trim();
		if ( text === '' ) {
			return {
				answer_type: 'chat',
				message: '',
				entity: null,
				admin_links: null,
			};
		}

		const config = deps.config();
		const url = config.aiSearchUrl ?? '';
		const nonce = config.restNonce ?? '';
		if ( ! url || ! nonce ) {
			throw new Error(
				'[wp-desktop-mode] wp.desktop.ai.ask: aiSearchUrl / restNonce missing from config. AI Copilot may not be enabled.',
			);
		}

		const command_tools = normaliseToolsOpt( opts.tools );
		const sp = normaliseSystemPrompt( opts.systemPrompt );

		const body: Record< string, unknown > = { query: text };
		if ( opts.resumeTool ) {
			body.resume_tool = opts.resumeTool;
		}
		if ( typeof opts.startOffset === 'number' ) {
			body.start_offset = opts.startOffset;
		}
		if ( command_tools.length > 0 ) {
			body.command_tools = command_tools;
		}
		if ( sp ) {
			body.system_prompt_text = sp.text;
			body.system_prompt_mode = sp.mode;
		}

		let res: Response;
		try {
			res = await fetch( url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': nonce,
				},
				body: JSON.stringify( body ),
				signal: opts.signal,
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

		// -----------------------------------------------------------
		// Tool-call short-circuit — the server said the model's
		// answer was to invoke a slash-command. Look it up locally
		// and run it. Failures don't reject the promise: we wrap
		// them in `{ error: ... }` so the caller has a uniform
		// `AskResult` shape.
		// -----------------------------------------------------------
		if ( payload.answer_type === 'tool_call' && payload.tool ) {
			const slug = payload.tool.slug;
			const args = payload.tool.args ?? '';
			const cmd = findCommand( slug );
			if ( ! cmd ) {
				return {
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
				};
			}

			const ctx: CommandContext =
				opts.commandContext ??
				deps.fallbackContext?.() ??
				{
					close: () => void 0,
					openInWindow: () => void 0,
					confirm: () => Promise.resolve( true ),
				};

			let result: CommandResult | { error: string };
			try {
				const maybe = await Promise.resolve( cmd.run( args, ctx ) );
				result = maybe;
			} catch ( err ) {
				result = {
					error: String( ( err as Error )?.message ?? err ),
				};
			}

			// Lift a plain-string command return into `message` so
			// the caller doesn't need to type-check every time. This
			// is the one-shot fallback; the follow-up leg below
			// overwrites `message` with the AI-composed reply.
			let message = payload.message ?? '';
			if ( typeof result === 'string' && result !== '' && message === '' ) {
				message = result;
			} else if (
				result &&
				typeof result === 'object' &&
				'message' in result &&
				typeof ( result as { message?: string } ).message === 'string' &&
				message === ''
			) {
				message = ( result as { message: string } ).message;
			}

			// ---------------------------------------------------------
			// Follow-up leg (opt-in). Ask the server for an AI-composed
			// reply describing the outcome in the voice of the system
			// prompt. On any failure we preserve the one-shot fallback
			// — the command *did* run; losing the composed reply is a
			// degraded experience, not a user-visible error.
			// ---------------------------------------------------------
			if ( opts.followUp === true ) {
				const followBody: Record< string, unknown > = {
					query: text,
					follow_up: {
						tool: { slug, args },
						// Serialisable projection of the command's return
						// value. Non-object returns (string, void) get
						// wrapped in `{ value: … }` so the server always
						// sees an object it can JSON-stringify.
						result:
							result === undefined
								? { value: null }
								: typeof result === 'object'
									? result
									: { value: result },
					},
				};
				if ( sp ) {
					followBody.system_prompt_text = sp.text;
					followBody.system_prompt_mode = sp.mode;
				}

				try {
					const fRes = await fetch( url, {
						method: 'POST',
						credentials: 'same-origin',
						headers: {
							'Content-Type': 'application/json',
							'X-WP-Nonce': nonce,
						},
						body: JSON.stringify( followBody ),
						signal: opts.signal,
					} );
					if ( fRes.ok ) {
						const fPayload = ( await fRes.json() ) as {
							message?: string;
							request_id?: string;
						};
						if (
							typeof fPayload.message === 'string' &&
							fPayload.message.trim() !== ''
						) {
							message = fPayload.message;
						}
					}
				} catch ( err ) {
					// Abort always propagates — the caller asked to cancel.
					if ( isAbortError( err ) ) {
						throw err;
					}
					// Any other failure: swallow. The tool ran, we have
					// a one-shot `message` already, degraded-not-broken.
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
		}

		return {
			answer_type: payload.answer_type,
			message: payload.message ?? '',
			entity: payload.entity ?? null,
			admin_links: payload.admin_links ?? null,
			request_id: payload.request_id,
			continue: payload.continue ?? null,
		};
	};
}

export type AskFn = ReturnType< typeof createAsk >;
