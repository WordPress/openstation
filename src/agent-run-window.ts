/**
 * Desktop Mode — Agents: "Agent chat" window bundle.
 *
 * Lazy-loaded by the native-window sync the first time the
 * `desktop-mode-agent-run` window opens. Registers the render
 * callback on `window.desktopModeNativeWindows` and paints the
 * conversation for the agent seeded into the cross-bundle
 * `desktop-mode/agents-chat` shared store by the opener (the My
 * WordPress Agents section today; send-to and drag intakes in later
 * phases).
 *
 * Each send is one `POST /desktop-mode/v1/agents/:id/invoke`
 * round-trip — no streaming yet. Transcripts live in the shared
 * store for the session only.
 *
 * @public
 */

import { __ } from './i18n';
import { trackedFetch } from './tracked-fetch';
import './ui/components/wpd-button/wpd-button';
import './ui/components/wpd-empty-state/wpd-empty-state';
import './ui/components/wpd-spinner/wpd-spinner';
import './ui/components/wpd-textarea/wpd-textarea';
import {
	agentsChatStore,
	type AgentChatAgent,
	type AgentChatMessage,
} from './agents-chat-store';
import type { AgentInvokeResult } from './my-wordpress/agents-types';

const WINDOW_ID = 'desktop-mode-agent-run';

interface RunWindowConfig {
	restRoot: string;
	restNonce: string;
	canManage: boolean;
}

type RenderCallback = (
	body: HTMLElement,
	ctx?: { signal?: AbortSignal },
) => void | ( () => void );

/**
 * Global bags shared with the shell. Typed via cast rather than
 * `declare global` — every window bundle declares its own
 * RenderCallback alias and TS rejects same-name global redeclarations
 * across bundles.
 */
interface RunWindowGlobals {
	desktopModeWindowConfig?: Record< string, unknown >;
	desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
}

const globals = window as unknown as RunWindowGlobals;

function getRunConfig(): RunWindowConfig | null {
	const cfg = globals.desktopModeWindowConfig?.[ WINDOW_ID ] as
		| RunWindowConfig
		| undefined;
	return cfg && typeof cfg.restRoot === 'string' ? cfg : null;
}

async function invoke(
	agentId: number,
	message: string,
): Promise< AgentInvokeResult > {
	const cfg = getRunConfig();
	if ( ! cfg ) {
		throw new Error(
			__( 'Chat window config is missing.', 'desktop-mode' ),
		);
	}
	const root = cfg.restRoot.replace( /\/+$/, '' );
	const res = await trackedFetch(
		`${ root }/desktop-mode/v1/agents/${ agentId }/invoke`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.restNonce,
			},
			body: JSON.stringify( { message } ),
		},
		{ source: 'desktop-mode/agents' },
	);
	const body = ( await res.json().catch( () => null ) ) as
		| ( AgentInvokeResult & { message?: string } )
		| { message?: string }
		| null;
	if ( ! res.ok ) {
		const detail =
			body && typeof body === 'object' && typeof body.message === 'string'
				? body.message
				: `HTTP ${ res.status }`;
		throw new Error( detail );
	}
	return body as AgentInvokeResult;
}

function transcriptFor( agent: AgentChatAgent ): AgentChatMessage[] {
	const { transcripts } = agentsChatStore.state;
	if ( ! transcripts[ agent.id ] ) {
		transcripts[ agent.id ] = [];
	}
	return transcripts[ agent.id ];
}

