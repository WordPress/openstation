import {
	listAiCallableCommands,
	findCommand,
	type CommandContext,
	type CommandResult,
	type CommandAdminLink,
	type CommandEntity,
} from '../commands';
import type { DesktopConfig } from '../types';
import { trackedFetch } from '../tracked-fetch';

export interface AskOptions {

	signal?: AbortSignal;

	resumeTool?: 'search_posts' | 'search_pages' | 'search_comments';
	startOffset?: number;

	tools?: boolean | 'aiCallable' | string[] | ( ( slug: string ) => boolean );

	commandContext?: CommandContext;

	followUp?: boolean;

	systemPrompt?:
		| string
		| { mode: 'append' | 'replace'; text: string };
}

export interface AskToolCall {
	slug: string;
	args: string;

	result: CommandResult | { error: string };
}

export interface AskResult {
	answer_type: 'entity' | 'navigation' | 'chat' | 'tool_call';
	message: string;
	entity?: CommandEntity | null;
	admin_links?: CommandAdminLink[] | null;

	toolCall?: AskToolCall;

	request_id?: string;

	continue?: { tool: string; offset: number; label: string } | null;
}

interface AskDeps {
	config: () => Pick< DesktopConfig, 'aiSearchUrl' | 'restNonce' > & {
		aiSearchUrl?: string;
		restNonce?: string;
	};

	fallbackContext: () => CommandContext;
}

const isAbortError = ( err: unknown ): boolean => {
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

export function createAsk( deps: AskDeps ) {
	const postToSearch = async (
		body: Record< string, unknown >,
		signal: AbortSignal | undefined,
	): Promise< Response > => {
		const config = deps.config();
		const url = config.aiSearchUrl ?? '';
		const nonce = config.restNonce ?? '';
		if ( ! url || ! nonce ) {
			throw new Error(
				'[openstation] wp.os.ai.ask: aiSearchUrl / restNonce missing from config. AI Copilot may not be enabled.',
			);
		}
		try {
			return await trackedFetch(
				url,
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': nonce,
					},
					body: JSON.stringify( body ),
					signal,
				},
				{ source: 'desktop-mode/ai-ask' },
			);
		} catch ( err ) {
			if ( isAbortError( err ) ) {
				throw err;
			}
			throw new Error(
				`[openstation] wp.os.ai.ask: network error — ${ String(
					( err as Error )?.message ?? err,
				) }`,
			);
		}
	};

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
			const hasMeaningfulOpts =
				opts.tools !== undefined ||
				opts.systemPrompt !== undefined ||
				opts.followUp === true ||
				opts.resumeTool !== undefined ||
				opts.commandContext !== undefined;
			if ( hasMeaningfulOpts ) {
				throw new Error(
					'[openstation] wp.os.ai.ask: empty query passed with non-default options — likely a caller bug. Provide a query or call without options.',
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
				`[openstation] wp.os.ai.ask: HTTP ${ res.status } — ${
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
