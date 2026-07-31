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

import { __, sprintf } from './i18n';
import { renderMarkdown } from './markdown';
import './ui/components/wpd-avatar/wpd-avatar';
import './ui/components/wpd-button/wpd-button';
import './ui/components/wpd-empty-state/wpd-empty-state';
import './ui/components/wpd-spinner/wpd-spinner';
import './ui/components/wpd-textarea/wpd-textarea';
import { applyAvatarSrc } from './ui/util/avatar-resolve';
import {
	agentsChatStore,
	type AgentChatAgent,
	type AgentChatAttachment,
	type AgentChatMessage,
} from './agents-chat-store';
import { openAgentEditor } from './agents-editor-target';
import {
	attachmentIcon,
	attachmentKindLabel,
	openAttachmentWindow,
} from './agents-entity-window';
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

/**
 * Sidebar timestamp: time of day for today, "Yesterday", the weekday
 * inside the last week, a short date beyond that. Same ladder every
 * messaging app uses — the point is recency at a glance, not
 * precision, so the full stamp goes in the row's `title` instead.
 */
function formatConversationTime( iso: string ): string {
	const when = new Date( iso );
	if ( Number.isNaN( when.getTime() ) ) {
		return '';
	}
	const now = new Date();
	const startOfDay = ( d: Date ): number =>
		new Date( d.getFullYear(), d.getMonth(), d.getDate() ).getTime();
	const days = Math.round(
		( startOfDay( now ) - startOfDay( when ) ) / 86400000,
	);
	if ( days <= 0 ) {
		return when.toLocaleTimeString( undefined, {
			hour: 'numeric',
			minute: '2-digit',
		} );
	}
	if ( days === 1 ) {
		return __( 'Yesterday', 'desktop-mode' );
	}
	if ( days < 7 ) {
		return when.toLocaleDateString( undefined, { weekday: 'short' } );
	}
	return when.toLocaleDateString( undefined, {
		month: 'short',
		day: 'numeric',
	} );
}

/**
 * Build a `<wpd-avatar>`. Gravatar URLs go through the probe so users
 * with no registered Gravatar get their initials tile instead of the
 * mystery-person silhouette (a raw Gravatar URL answers 200 with the
 * silhouette, so the component's own error fallback never fires).
 */
function buildAvatar(
	className: string,
	size: number,
	src: string,
	name: string,
): HTMLElement {
	const avatar = document.createElement( 'wpd-avatar' );
	avatar.className = className;
	avatar.setAttribute( 'size', String( size ) );
	avatar.setAttribute( 'name', name );
	avatar.setAttribute( 'alt', name );
	if ( src ) {
		applyAvatarSrc( avatar, src );
	}
	return avatar;
}

/**
 * Turn an avatar into the agent's editor shortcut: clickable tile,
 * and both the click and the Enter/Space keydown stop at the avatar so
 * a row that is itself a button doesn't fire twice.
 */
function linkAvatarToAgentEditor( avatar: HTMLElement, agentId: number ): void {
	avatar.setAttribute( 'clickable', '' );
	avatar.setAttribute(
		'title',
		__( 'Open the agent in My WordPress', 'desktop-mode' ),
	);
	avatar.addEventListener( 'click', ( e: Event ) => {
		e.stopPropagation();
		openAgentEditor( agentId );
	} );
	avatar.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
		if ( e.key === 'Enter' || e.key === ' ' ) {
			e.stopPropagation();
		}
	} );
}

/**
 * The object a drop / "Send to" handed the agent, as a card the user
 * can open. Clicking it opens the entity's admin screen in its own
 * window — the conversation stays put.
 */
