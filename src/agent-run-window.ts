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
import { renderMarkdown } from './markdown';
import './ui/components/wpd-button/wpd-button';
import './ui/components/wpd-empty-state/wpd-empty-state';
import './ui/components/wpd-spinner/wpd-spinner';
import './ui/components/wpd-textarea/wpd-textarea';
import {
	agentsChatStore,
	type AgentChatAgent,
	type AgentChatMessage,
} from './agents-chat-store';
import {
	describeDragEntity,
	dispatchAgentDrop,
	invokeAgentIntoTranscript,
} from './agents-dispatch';
import {
	deleteConversation,
	listConversations,
	openConversation,
	type AgentConversationSummary,
} from './agents-conversations';
import { wpdConfirm } from './ui/components/wpd-confirm-dialog/wpd-confirm-dialog';

const WINDOW_ID = 'desktop-mode-agent-run';

interface RunWindowConfig {
	restRoot: string;
	restNonce: string;
	canManage: boolean;
	currentUser?: { id: number; name: string; avatarUrl: string };
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
interface MinimalDropTarget {
	id: string;
	element: HTMLElement;
	accept( payload: { type: string; data: Record< string, unknown > } ): boolean;
	acceptLabel?: string;
	onDrop( session: {
		payload: { type: string; data: Record< string, unknown > };
	} ): void;
}

interface RunWindowGlobals {
	desktopModeWindowConfig?: Record< string, unknown >;
	desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
	wp?: {
		desktop?: {
			dragManager?: {
				registerDropTarget( target: MinimalDropTarget ): () => void;
			};
		};
	};
}

const globals = window as unknown as RunWindowGlobals;

/** Per-render sequence so multi-instance windows get unique target ids. */
let chatDropSeq = 0;

function getRunConfig(): RunWindowConfig | null {
	const cfg = globals.desktopModeWindowConfig?.[ WINDOW_ID ] as
		| RunWindowConfig
		| undefined;
	return cfg && typeof cfg.restRoot === 'string' ? cfg : null;
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
	// Sidebar list state. Refetched when the store's conversationsRev
	// moves (a save/delete happened) — never polled.
	let conversations: AgentConversationSummary[] = [];
	let conversationsLoaded = false;
	let seenRev = -1;

	const refreshConversations = (): void => {
		const cfg = getRunConfig();
		if ( ! cfg ) {
			conversationsLoaded = true;
			return;
		}
		void listConversations( {
			restRoot: cfg.restRoot,
			restNonce: cfg.restNonce,
		} )
			.then( ( rows ) => {
				conversations = rows;
			} )
			.catch( () => {
				conversations = [];
			} )
			.finally( () => {
				conversationsLoaded = true;
				paint();
			} );
	};

	const startNewChat = ( agent: AgentChatAgent ): void => {
		// Resets the live transcript AND detaches it from its persisted
		// conversation — the next exchange creates a fresh row (the old
		// one stays in the sidebar).
		agentsChatStore.state.transcripts[ agent.id ] = [];
		if ( ! agentsChatStore.state.conversationIds ) {
			agentsChatStore.state.conversationIds = {};
		}
		agentsChatStore.state.conversationIds[ agent.id ] = null;
		agentsChatStore.notify();
	};

	const removeConversation = async (
		row: AgentConversationSummary,
	): Promise< void > => {
		const cfg = getRunConfig();
		if ( ! cfg ) {
			return;
		}
		const ok = await wpdConfirm( {
			title: __( 'Delete conversation?', 'desktop-mode' ),
			message: __( 'Cannot be undone.', 'desktop-mode' ),
			confirmLabel: __( 'Delete', 'desktop-mode' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			await deleteConversation(
				{ restRoot: cfg.restRoot, restNonce: cfg.restNonce },
				row.id,
			);
		} catch {
			return;
		}
		const state = agentsChatStore.state;
		if ( state.conversationIds?.[ row.agentId ] === row.id ) {
			// Deleting the OPEN conversation also clears the transcript
			// — keeping it would silently recreate the row on next send.
			state.transcripts[ row.agentId ] = [];
			state.conversationIds[ row.agentId ] = null;
		}
		state.conversationsRev = ( state.conversationsRev ?? 0 ) + 1;
		agentsChatStore.notify();
	};

	const buildSidebar = ( agent: AgentChatAgent | null ): HTMLElement => {
		const cfg = getRunConfig();
		const sidebar = document.createElement( 'div' );
		sidebar.className = 'dm-agent-chat__sidebar';

		const newChat = document.createElement( 'wpd-button' );
		newChat.className = 'dm-agent-chat__new';
		newChat.textContent = __( '+ New chat', 'desktop-mode' );
		if ( ! agent || busy ) {
			newChat.setAttribute( 'disabled', '' );
		}
		newChat.addEventListener( 'click', () => {
			if ( agent && ! busy ) {
				startNewChat( agent );
			}
		} );
		sidebar.appendChild( newChat );

		const list = document.createElement( 'div' );
		list.className = 'dm-agent-chat__convs';
		const activeId = agent
			? agentsChatStore.state.conversationIds?.[ agent.id ] ?? null
			: null;

		if ( conversationsLoaded && conversations.length === 0 ) {
			const none = document.createElement( 'div' );
			none.className = 'dm-agent-chat__convs-empty';
			none.textContent = __( 'No conversations yet.', 'desktop-mode' );
			list.appendChild( none );
		}
		for ( const row of conversations ) {
			const item = document.createElement( 'div' );
			item.className = 'dm-agent-chat__conv';
			if ( row.id === activeId ) {
				item.classList.add( 'dm-agent-chat__conv--active' );
			}
			item.setAttribute( 'role', 'button' );
			item.tabIndex = 0;
			item.title = `${ row.agentName } — ${ row.title }`;

			const face = document.createElement( 'img' );
			face.className = 'dm-agent-chat__conv-avatar';
			face.src = row.agentAvatarUrl;
			face.alt = '';
			const label = document.createElement( 'span' );
			label.className = 'dm-agent-chat__conv-title';
			label.textContent = row.title;

			const open = (): void => {
				if ( busy || ! cfg ) {
					return;
				}
				void openConversation(
					{ restRoot: cfg.restRoot, restNonce: cfg.restNonce },
					row.id,
				).catch( ( err ) => {
					// eslint-disable-next-line no-console
					console.warn(
						'[desktop-mode/agents] conversation load failed:',
						err,
					);
				} );
			};
			item.addEventListener( 'click', open );
			item.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
				if ( e.key === 'Enter' || e.key === ' ' ) {
					e.preventDefault();
					open();
				}
			} );

			// Feature-specific micro-control — a full wpd-button would
			// out-weigh the row it lives in.
			const del = document.createElement( 'button' );
			del.type = 'button';
			del.className = 'dm-agent-chat__conv-delete';
			del.textContent = '×';
			del.setAttribute(
				'aria-label',
				__( 'Delete conversation', 'desktop-mode' ),
			);
			del.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				void removeConversation( row );
			} );

			item.append( face, label, del );
			list.appendChild( item );
		}
		sidebar.appendChild( list );
		return sidebar;
	};

	const paint = (): void => {
		const agent = agentsChatStore.state.activeAgent;
		root.replaceChildren();

		const wrap = document.createElement( 'div' );
		wrap.className = 'dm-agent-chat';
		wrap.appendChild( buildSidebar( agent ) );

		const main = document.createElement( 'div' );
		main.className = 'dm-agent-chat__main';
		wrap.appendChild( main );

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
					'Open an agent from the Agents section of the site folder, or pick a past conversation.',
					'desktop-mode',
				),
			);
			main.appendChild( empty );
			root.appendChild( wrap );
			return;
		}

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
		main.appendChild( head );

		const scroll = document.createElement( 'div' );
		scroll.className = 'dm-agent-chat__scroll';
		const transcript = transcriptFor( agent );
		for ( const [ i, message ] of transcript.entries() ) {
			scroll.appendChild(
				messageRow( message, agent, i === transcript.length - 1 ),
			);
		}
		main.appendChild( scroll );

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
		main.appendChild( composer );

		root.appendChild( wrap );
		scroll.scrollTop = scroll.scrollHeight;
	};

	const messageRow = (
		message: AgentChatMessage,
		agent: AgentChatAgent,
		isLast = false,
	): HTMLElement => {
		const line = document.createElement( 'div' );
		line.className = `dm-agent-chat__line dm-agent-chat__line--${ message.role }`;
		if ( message.pending ) {
			line.classList.add( 'dm-agent-chat__line--pending' );
		}

		// WhatsApp-style avatars: the agent on the left, the viewer on
		// the right. Error rows sit on the agent side, avatar-less.
		let avatarUrl = '';
		if ( message.role === 'agent' ) {
			avatarUrl = agent.avatarUrl;
		} else if ( message.role === 'user' ) {
			avatarUrl = getRunConfig()?.currentUser?.avatarUrl ?? '';
		}
		if ( avatarUrl ) {
			const face = document.createElement( 'img' );
			face.className = 'dm-agent-chat__msg-avatar';
			face.src = avatarUrl;
			face.alt = '';
			line.appendChild( face );
		}

		const row = document.createElement( 'div' );
		row.className = `dm-agent-chat__msg dm-agent-chat__msg--${ message.role }`;
		if ( message.pending ) {
			row.classList.add( 'dm-agent-chat__msg--pending' );
		}
		line.appendChild( row );
		const text = document.createElement( 'div' );
		text.className = 'dm-agent-chat__msg-text';
		if ( message.role === 'agent' && ! message.pending ) {
			// Agent answers arrive as markdown; renderMarkdown escapes
			// the input before re-interpreting tokens, so the result is
			// safe for innerHTML.
			text.innerHTML = renderMarkdown( message.text );
		} else {
			text.textContent = message.text;
		}
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
				const toolRow = document.createElement( 'div' );
				toolRow.className = 'dm-agent-chat__tool';
				toolRow.textContent = call.error
					? `${ call.name } — ${ call.error }`
					: `${ call.name }(${ JSON.stringify( call.args ) })`;
				tools.appendChild( toolRow );
			}
			row.appendChild( tools );
		}
		// Confirmation buttons the answer carries. Only the LATEST
		// message's buttons are live — once the conversation moves on
		// (or a button was pressed) they render disabled, so the stored
		// transcript keeps showing what was offered without re-arming
		// stale choices.
		if (
			message.callToActions &&
			message.callToActions.length > 0 &&
			! message.pending
		) {
			const ctas = document.createElement( 'div' );
			ctas.className = 'dm-agent-chat__ctas';
			const live = isLast && ! message.ctaUsed && ! busy;
			for ( const cta of message.callToActions ) {
				const btn = document.createElement( 'wpd-button' );
				btn.setAttribute( 'variant', cta.style ?? 'secondary' );
				btn.textContent = cta.label;
				if ( ! live ) {
					btn.setAttribute( 'disabled', '' );
				}
				btn.addEventListener( 'click', () => {
					if ( ! live || ! cta.reply ) {
						return;
					}
					message.ctaUsed = true;
					// The reply lands as a visible user message and runs
					// like a typed turn — the stored history shows
					// exactly what was approved.
					void sendMessage( agent, cta.reply );
				} );
				ctas.appendChild( btn );
			}
			row.appendChild( ctas );
		}
		return line;
	};

	// Delegates to the shared dispatcher so the typed path and the drop
	// path replay the conversation identically — a follow-up message
	// must never reach the runner without the turns that give it
	// meaning.
	const sendMessage = async (
		agent: AgentChatAgent,
		text: string,
	): Promise< void > => {
		const cfg = getRunConfig();
		if ( ! cfg ) {
			transcriptFor( agent ).push( {
				role: 'error',
				text: __( 'Chat window config is missing.', 'desktop-mode' ),
				at: Date.now(),
			} );
			agentsChatStore.notify();
			return;
		}
		busy = true;
		agentsChatStore.notify();
		await invokeAgentIntoTranscript(
			agent,
			text,
			{ restRoot: cfg.restRoot, restNonce: cfg.restNonce },
			'chat',
		);
		busy = false;
		agentsChatStore.notify();
	};

	// The open conversation accepts entity drops for the active agent.
	// Deliberately NOT gated on the agent's drag trigger — dropping
	// into an open chat is explicit user intent, exactly like typing
	// (the chat trigger), so only the entity shape is checked.
	let deregisterDrop: ( () => void ) | undefined;
	const dropConfig = getRunConfig();
	const dragManager = globals.wp?.desktop?.dragManager;
	if ( dragManager && dropConfig ) {
		deregisterDrop = dragManager.registerDropTarget( {
			id: `dm-agent-chat-${ ++chatDropSeq }`,
			element: root,
			accept: ( payload ) => {
				const agent = agentsChatStore.state.activeAgent;
				if ( ! agent ) {
					return false;
				}
				const entity = describeDragEntity( payload );
				return (
					entity !== null &&
					! ( entity.kind === 'user' && entity.id === agent.id )
				);
			},
			acceptLabel: __( 'Send to agent', 'desktop-mode' ),
			onDrop: ( session ) => {
				const agent = agentsChatStore.state.activeAgent;
				const entity = describeDragEntity( session.payload );
				if ( ! agent || ! entity ) {
					return;
				}
				void dispatchAgentDrop( agent, entity, {
					restRoot: dropConfig.restRoot,
					restNonce: dropConfig.restNonce,
				} );
			},
		} );
	}

	const unsubscribe = agentsChatStore.subscribe( () => {
		const rev = agentsChatStore.state.conversationsRev ?? 0;
		if ( rev !== seenRev ) {
			seenRev = rev;
			refreshConversations();
		}
		paint();
	} );
	seenRev = agentsChatStore.state.conversationsRev ?? 0;
	refreshConversations();
	paint();
	return () => {
		deregisterDrop?.();
		unsubscribe();
	};
}

globals.desktopModeNativeWindows = globals.desktopModeNativeWindows || {};
globals.desktopModeNativeWindows[ WINDOW_ID ] = renderChat;
