import { __, sprintf } from './i18n';
import { toastRestFailure } from './core/rest-failure';
import { shellToast } from './core/shell-toast';
import { renderMarkdown } from './markdown';
import './ui/components/os-avatar/os-avatar';
import './ui/components/os-button/os-button';
import './ui/components/os-empty-state/os-empty-state';
import './ui/components/os-spinner/os-spinner';
import './ui/components/os-textarea/os-textarea';
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
import { osConfirm } from './ui/components/os-confirm-dialog/os-confirm-dialog';

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
	openStationWindowConfig?: Record< string, unknown >;
	openStationNativeWindows?: Record< string, RenderCallback | undefined >;
	wp?: {
		os?: {
			dragManager?: {
				registerDropTarget( target: MinimalDropTarget ): () => void;
			};
		};
	};
}

const globals = window as unknown as RunWindowGlobals;

let chatDropSeq = 0;

function getRunConfig(): RunWindowConfig | null {
	const cfg = globals.openStationWindowConfig?.[ WINDOW_ID ] as
		| RunWindowConfig
		| undefined;
	return cfg && typeof cfg.restRoot === 'string' ? cfg : null;
}

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

const SEND_ICON =
	'<svg class="dm-agent-chat__send-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
	'<path d="M8 13.5V2.5M8 2.5 3.5 7M8 2.5 12.5 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
	'</svg>';

function buildAvatar(
	className: string,
	size: number,
	src: string,
	name: string,
): HTMLElement {
	const avatar = document.createElement( 'os-avatar' );
	avatar.className = className;
	avatar.setAttribute( 'size', String( size ) );
	avatar.setAttribute( 'name', name );
	avatar.setAttribute( 'alt', name );
	if ( src ) {
		applyAvatarSrc( avatar, src );
	}
	return avatar;
}