function attachmentCard( attachment: AgentChatAttachment ): HTMLElement {
	const card = document.createElement( 'button' );
	card.type = 'button';
	card.className = 'dm-agent-chat__attachment';
	card.title = sprintf(
		/* translators: 1: entity kind (Post, Media, …), 2: entity title. */
		__( 'Open the %1$s "%2$s"', 'desktop-mode' ),
		attachmentKindLabel( attachment.kind ),
		attachment.title,
	);

	const icon = document.createElement( 'span' );
	icon.className = `dm-agent-chat__attachment-icon dashicons ${ attachmentIcon(
		attachment.kind,
	) }`;
	icon.setAttribute( 'aria-hidden', 'true' );

	const text = document.createElement( 'span' );
	text.className = 'dm-agent-chat__attachment-text';
	const title = document.createElement( 'span' );
	title.className = 'dm-agent-chat__attachment-title';
	title.textContent = attachment.title;
	const meta = document.createElement( 'span' );
	meta.className = 'dm-agent-chat__attachment-meta';
	meta.textContent = `${ attachmentKindLabel( attachment.kind ) } · #${
		attachment.id
	}`;
	text.append( title, meta );

	const chevron = document.createElement( 'span' );
	chevron.className =
		'dm-agent-chat__attachment-open dashicons dashicons-external';
	chevron.setAttribute( 'aria-hidden', 'true' );

	card.append( icon, text, chevron );
	card.addEventListener( 'click', () => {
		openAttachmentWindow( attachment );
	} );
	return card;
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
			// The title (first user message) is the one line the rows
			// have in common when a workflow always opens the same way —
			// it belongs in the tooltip, not as the row's identity.
			item.title = `${ row.agentName } — ${ row.title }`;

			const face = buildAvatar(
				'dm-agent-chat__conv-avatar',
				28,
				row.agentAvatarUrl,
				row.agentName,
			);
			if ( row.agentId > 0 ) {
				linkAvatarToAgentEditor( face, row.agentId );
			}

			// Two lines: who the conversation is with, and where it got
			// to. The timestamp rides the first line, right-aligned.
			const label = document.createElement( 'span' );
			label.className = 'dm-agent-chat__conv-text';
			const top = document.createElement( 'span' );
			top.className = 'dm-agent-chat__conv-top';
			const name = document.createElement( 'span' );
			name.className = 'dm-agent-chat__conv-name';
			name.textContent = row.agentName;
			const time = document.createElement( 'time' );
			time.className = 'dm-agent-chat__conv-time';
			time.dateTime = row.updatedAt;
			time.textContent = formatConversationTime( row.updatedAt );
			top.append( name, time );
			const preview = document.createElement( 'span' );
			preview.className = 'dm-agent-chat__conv-preview';
			preview.textContent = row.preview || row.title;
			label.append( top, preview );

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
		const avatar = buildAvatar(
			'dm-agent-chat__avatar',
			40,
			agent.avatarUrl,
			agent.name,
		);
		linkAvatarToAgentEditor( avatar, agent.id );
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
		// `<wpd-avatar>` rather than a bare `<img>` so a viewer with no
		// registered Gravatar gets their initials instead of the
		// mystery-person silhouette.
		if ( message.role === 'agent' ) {
			line.appendChild(
				buildAvatar(
					'dm-agent-chat__msg-avatar',
					28,
					agent.avatarUrl,
					agent.name,
				),
			);
		} else if ( message.role === 'user' ) {
			const viewer = getRunConfig()?.currentUser;
			// Nothing to draw when the config carries no viewer — an
			// empty initials disc would read as a broken avatar.
			if ( viewer?.avatarUrl || viewer?.name ) {
				line.appendChild(
					buildAvatar(
						'dm-agent-chat__msg-avatar',
						28,
						viewer.avatarUrl ?? '',
						viewer.name ?? '',
					),
				);
			}
		}

		const row = document.createElement( 'div' );
		row.className = `dm-agent-chat__msg dm-agent-chat__msg--${ message.role }`;
		if ( message.pending ) {
			row.classList.add( 'dm-agent-chat__msg--pending' );
		}
		line.appendChild( row );

		if ( message.attachment ) {
			// The row's `text` is the sentence the RUNNER was handed
			// ("The user dropped the post … onto you. Handle it …") —
			// machine-facing boilerplate that reads as noise in a chat.
			// The card says the same thing better, and unlike the
			// sentence it opens the object.
			row.appendChild( attachmentCard( message.attachment ) );
			const caption = document.createElement( 'div' );
			caption.className = 'dm-agent-chat__msg-caption';
			caption.textContent = __( 'Shared with the agent', 'desktop-mode' );
			row.appendChild( caption );
		} else {
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
		}
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