function renderChat( body: HTMLElement ): ( () => void ) | void {
	const root =
		body.querySelector< HTMLElement >(
			'[data-desktop-mode-agent-run-root]',
		) ?? body;

	let busy = false;

	const paint = (): void => {
		const agent = agentsChatStore.state.activeAgent;
		root.replaceChildren();

		if ( ! agent ) {
			const empty = document.createElement( 'wpd-empty-state' );
			empty.setAttribute( 'icon', 'superhero' );
			empty.setAttribute(
				'heading',
				__( 'No agent selected', 'desktop-mode' ),
			);
			empty.setAttribute(
				'description',
				__(
					'Open an agent from My WordPress → Agents and press Chat.',
					'desktop-mode',
				),
			);
			root.appendChild( empty );
			return;
		}

		const wrap = document.createElement( 'div' );
		wrap.className = 'dm-agent-chat';

		const head = document.createElement( 'div' );
		head.className = 'dm-agent-chat__head';
		const avatar = document.createElement( 'img' );
		avatar.className = 'dm-agent-chat__avatar';
		avatar.src = agent.avatarUrl;
		avatar.alt = '';
		const title = document.createElement( 'div' );
		title.className = 'dm-agent-chat__title';
		const name = document.createElement( 'strong' );
		name.textContent = agent.name;
		const desc = document.createElement( 'span' );
		desc.className = 'dm-agent-chat__desc';
		desc.textContent = agent.description;
		title.append( name, desc );
		head.append( avatar, title );
		wrap.appendChild( head );

		const scroll = document.createElement( 'div' );
		scroll.className = 'dm-agent-chat__scroll';
		for ( const message of transcriptFor( agent ) ) {
			scroll.appendChild( messageRow( message ) );
		}
		wrap.appendChild( scroll );

		const composer = document.createElement( 'div' );
		composer.className = 'dm-agent-chat__composer';
		const input = document.createElement( 'wpd-textarea' ) as HTMLElement & {
			value?: string;
		};
		input.setAttribute(
			'aria-label',
			__( 'Message the agent', 'desktop-mode' ),
		);
		input.setAttribute(
			'placeholder',
			__( 'Ask the agent to do something…', 'desktop-mode' ),
		);
		input.setAttribute( 'rows', '2' );
		input.setAttribute( 'submit-on-enter', '' );
		if ( busy ) {
			input.setAttribute( 'disabled', '' );
		}
		const send = document.createElement( 'wpd-button' ) as HTMLElement & {
			disabled?: boolean;
		};
		send.textContent = __( 'Send', 'desktop-mode' );
		if ( busy ) {
			send.setAttribute( 'disabled', '' );
		}

		const submit = (): void => {
			const text = ( input.value ?? '' ).trim();
			if ( text === '' || busy ) {
				return;
			}
			void sendMessage( agent, text );
		};
		input.addEventListener( 'wpd-submit', submit );
		send.addEventListener( 'click', submit );
		composer.append( input, send );
		wrap.appendChild( composer );

		root.appendChild( wrap );
		scroll.scrollTop = scroll.scrollHeight;
	};

	const messageRow = ( message: AgentChatMessage ): HTMLElement => {
		const row = document.createElement( 'div' );
		row.className = `dm-agent-chat__msg dm-agent-chat__msg--${ message.role }`;
		const text = document.createElement( 'div' );
		text.className = 'dm-agent-chat__msg-text';
		text.textContent = message.text;
		row.appendChild( text );
		if ( message.pending ) {
			const spinner = document.createElement( 'wpd-spinner' );
			row.appendChild( spinner );
		}
		if ( message.toolCalls && message.toolCalls.length > 0 ) {
			const tools = document.createElement( 'details' );
			tools.className = 'dm-agent-chat__tools';
			const summary = document.createElement( 'summary' );
			summary.textContent = `${ __( 'Tool calls', 'desktop-mode' ) } (${
				message.toolCalls.length
			})`;
			tools.appendChild( summary );
			for ( const call of message.toolCalls ) {
				const line = document.createElement( 'div' );
				line.className = 'dm-agent-chat__tool';
				line.textContent = call.error
					? `${ call.name } — ${ call.error }`
					: `${ call.name }(${ JSON.stringify( call.args ) })`;
				tools.appendChild( line );
			}
			row.appendChild( tools );
		}
		return row;
	};

	const sendMessage = async (
		agent: AgentChatAgent,
		text: string,
	): Promise< void > => {
		busy = true;
		const transcript = transcriptFor( agent );
		transcript.push( { role: 'user', text, at: Date.now() } );
		const pending: AgentChatMessage = {
			role: 'agent',
			text: __( 'Working…', 'desktop-mode' ),
			at: Date.now(),
			pending: true,
		};
		transcript.push( pending );
		agentsChatStore.notify();

		try {
			const result = await invoke( agent.id, text );
			pending.text =
				result.text ||
				__( 'The agent finished without a text answer.', 'desktop-mode' );
			pending.toolCalls = result.toolCalls;
		} catch ( err ) {
			pending.role = 'error';
			pending.text = err instanceof Error ? err.message : String( err );
		}
		pending.pending = false;
		busy = false;
		agentsChatStore.notify();
	};

	const unsubscribe = agentsChatStore.subscribe( paint );
	paint();
	return () => {
		unsubscribe();
	};
}

globals.desktopModeNativeWindows = globals.desktopModeNativeWindows || {};
globals.desktopModeNativeWindows[ WINDOW_ID ] = renderChat;