function linkAvatarToAgentEditor( avatar: HTMLElement, agentId: number ): void {
	avatar.setAttribute( 'clickable', '' );
	avatar.setAttribute(
		'title',
		__( 'Open the agent in WP Explorer', 'desktop-mode' ),
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

function attachmentCard( attachment: AgentChatAttachment ): HTMLElement {
	const card = document.createElement( 'button' );
	card.type = 'button';
	card.className = 'dm-agent-chat__attachment';
	card.title = sprintf(

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
			'[data-os-agent-run-root]',
		) ?? body;

	const isBusy = (): boolean => {
		const agent = agentsChatStore.state.activeAgent;
		return !! agent && transcriptFor( agent ).some( ( row ) => row.pending );
	};

	let conversations: AgentConversationSummary[] = [];
	let conversationsLoaded = false;

	let conversationsFailed = false;
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
				conversationsFailed = false;
			} )
			.catch( ( err: unknown ) => {
				conversations = [];
				conversationsFailed = true;

				console.error( '[openstation] agents: conversations failed to load:', err );
			} )
			.finally( () => {
				conversationsLoaded = true;
				paint();
			} );
	};

	const startNewChat = ( agent: AgentChatAgent ): void => {
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
		const ok = await osConfirm( {
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
		} catch ( err ) {
			console.error( '[openstation] agents: conversation delete failed:', err );
			toastRestFailure( shellToast, err, {
				fallback: __( 'Could not delete the conversation.', 'desktop-mode' ),
			} );
			return;
		}
		const state = agentsChatStore.state;
		if ( state.conversationIds?.[ row.agentId ] === row.id ) {
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

		const newChat = document.createElement( 'os-button' );
		newChat.className = 'dm-agent-chat__new';
		newChat.textContent = __( '+ New chat', 'desktop-mode' );
		if ( ! agent || isBusy() ) {
			newChat.setAttribute( 'disabled', '' );
		}
		newChat.addEventListener( 'click', () => {
			if ( agent && ! isBusy() ) {
				startNewChat( agent );
			}
		} );
		sidebar.appendChild( newChat );

		const list = document.createElement( 'div' );
		list.className = 'dm-agent-chat__convs';
		const activeId = agent
			? agentsChatStore.state.conversationIds?.[ agent.id ] ?? null
			: null;

		const visible = agent
			? conversations.filter( ( row ) => row.agentId === agent.id )
			: conversations;

		if ( conversationsLoaded && visible.length === 0 ) {
			const none = document.createElement( 'div' );
			none.className = 'dm-agent-chat__convs-empty';

			none.textContent = conversationsFailed
				? __( 'Could not load conversations.', 'desktop-mode' )
				: __( 'No conversations yet.', 'desktop-mode' );
			list.appendChild( none );
		}
		for ( const row of visible ) {
			const item = document.createElement( 'div' );
			item.className = 'dm-agent-chat__conv';
			if ( row.id === activeId ) {
				item.classList.add( 'dm-agent-chat__conv--active' );
			}
			item.setAttribute( 'role', 'button' );
			item.tabIndex = 0;

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
				if ( isBusy() || ! cfg ) {
					return;
				}
				followOnNextPaint = true;
				void openConversation(
					{ restRoot: cfg.restRoot, restNonce: cfg.restNonce },
					row.id,
				).catch( ( err ) => {
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

	const SCROLL_SLACK = 8;
	let followLatest = true;
	let followOnNextPaint = false;
	let savedScrollTop = 0;
	let scrollObserver: ResizeObserver | undefined;

	const isAtBottom = ( el: HTMLElement ): boolean =>
		el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_SLACK;

	const paint = (): void => {
		const agent = agentsChatStore.state.activeAgent;
		const prevScroll = root.querySelector< HTMLElement >(
			'.dm-agent-chat__scroll',
		);
		if ( prevScroll ) {
			savedScrollTop = prevScroll.scrollTop;
			followLatest = followOnNextPaint || isAtBottom( prevScroll );
		}
		followOnNextPaint = false;
		scrollObserver?.disconnect();
		scrollObserver = undefined;
		root.replaceChildren();

		const wrap = document.createElement( 'div' );
		wrap.className = 'dm-agent-chat';
		wrap.appendChild( buildSidebar( agent ) );

		const main = document.createElement( 'div' );
		main.className = 'dm-agent-chat__main';
		wrap.appendChild( main );

		if ( ! agent ) {
			const empty = document.createElement( 'os-empty-state' );
			empty.setAttribute( 'icon', 'superhero' );
			empty.setAttribute(
				'heading',
				__( 'No agent selected', 'desktop-mode' ),
			);
			empty.setAttribute(
				'description',
				__(
					'Open an agent from the Agents section of WP Explorer, or pick a past conversation.',
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
		const input = document.createElement( 'os-textarea' ) as HTMLElement & {
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
		input.setAttribute( 'rows', '1' );
		input.setAttribute( 'auto-grow', '' );
		input.setAttribute( 'max-rows', '6' );
		input.setAttribute( 'submit-on-enter', '' );
		if ( isBusy() ) {
			input.setAttribute( 'disabled', '' );
		}
		const send = document.createElement( 'os-button' );
		send.className = 'dm-agent-chat__send';
		send.setAttribute( 'variant', 'primary' );
		send.setAttribute( 'title', __( 'Send', 'desktop-mode' ) );

		send.innerHTML = `${ SEND_ICON }<span class="dm-agent-chat__send-label">${ __(
			'Send',
			'desktop-mode',
		) }</span>`;

		const syncSend = (): void => {
			const empty = ( input.value ?? '' ).trim() === '';
			if ( isBusy() || empty ) {
				send.setAttribute( 'disabled', '' );
			} else {
				send.removeAttribute( 'disabled' );
			}
		};
		syncSend();

		const submit = (): void => {
			const text = ( input.value ?? '' ).trim();
			if ( text === '' || isBusy() ) {
				return;
			}
			void sendMessage( agent, text );
		};
		input.addEventListener( 'os-input-change', syncSend );
		input.addEventListener( 'os-submit', submit );
		send.addEventListener( 'click', submit );
		composer.append( input, send );
		main.appendChild( composer );

		root.appendChild( wrap );

		let pinnedScrollTop = -1;
		const settleScroll = (): void => {
			if ( followLatest ) {
				scroll.scrollTop = scroll.scrollHeight;
				pinnedScrollTop = scroll.scrollTop;
			}
		};
		if ( ! followLatest ) {
			scroll.scrollTop = savedScrollTop;
		}
		settleScroll();
		scroll.addEventListener( 'scroll', () => {
			if ( followLatest && scroll.scrollTop === pinnedScrollTop ) {
				return;
			}
			followLatest = isAtBottom( scroll );
		} );

		if ( typeof ResizeObserver === 'function' ) {
			scrollObserver = new ResizeObserver( settleScroll );
			scrollObserver.observe( scroll );
			for ( const line of scroll.children ) {
				scrollObserver.observe( line );
			}
		}
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
			row.appendChild( attachmentCard( message.attachment ) );
			const caption = document.createElement( 'div' );
			caption.className = 'dm-agent-chat__msg-caption';
			caption.textContent = __( 'Shared with the agent', 'desktop-mode' );
			row.appendChild( caption );
		} else {
			if ( message.pending ) {
				const spinner = document.createElement( 'os-spinner' );
				spinner.setAttribute( 'preset', 'inline' );
				row.appendChild( spinner );
			}
			const text = document.createElement( 'div' );
			text.className = 'dm-agent-chat__msg-text';
			if ( message.role === 'agent' && ! message.pending ) {
				text.innerHTML = renderMarkdown( message.text );
			} else {
				text.textContent = message.text;
			}
			row.appendChild( text );
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

		if (
			message.callToActions &&
			message.callToActions.length > 0 &&
			! message.pending
		) {
			const ctas = document.createElement( 'div' );
			ctas.className = 'dm-agent-chat__ctas';
			const live = isLast && ! message.ctaUsed && ! isBusy();
			for ( const cta of message.callToActions ) {
				const btn = document.createElement( 'os-button' );
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

					void sendMessage( agent, cta.reply );
				} );
				ctas.appendChild( btn );
			}
			row.appendChild( ctas );
		}
		return line;
	};

	const sendMessage = async (
		agent: AgentChatAgent,
		text: string,
	): Promise< void > => {
		const cfg = getRunConfig();
		followOnNextPaint = true;
		if ( ! cfg ) {
			transcriptFor( agent ).push( {
				role: 'error',
				text: __( 'Chat window config is missing.', 'desktop-mode' ),
				at: Date.now(),
			} );
			agentsChatStore.notify();
			return;
		}

		await invokeAgentIntoTranscript(
			agent,
			text,
			{ restRoot: cfg.restRoot, restNonce: cfg.restNonce },
			'chat',
		);
	};

	let deregisterDrop: ( () => void ) | undefined;
	const dropConfig = getRunConfig();
	const dragManager = globals.wp?.os?.dragManager;
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
				followOnNextPaint = true;
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
		scrollObserver?.disconnect();
		unsubscribe();
	};
}

globals.openStationNativeWindows = globals.openStationNativeWindows || {};
globals.openStationNativeWindows[ WINDOW_ID ] = renderChat;
