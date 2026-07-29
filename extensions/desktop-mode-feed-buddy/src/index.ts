import {
	WIDGET_ID,
	WINDOW_ID,
	addSubscription,
	deleteSubscription,
	desktop,
	fetchItems,
	fetchState,
	refreshFeeds,
	updatePreferences,
	updateReadState,
	updateSubscription,
} from './api';
import {
	applyServerState,
	clearNewFeedIds,
	getStore,
	groupSubscriptions,
	selectFeed,
	setError,
	summariesById,
} from './state';
import type {
	FeedBuddyClientState,
	FeedBuddyServerState,
	NativeRenderContext,
	WidgetContext,
} from './types';

function __( text: string ): string {
	// This wrapper keeps every call site literal while retaining a no-i18n fallback.
	// eslint-disable-next-line @wordpress/i18n-no-variables, @wordpress/i18n-text-domain
	return window.wp?.i18n?.__( text, 'desktop-mode-feed-buddy' ) ?? text;
}

function sprintf( format: string, ...values: Array< string | number > ): string {
	return window.wp?.i18n?.sprintf( format, ...values ) ??
		format.replace( /%[sd]/g, () => String( values.shift() ?? '' ) );
}

function createElement< K extends keyof HTMLElementTagNameMap >(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[ K ] {
	const element = document.createElement( tag );
	if ( className ) {
		element.className = className;
	}
	if ( text !== undefined ) {
		element.textContent = text;
	}
	return element;
}

function createButton(
	label: string,
	action: string,
	variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary',
): HTMLElement {
	const button = document.createElement( 'wpd-button' );
	button.textContent = label;
	button.setAttribute( 'variant', variant );
	button.dataset.feedBuddyAction = action;
	return button;
}

function customValue( element: Element | null ): string {
	if ( ! element ) {
		return '';
	}
	const value = ( element as Element & { value?: unknown } ).value;
	return value === undefined || value === null
		? element.getAttribute( 'value' ) ?? ''
		: String( value );
}

function setCustomValue( element: Element, value: string ): void {
	( element as Element & { value: string } ).value = value;
	if ( value ) {
		element.setAttribute( 'value', value );
	} else {
		element.removeAttribute( 'value' );
	}
}

let stateLoadCount = 0;

async function ensureState( signal?: AbortSignal ): Promise< FeedBuddyServerState > {
	const existing = getStore().state.server;
	if ( existing ) {
		return existing;
	}
	const store = getStore();
	++stateLoadCount;
	store.state.stateLoading = true;
	store.notify();
	try {
		const state = await fetchState( { signal } );
		applyServerState( state );
		return state;
	} finally {
		--stateLoadCount;
		if ( stateLoadCount === 0 ) {
			const current = getStore();
			current.state.stateLoading = false;
			current.notify();
		}
	}
}

interface FeedPollResult {
	newFeedIds: string[];
	offlineFeedIds: string[];
}

async function pollState( signal?: AbortSignal ): Promise< FeedPollResult > {
	try {
		const previous = getStore().state.server;
		const next = await fetchState( { silent: true, signal } );
		const offlineFeedIds = newlyOfflineFeedIds( previous, next );
		return {
			newFeedIds: applyServerState( next, true ),
			offlineFeedIds,
		};
	} catch ( error ) {
		if ( ! isAbortError( error ) ) {
			setError( error );
		}
		return { newFeedIds: [], offlineFeedIds: [] };
	}
}

function isAbortError( error: unknown ): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function newlyOfflineFeedIds(
	previous: FeedBuddyServerState | null,
	next: FeedBuddyServerState,
): string[] {
	const previousStatuses = new Map(
		( previous?.summaries ?? [] ).map( ( summary ) => [ summary.id, summary.status ] ),
	);
	return next.summaries
		.filter(
			( summary ) =>
				summary.status === 'error' &&
				previousStatuses.get( summary.id ) !== 'error',
		)
		.map( ( summary ) => summary.id );
}

function setStatus( root: ParentNode, message: string, error = false ): void {
	const status = root.querySelector< HTMLElement >( '[data-feed-buddy-status]' );
	if ( ! status ) {
		return;
	}
	status.textContent = message;
	status.toggleAttribute( 'data-error', error );
}

function statusLabel( status: 'online' | 'error' ): string {
	return status === 'error' ? __( 'Offline' ) : __( 'Online' );
}

function totalUnread( server: FeedBuddyServerState | null ): number {
	return ( server?.summaries ?? [] ).reduce(
		( total, summary ) => total + summary.unread,
		0,
	);
}

function renderWidget( root: HTMLElement, state: Readonly< FeedBuddyClientState > ): void {
	root.replaceChildren();

	const frame = createElement( 'section', 'feed-buddy-widget__frame' );
	frame.setAttribute( 'aria-label', __( 'SOL Inbound Monologue buddy list' ) );
	frame.dataset.feedBuddyPresence = state.presenceMode;
	frame.toggleAttribute( 'data-retro-egg', state.retroMode );

	const appName = createElement(
		'span',
		'screen-reader-text',
		__( 'SOL Inbound Monologue' ),
	);

	const menubar = createElement( 'nav', 'feed-buddy-widget__menubar' );
	menubar.setAttribute( 'aria-label', __( 'Buddy list commands' ) );
	menubar.append(
		createButton( __( 'Add' ), 'add-feed', 'ghost' ),
		createButton( __( 'Refresh' ), 'refresh', 'ghost' ),
		createButton(
			state.presenceMode === 'away' ? __( 'I’m back' ) : __( 'Away' ),
			'toggle-away',
			'ghost',
		),
		createButton(
			state.server?.preferences.soundEnabled ? __( 'Sound on' ) : __( 'Sound off' ),
			'toggle-sound',
			'ghost',
		),
	);

	const identity = createElement( 'div', 'feed-buddy-widget__identity' );
	const avatar = createElement(
		'div',
		'feed-buddy-widget__avatar',
		state.retroMode ? ':-)' : 'S',
	);
	avatar.setAttribute( 'aria-hidden', 'true' );
	const identityCopy = createElement( 'div', 'feed-buddy-widget__identity-copy' );
	let identityDetail: string;
	if ( state.presenceMode === 'away' ) {
		identityDetail = sprintf(
			/* translators: %d: number of unread feed items. */
			__( 'idle — %d unread' ),
			totalUnread( state.server ),
		);
	} else if ( state.retroMode ) {
		identityDetail = __( 'Screen name: SOL_Online :-)' );
	} else {
		identityDetail = sprintf(
			/* translators: %d: number of subscribed feeds. */
			__( 'Feeds online: %d' ),
			state.server?.subscriptions.length ?? 0,
		);
	}
	identityCopy.append(
		createElement(
			'strong',
			'',
			state.presenceMode === 'away' ? __( 'Away' ) : __( 'Online' ),
		),
		createElement(
			'span',
			'',
			identityDetail,
		),
	);
	identity.append( avatar, identityCopy );

	const roster = createElement( 'div', 'feed-buddy-widget__roster' );

	if ( state.stateLoading && ! state.server ) {
		const loading = createElement( 'div', 'feed-buddy-widget__message', __( 'Signing on…' ) );
		loading.setAttribute( 'role', 'status' );
		roster.appendChild( loading );
	} else if ( ! state.server?.subscriptions.length ) {
		roster.appendChild(
			createElement(
				'div',
				'feed-buddy-widget__message',
				__( 'Nobody’s online yet. Add a feed buddy.' ),
			),
		);
	} else {
		const summaries = summariesById( state.server );
		for ( const group of groupSubscriptions( state.server.subscriptions ) ) {
			const groupHeader = createButton(
				group.group.toUpperCase(),
				'toggle-group',
				'ghost',
			);
			groupHeader.classList.add( 'feed-buddy-widget__group' );
			groupHeader.dataset.feedBuddyGroup = group.group;
			groupHeader.setAttribute( 'aria-expanded', 'true' );
			groupHeader.replaceChildren(
				createElement( 'span', 'feed-buddy-widget__group-toggle', '−' ),
				createElement( 'span', 'feed-buddy-widget__group-label', group.group.toUpperCase() ),
				createElement( 'span', 'feed-buddy-widget__group-count', `(${ group.subscriptions.length })` ),
			);
			roster.appendChild( groupHeader );

			for ( const subscription of group.subscriptions ) {
				const summary = summaries.get( subscription.id );
				const feed = createButton( subscription.title, 'select-feed', 'ghost' );
				feed.classList.add( 'feed-buddy-widget__feed' );
				feed.dataset.feedId = subscription.id;
				feed.dataset.feedBuddyGroup = group.group;
				feed.toggleAttribute(
					'aria-current',
					state.selectedFeedId === subscription.id,
				);
				if ( state.newFeedIds.includes( subscription.id ) ) {
					feed.classList.add( 'feed-buddy-widget__feed--new' );
				}
				if ( summary?.status === 'error' ) {
					feed.classList.add( 'feed-buddy-widget__feed--offline' );
				}

				const dot = createElement(
					'span',
					`feed-buddy-presence feed-buddy-presence--${ summary?.status ?? 'error' }`,
				);
				dot.setAttribute( 'aria-hidden', 'true' );
				const label = createElement( 'span', 'feed-buddy-widget__feed-label', subscription.title );
				const hiddenStatus = createElement(
					'span',
					'screen-reader-text',
					statusLabel( summary?.status ?? 'error' ),
				);
				const badge = createElement(
					'span',
					'feed-buddy-widget__badge',
					String( summary?.unread ?? 0 ),
				);
				badge.setAttribute(
					'aria-label',
					/* translators: %d: number of unread feed items. */
					sprintf( __( '%d unread items' ), summary?.unread ?? 0 ),
				);
				feed.replaceChildren( dot, label, hiddenStatus, badge );
				roster.appendChild( feed );
			}
		}
	}

	const footer = createElement( 'footer', 'feed-buddy-widget__footer' );
	footer.append(
		createButton( __( 'Mark all read' ), 'mark-all', 'secondary' ),
		createElement(
			'span',
			'feed-buddy-widget__footer-state',
			state.presenceMode === 'away' ? __( 'Away' ) : __( 'Online' ),
		),
	);

	const status = createElement( 'div', 'feed-buddy-widget__status' );
	status.dataset.feedBuddyStatus = '';
	status.setAttribute( 'role', 'status' );
	status.setAttribute( 'aria-live', 'polite' );
	if ( state.error ) {
		status.textContent = state.error;
		status.dataset.error = '';
	} else if ( state.newFeedIds.length > 0 ) {
		status.textContent = __( 'You’ve got… eventually.' );
	}

	frame.append( appName, menubar, identity, roster, footer, status );
	root.appendChild( frame );
}

function openReader( feedId: string | null, manager = false ): void {
	const store = getStore();
	store.state.selectedFeedId = feedId;
	store.state.managerOpen = manager;
	store.notify();
	desktop().openWindow( WINDOW_ID, { source: 'feed-buddy-widget' } );
	window.queueMicrotask( () => {
		desktop()
			.windowManager.getById( WINDOW_ID )
			?.send( 'feed:select', { feedId, manager } );
	} );
}

type RetroChime = 'message' | 'sign-off' | 'sign-on';

function playRetroChime( kind: RetroChime ): () => void {
	const AudioContextClass = window.AudioContext;
	if ( ! AudioContextClass ) {
		return () => undefined;
	}
	let context: AudioContext;
	try {
		context = new AudioContextClass();
	} catch {
		return () => undefined;
	}
	const sequences: Record<
		RetroChime,
		Array< { at: number; duration: number; frequency: number } >
	> = {
		message: [
			{ frequency: 740, at: 0, duration: 0.09 },
			{ frequency: 990, at: 0.12, duration: 0.12 },
		],
		'sign-off': [
			{ frequency: 780, at: 0, duration: 0.13 },
			{ frequency: 520, at: 0.15, duration: 0.2 },
		],
		'sign-on': [
			{ frequency: 520, at: 0, duration: 0.1 },
			{ frequency: 690, at: 0.12, duration: 0.11 },
			{ frequency: 920, at: 0.25, duration: 0.17 },
		],
	};
	let finalStop = context.currentTime;
	for ( const note of sequences[ kind ] ) {
		const start = context.currentTime + note.at;
		const stop = start + note.duration;
		const gain = context.createGain();
		gain.gain.setValueAtTime( 0.0001, start );
		gain.gain.exponentialRampToValueAtTime( 0.055, start + 0.012 );
		gain.gain.exponentialRampToValueAtTime( 0.0001, stop );
		gain.connect( context.destination );

		const oscillator = context.createOscillator();
		oscillator.type = 'sine';
		oscillator.frequency.value = note.frequency;
		oscillator.connect( gain );
		oscillator.start( start );
		oscillator.stop( stop );
		finalStop = Math.max( finalStop, stop );
	}

	let closed = false;
	const close = (): void => {
		if ( closed ) {
			return;
		}
		closed = true;
		window.clearTimeout( closeTimer );
		void context.close().catch( () => undefined );
	};
	const closeTimer = window.setTimeout(
		close,
		Math.max( 250, Math.ceil( ( finalStop - context.currentTime ) * 1000 ) + 100 ),
	);
	return close;
}

function createRetroSecretHandler( onToggle: ( active: boolean ) => void ): ( event: KeyboardEvent ) => void {
	let buffer = '';
	return ( event: KeyboardEvent ): void => {
		const target = event.target as Element | null;
		if (
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			event.key.length !== 1 ||
			target?.closest(
				'input, textarea, select, [contenteditable="true"], wpd-text-field',
			)
		) {
			return;
		}
		buffer = `${ buffer }${ event.key.toLowerCase() }`.slice( -3 );
		if ( buffer !== 'sol' ) {
			return;
		}
		const store = getStore();
		store.state.retroMode = ! store.state.retroMode;
		store.notify();
		onToggle( store.state.retroMode );
		buffer = '';
	};
}

function openAboutDialog(): () => void {
	const modal = document.createElement( 'wpd-modal' );
	modal.className = 'feed-buddy-about';
	modal.dataset.feedBuddyAboutDialog = '';
	modal.setAttribute( 'open', '' );
	modal.setAttribute( 'size', 'sm' );
	modal.setAttribute( 'title', __( 'About SOL Inbound Monologue' ) );

	const mark = createElement(
		'div',
		'feed-buddy-about__mark',
		'SOL Inbound Monologue',
	);
	const expandedName = createElement(
		'small',
		'feed-buddy-about__expanded',
		__( 'SOL = Syndicated Open Links' ),
	);
	const description = createElement(
		'p',
		'feed-buddy-about__description',
		__( 'Feeds talk. You listen. Replies are not supported by this protocol.' ),
	);
	const footnote = createElement(
		'p',
		'feed-buddy-about__footnote',
		__( '“Instant” was unavailable, so accuracy won.' ),
	);
	const close = createButton( __( 'Okay' ), 'close-about', 'primary' );
	close.setAttribute( 'slot', 'footer' );
	modal.append( mark, expandedName, description, footnote, close );
	document.body.appendChild( modal );

	let closed = false;
	const cleanup = (): void => {
		if ( closed ) {
			return;
		}
		closed = true;
		modal.remove();
	};
	modal.addEventListener(
		'wpd-modal-cancel',
		() => window.queueMicrotask( cleanup ),
		{ once: true },
	);
	close.addEventListener( 'click', cleanup, { once: true } );
	return cleanup;
}

function mountWidget(
	container: HTMLElement,
	_context: WidgetContext,
): () => void {
	const root = createElement( 'div', 'feed-buddy-widget' );
	container.appendChild( root );
	const store = getStore();
	const controller = new AbortController();
	const chimeCleanups = new Set< () => void >();
	const clearTimers = new Set< number >();
	const collapsedGroups = new Set< string >();

	const applyGroupVisibility = (): void => {
		for ( const header of root.querySelectorAll< HTMLElement >(
			'.feed-buddy-widget__group',
		) ) {
			const group = header.dataset.feedBuddyGroup ?? '';
			const collapsed = collapsedGroups.has( group );
			header.setAttribute( 'aria-expanded', String( ! collapsed ) );
			const toggle = header.querySelector< HTMLElement >(
				'.feed-buddy-widget__group-toggle',
			);
			if ( toggle ) {
				toggle.textContent = collapsed ? '+' : '−';
			}
		}
		for ( const feed of root.querySelectorAll< HTMLElement >(
			'.feed-buddy-widget__feed',
		) ) {
			feed.hidden = collapsedGroups.has( feed.dataset.feedBuddyGroup ?? '' );
		}
	};
	const paint = ( state: Readonly< FeedBuddyClientState > ): void => {
		renderWidget( root, state );
		applyGroupVisibility();
	};
	const offStore = store.subscribe( paint );
	paint( store.getState() );
	const onSecretKeyDown = createRetroSecretHandler( ( active ) => {
		if ( store.state.server?.preferences.soundEnabled ) {
			chimeCleanups.add( playRetroChime( 'message' ) );
		}
		setStatus(
			root,
			active
				? __( 'Retro mode unlocked. Welcome to the information superhighway! :-)' )
				: __( 'Retro mode signed off.' ),
		);
	} );

	const onClick = ( event: Event ): void => {
		const target = event.target as Element | null;
		const button = target?.closest< HTMLElement >( '[data-feed-buddy-action]' );
		if ( ! button ) {
			return;
		}
		const action = button.dataset.feedBuddyAction;
		if ( action === 'select-feed' ) {
			openReader( button.dataset.feedId ?? null );
		} else if ( action === 'toggle-group' ) {
			const group = button.dataset.feedBuddyGroup ?? '';
			if ( collapsedGroups.has( group ) ) {
				collapsedGroups.delete( group );
			} else {
				collapsedGroups.add( group );
			}
			applyGroupVisibility();
		} else if ( action === 'add-feed' ) {
			openReader( null, true );
		} else if ( action === 'toggle-away' ) {
			const goingAway = store.state.presenceMode !== 'away';
			store.state.presenceMode = goingAway ? 'away' : 'online';
			store.notify();
			if ( store.state.server?.preferences.soundEnabled ) {
				chimeCleanups.add(
					playRetroChime( goingAway ? 'sign-off' : 'sign-on' ),
				);
			}
			setStatus(
				root,
				goingAway
					? __( 'Away message set. Your feeds will keep listening.' )
					: __( 'Welcome back! Buddies are online.' ),
			);
		} else if ( action === 'refresh' ) {
			setStatus( root, __( 'BRB — checking buddies…' ) );
			void refreshFeeds( null, controller.signal )
				.then( ( next ) => {
					const offlineFeedIds = newlyOfflineFeedIds( store.state.server, next );
					const newFeedIds = applyServerState( next, true );
					if ( next.preferences.soundEnabled ) {
						if ( offlineFeedIds.length > 0 ) {
							chimeCleanups.add( playRetroChime( 'sign-off' ) );
						}
						if ( newFeedIds.length > 0 ) {
							chimeCleanups.add( playRetroChime( 'message' ) );
						}
					}
					setStatus(
						root,
						offlineFeedIds.length > 0
							? __( 'Back online. A feed buddy went offline.' )
							: __( 'Back online. Buddy list refreshed.' ),
					);
				} )
				.catch( ( error ) => {
					if ( ! isAbortError( error ) ) {
						setError( error );
					}
				} );
		} else if ( action === 'toggle-sound' ) {
			const enabled = ! Boolean( store.state.server?.preferences.soundEnabled );
			void updatePreferences( enabled, controller.signal )
				.then( ( next ) => {
					applyServerState( next );
					chimeCleanups.add(
						playRetroChime( enabled ? 'sign-on' : 'sign-off' ),
					);
					setStatus(
						root,
						enabled
							? __( 'Chimes on. New posts may make a sound.' )
							: __( 'Chimes off.' ),
					);
				} )
				.catch( ( error ) => {
					if ( ! isAbortError( error ) ) {
						setError( error );
					}
				} );
		} else if ( action === 'mark-all' ) {
			void updateReadState( { scope: 'all', read: true }, controller.signal )
				.then( ( next ) => {
					applyServerState( next );
					setStatus( root, __( 'All quiet — zero unread.' ) );
				} )
				.catch( ( error ) => {
					if ( ! isAbortError( error ) ) {
						setError( error );
					}
				} );
		}
	};
	root.addEventListener( 'click', onClick );
	root.addEventListener( 'keydown', onSecretKeyDown );

	void ensureState( controller.signal ).catch( ( error ) => {
		if ( ! isAbortError( error ) ) {
			setError( error );
		}
	} );

	const pollTimer = window.setInterval( () => {
		void pollState( controller.signal ).then( ( result ) => {
			if (
				result.newFeedIds.length === 0 &&
				result.offlineFeedIds.length === 0
			) {
				return;
			}
			if ( getStore().state.server?.preferences.soundEnabled ) {
				if ( result.offlineFeedIds.length > 0 ) {
					chimeCleanups.add( playRetroChime( 'sign-off' ) );
				}
				if ( result.newFeedIds.length > 0 ) {
					chimeCleanups.add( playRetroChime( 'message' ) );
				}
			}
			if ( result.offlineFeedIds.length > 0 ) {
				setStatus( root, __( 'A feed buddy went offline.' ) );
			}
			const timer = window.setTimeout( () => {
				clearNewFeedIds();
				clearTimers.delete( timer );
			}, 3000 );
			clearTimers.add( timer );
		} );
	}, Math.max( 60000, Number( desktop().getWindowConfig( WINDOW_ID )?.pollMs ) || 300000 ) );

	return () => {
		controller.abort();
		window.clearInterval( pollTimer );
		for ( const timer of clearTimers ) {
			window.clearTimeout( timer );
		}
		for ( const cleanup of chimeCleanups ) {
			cleanup();
		}
		root.removeEventListener( 'click', onClick );
		root.removeEventListener( 'keydown', onSecretKeyDown );
		offStore();
		root.remove();
	};
}

function applyReaderTheme(): void {
	desktop().applyWindowTheme( WINDOW_ID, {
		tokens: {
			'--desktop-mode-window-bg': '#c0c0c0',
			'--desktop-mode-window-border': '#1f1f1f',
			'--desktop-mode-window-radius': '2px',
			'--desktop-mode-window-shadow': '3px 3px 0 rgba(0,0,0,.24)',
			'--desktop-mode-window-shadow-focused': '4px 4px 0 rgba(0,0,0,.3)',
			'--desktop-mode-titlebar-bg': '#808080',
			'--desktop-mode-titlebar-bg-focused': '#063eb7',
			'--desktop-mode-titlebar-image': 'none',
			'--desktop-mode-titlebar-image-focused': 'none',
			'--desktop-mode-titlebar-color': '#ffffff',
			'--desktop-mode-titlebar-color-focused': '#ffffff',
			'--wpd-btn-color': '#111111',
			'--wpd-btn-bg-hover': '#d9e7ff',
			'--wpd-btn-outline': '#000000',
		},
	} );
}

function populateFeedSelect(
	root: HTMLElement,
	server: FeedBuddyServerState | null,
	selected: string | null,
): void {
	const select = root.querySelector< HTMLElement >( '[data-feed-buddy-feed-select]' );
	if ( ! select ) {
		return;
	}
	const options: HTMLElement[] = [];
	const all = document.createElement( 'wpd-option' );
	all.setAttribute( 'value', '' );
	all.textContent = __( 'All feeds' );
	options.push( all );
	for ( const subscription of server?.subscriptions ?? [] ) {
		const option = document.createElement( 'wpd-option' );
		option.setAttribute( 'value', subscription.id );
		option.textContent = subscription.title;
		options.push( option );
	}
	select.replaceChildren( ...options );
	setCustomValue( select, selected ?? '' );
}

function renderTranscript(
	root: HTMLElement,
	state: Readonly< FeedBuddyClientState >,
): void {
	const list = root.querySelector< HTMLOListElement >( '[data-feed-buddy-items]' );
	const empty = root.querySelector< HTMLElement >( '[data-feed-buddy-empty]' );
	const loading = root.querySelector< HTMLElement >( '[data-feed-buddy-loading]' );
	if ( ! list || ! empty || ! loading ) {
		return;
	}
	const emptyTitle = root.querySelector< HTMLElement >( '[data-feed-buddy-empty-title]' );
	const emptyCopy = root.querySelector< HTMLElement >( '[data-feed-buddy-empty-copy]' );
	const addFirst = root.querySelector< HTMLElement >( '[data-feed-buddy-add-first]' );

	const hasSubscriptions = Boolean( state.server?.subscriptions.length );
	loading.hidden = ! state.itemsLoading;
	empty.hidden = state.itemsLoading || state.items.length > 0;
	if ( emptyTitle ) {
		emptyTitle.textContent = hasSubscriptions
			? __( 'No recent messages' )
			: __( 'Your buddy list is quiet' );
	}
	if ( emptyCopy ) {
		emptyCopy.textContent = hasSubscriptions
			? __( 'This conversation has no cached posts yet. Try refreshing the feed.' )
			: __( 'Add an RSS or Atom feed to start a conversation.' );
	}
	if ( addFirst ) {
		addFirst.hidden = hasSubscriptions;
	}
	list.hidden = state.items.length === 0;
	list.replaceChildren();

	for ( const item of state.items ) {
		const row = createElement( 'li', 'feed-buddy-message' );
		row.dataset.feedId = item.feedId;
		row.dataset.itemId = item.id;
		row.classList.toggle( 'feed-buddy-message--unread', item.unread );

		const messageIcon = createElement(
			'span',
			'feed-buddy-message__icon dashicons dashicons-media-text',
		);
		messageIcon.setAttribute( 'aria-hidden', 'true' );

		const message = createElement( 'article', 'feed-buddy-message__body' );
		const meta = createElement( 'header', 'feed-buddy-message__meta' );
		const sender = createElement( 'strong', '', item.feedTitle );
		meta.appendChild( sender );
		if ( item.author ) {
			meta.appendChild( createElement( 'span', '', item.author ) );
		}
		if ( item.publishedAt ) {
			const time = document.createElement( 'wpd-relative-time' );
			time.setAttribute( 'datetime', item.publishedAt );
			meta.appendChild( time );
		}

		const headline = createElement( 'h2', 'feed-buddy-message__title' );
		headline.textContent = item.title;

		const excerpt = createElement( 'p', 'feed-buddy-message__excerpt', item.excerpt );
		const actions = createElement( 'footer', 'feed-buddy-message__actions' );
		const openLink = createElement( 'a', 'feed-buddy-message__open', __( 'Open article' ) );
		openLink.href = item.url;
		openLink.target = '_blank';
		openLink.rel = 'noopener noreferrer';
		openLink.dataset.feedBuddyAction = 'open-article';
		const toggle = createButton(
			item.unread ? __( 'Mark read' ) : __( 'Mark unread' ),
			'toggle-read',
			'secondary',
		);
		toggle.dataset.feedId = item.feedId;
		toggle.dataset.itemId = item.id;
		toggle.dataset.read = item.unread ? 'true' : 'false';
		actions.append( openLink, toggle );
		message.append( meta, headline, excerpt, actions );
		row.append( messageIcon, message );
		list.appendChild( row );
	}
}

function renderManager(
	root: HTMLElement,
	state: Readonly< FeedBuddyClientState >,
): void {
	const manager = root.querySelector< HTMLElement >( '[data-feed-buddy-manager]' );
	const list = root.querySelector< HTMLElement >( '[data-feed-buddy-manager-list]' );
	if ( ! manager || ! list ) {
		return;
	}
	manager.hidden = ! state.managerOpen;
	list.replaceChildren();

	for ( const subscription of state.server?.subscriptions ?? [] ) {
		const card = createElement( 'section', 'feed-buddy-manager__item' );
		card.dataset.feedId = subscription.id;

		const title = document.createElement( 'wpd-text-field' );
		title.dataset.feedBuddyField = 'title';
		title.setAttribute( 'label', __( 'Feed title' ) );
		setCustomValue( title, subscription.title );

		const group = document.createElement( 'wpd-text-field' );
		group.dataset.feedBuddyField = 'group';
		group.setAttribute( 'label', __( 'Buddy group' ) );
		setCustomValue( group, subscription.group );

		const url = createElement( 'small', 'feed-buddy-manager__url', subscription.url );
		const actions = createElement( 'div', 'feed-buddy-manager__actions' );
		for ( const [ label, action, variant ] of [
			[ __( 'Save' ), 'save', 'primary' ],
			[ __( 'Move up' ), 'up', 'secondary' ],
			[ __( 'Move down' ), 'down', 'secondary' ],
			[ __( 'Remove' ), 'remove', 'danger' ],
		] as const ) {
			const button = createButton( label, action, variant );
			button.dataset.feedId = subscription.id;
			actions.appendChild( button );
		}
		card.append( title, group, url, actions );
		list.appendChild( card );
	}
}

function renderReader( root: HTMLElement, state: Readonly< FeedBuddyClientState > ): void {
	root.dataset.feedBuddyPresence = state.presenceMode;
	root.toggleAttribute( 'data-retro-egg', state.retroMode );
	populateFeedSelect( root, state.server, state.selectedFeedId );
	renderTranscript( root, state );
	renderManager( root, state );

	const selected = state.server?.subscriptions.find(
		( subscription ) => subscription.id === state.selectedFeedId,
	);
	const conversationName = root.querySelector< HTMLElement >(
		'[data-feed-buddy-conversation-name]',
	);
	if ( conversationName ) {
		conversationName.textContent = selected?.title ?? __( 'All buddies' );
	}
	const presence = root.querySelector< HTMLElement >(
		'.feed-buddy-reader__identity .feed-buddy-presence',
	);
	if ( presence ) {
		presence.classList.toggle(
			'feed-buddy-presence--online',
			state.presenceMode === 'online',
		);
		presence.classList.toggle(
			'feed-buddy-presence--away',
			state.presenceMode === 'away',
		);
	}
	const presenceCopy = root.querySelector< HTMLElement >(
		'[data-feed-buddy-presence-copy]',
	);
	if ( presenceCopy ) {
		if ( state.presenceMode === 'away' ) {
			presenceCopy.textContent = sprintf(
				/* translators: %d: number of unread feed items. */
				__( 'idle — %d unread' ),
				totalUnread( state.server ),
			);
		} else if ( state.retroMode ) {
			presenceCopy.textContent = __( 'Online — totally wired :-)' );
		} else {
			presenceCopy.textContent = __( 'Online — incoming articles' );
		}
	}
	const flavor = root.querySelector< HTMLElement >( '[data-feed-buddy-flavor]' );
	if ( flavor ) {
		if ( state.presenceMode === 'away' ) {
			flavor.textContent = __( 'Away messages enabled' );
		} else if ( state.retroMode ) {
			flavor.textContent = __( 'Buddy mode: information superhighway :-)' );
		} else {
			flavor.textContent = __( 'RSS conversation' );
		}
	}

	const sound = root.querySelector< HTMLElement >( '[data-feed-buddy-sound]' );
	if ( sound ) {
		const enabled = Boolean( state.server?.preferences.soundEnabled );
		sound.textContent = enabled ? __( 'Sound on' ) : __( 'Sound off' );
		sound.setAttribute( 'aria-pressed', String( enabled ) );
	}
	if ( state.error ) {
		setStatus( root, state.error, true );
	}
}

async function loadItemsForSelection( signal?: AbortSignal ): Promise< void > {
	const store = getStore();
	const feedId = store.state.selectedFeedId;
	store.state.itemsLoading = true;
	store.state.error = null;
	store.notify();
	try {
		const page = await fetchItems( feedId, signal );
		if ( signal?.aborted ) {
			return;
		}
		store.state.items = page.items;
		store.state.itemsForFeedId = feedId;
	} catch ( error ) {
		if ( ( error as DOMException )?.name !== 'AbortError' ) {
			setError( error );
		}
	} finally {
		if ( ! signal?.aborted ) {
			store.state.itemsLoading = false;
			store.notify();
		}
	}
}

function findSubscriptionCard(
	root: HTMLElement,
	feedId: string,
): HTMLElement | null {
	return Array.from(
		root.querySelectorAll< HTMLElement >( '.feed-buddy-manager__item' ),
	).find( ( card ) => card.dataset.feedId === feedId ) ?? null;
}

async function handleManagerAction(
	root: HTMLElement,
	action: string,
	feedId: string,
	signal: AbortSignal,
	onBuddyRemoved?: () => void,
): Promise< void > {
	if ( action === 'remove' ) {
		const subscription = getStore().state.server?.subscriptions.find(
			( item ) => item.id === feedId,
		);
		const confirmed = await desktop().confirm( {
			title: __( 'Remove feed?' ),
			message: sprintf(
				/* translators: %s: feed title. */
				__( 'Remove “%s” from your buddy list?' ),
				subscription?.title ?? __( 'this feed' ),
			),
			confirmLabel: __( 'Remove' ),
			danger: true,
		} );
		if ( ! confirmed ) {
			return;
		}
		const next = await deleteSubscription( feedId, signal );
		applyServerState( next );
		await loadItemsForSelection( signal );
		onBuddyRemoved?.();
		setStatus( root, __( 'Buddy signed off.' ) );
		return;
	}

	if ( action === 'up' || action === 'down' ) {
		const next = await updateSubscription(
			feedId,
			{ direction: action === 'up' ? -1 : 1 },
			signal,
		);
		applyServerState( next );
		setStatus( root, __( 'Buddy order updated.' ) );
		return;
	}

	if ( action === 'save' ) {
		const card = findSubscriptionCard( root, feedId );
		const title = customValue( card?.querySelector( '[data-feed-buddy-field="title"]' ) ?? null );
		const group = customValue( card?.querySelector( '[data-feed-buddy-field="group"]' ) ?? null );
		const next = await updateSubscription( feedId, { title, group }, signal );
		applyServerState( next );
		setStatus( root, __( 'Feed details saved.' ) );
	}
}

async function mountReader(
	container: HTMLElement,
	context: NativeRenderContext,
): Promise< () => void > {
	const root = container.querySelector< HTMLElement >( '[data-feed-buddy-reader]' );
	if ( ! root ) {
		throw new Error( 'SOL Inbound Monologue reader template is missing.' );
	}

	applyReaderTheme();
	const store = getStore();
	const offStore = store.subscribe( ( state ) => renderReader( root, state ) );
	const chimeCleanups = new Set< () => void >();
	let aboutCleanup: ( () => void ) | null = null;
	const onSecretKeyDown = createRetroSecretHandler( ( active ) => {
		if ( store.state.server?.preferences.soundEnabled ) {
			chimeCleanups.add( playRetroChime( 'message' ) );
		}
		setStatus(
			root,
			active
				? __( 'Retro mode unlocked. Welcome to the information superhighway! :-)' )
				: __( 'Retro mode signed off.' ),
		);
	} );
	const offChannel = context.window.on< { feedId?: string | null; manager?: boolean } >(
		'feed:select',
		( payload ) => {
			selectFeed( payload?.feedId ?? null );
			store.state.managerOpen = Boolean( payload?.manager );
			store.notify();
			void loadItemsForSelection( context.signal );
		},
	);
	const offResize = context.onResize( ( width ) => {
		root.toggleAttribute( 'data-compact', width < 560 );
	} );

	const onPick = ( event: Event ): void => {
		const target = event.target as Element | null;
		if ( ! target?.matches( '[data-feed-buddy-feed-select]' ) ) {
			return;
		}
		const detail = ( event as CustomEvent< { value?: string } > ).detail;
		selectFeed( detail?.value || null );
		void loadItemsForSelection( context.signal );
	};

	const onSubmit = ( event: Event ): void => {
		const form = event.target as HTMLFormElement | null;
		if ( ! form?.matches( '[data-feed-buddy-add-form]' ) ) {
			return;
		}
		event.preventDefault();
		const url = customValue( form.querySelector( '[name="url"]' ) );
		const group = customValue( form.querySelector( '[name="group"]' ) );
		const addBuddy = async (): Promise< void > => {
			if ( ( store.state.server?.subscriptions.length ?? 0 ) === 199 ) {
				const confirmed = await desktop().confirm( {
					title: __( 'Add feed buddy #200?' ),
					message: __( 'Are you sure? You will not read these.' ),
					confirmLabel: __( 'Add it anyway' ),
				} );
				if ( ! confirmed ) {
					setStatus( root, __( 'Good call. Buddy not added.' ) );
					return;
				}
			}
			setStatus( root, __( 'Adding buddy…' ) );
			try {
				const next = await addSubscription( url, group, context.signal );
				applyServerState( next );
				setCustomValue( form.querySelector( '[name="url"]' )!, '' );
				if ( next.preferences.soundEnabled ) {
					chimeCleanups.add( playRetroChime( 'sign-on' ) );
				}
				setStatus(
					root,
					__( 'New buddy signed on. Existing posts were marked read.' ),
				);
				await loadItemsForSelection( context.signal );
			} catch ( error ) {
				setError( error );
				setStatus( root, error instanceof Error ? error.message : String( error ), true );
			}
		};
		void addBuddy();
	};

	const onClick = ( event: Event ): void => {
		const target = event.target as Element | null;
		const actionElement = target?.closest< HTMLElement >(
			'[data-feed-buddy-action], [data-feed-buddy-about], [data-feed-buddy-manage], [data-feed-buddy-refresh], [data-feed-buddy-sound], [data-feed-buddy-mark-all], [data-feed-buddy-add-first], [data-feed-buddy-close-manager]',
		);
		if ( ! actionElement ) {
			return;
		}

		if ( actionElement.matches( '[data-feed-buddy-manage], [data-feed-buddy-add-first]' ) ) {
			store.state.managerOpen = true;
			store.notify();
			return;
		}
		if ( actionElement.matches( '[data-feed-buddy-close-manager]' ) ) {
			store.state.managerOpen = false;
			store.notify();
			return;
		}
		if ( actionElement.matches( '[data-feed-buddy-about]' ) ) {
			aboutCleanup?.();
			aboutCleanup = openAboutDialog();
			return;
		}
		if ( actionElement.matches( '[data-feed-buddy-refresh]' ) ) {
			setStatus( root, __( 'BRB — checking feeds…' ) );
			void refreshFeeds( store.state.selectedFeedId, context.signal )
				.then( async ( next ) => {
					const offlineFeedIds = newlyOfflineFeedIds( store.state.server, next );
					const newIds = applyServerState( next, true );
					if ( next.preferences.soundEnabled ) {
						if ( offlineFeedIds.length > 0 ) {
							chimeCleanups.add( playRetroChime( 'sign-off' ) );
						}
						if ( newIds.length > 0 ) {
							chimeCleanups.add( playRetroChime( 'message' ) );
						}
					}
					await loadItemsForSelection( context.signal );
					setStatus(
						root,
						offlineFeedIds.length > 0
							? __( 'Back online. A feed buddy went offline.' )
							: __( 'Back online. Feeds refreshed.' ),
					);
				} )
				.catch( ( error ) => setStatus( root, error instanceof Error ? error.message : String( error ), true ) );
			return;
		}
		if ( actionElement.matches( '[data-feed-buddy-mark-all]' ) ) {
			const body = store.state.selectedFeedId
				? { scope: 'feed' as const, read: true, feedId: store.state.selectedFeedId }
				: { scope: 'all' as const, read: true };
			void updateReadState( body, context.signal )
				.then( async ( next ) => {
					applyServerState( next );
					await loadItemsForSelection( context.signal );
					setStatus( root, __( 'All quiet — zero unread.' ) );
				} )
				.catch( setError );
			return;
		}
		if ( actionElement.matches( '[data-feed-buddy-sound]' ) ) {
			const enabled = ! Boolean( store.state.server?.preferences.soundEnabled );
			void updatePreferences( enabled, context.signal )
				.then( ( next ) => {
					applyServerState( next );
					chimeCleanups.add(
						playRetroChime( enabled ? 'sign-on' : 'sign-off' ),
					);
					setStatus(
						root,
						enabled
							? __( 'Chimes on. New posts may make a sound.' )
							: __( 'Chimes off.' ),
					);
				} )
				.catch( setError );
			return;
		}

		const action = actionElement.dataset.feedBuddyAction;
		const feedId = actionElement.dataset.feedId;
		if ( action === 'open-article' ) {
			const message = actionElement.closest< HTMLElement >( '.feed-buddy-message' );
			if ( message?.dataset.feedId && message.dataset.itemId ) {
				void updateReadState(
					{
						scope: 'item',
						read: true,
						feedId: message.dataset.feedId,
						itemIds: [ message.dataset.itemId ],
					},
					context.signal,
				).then( ( next ) => {
					applyServerState( next );
					const item = store.state.items.find(
						( candidate ) => candidate.id === message.dataset.itemId,
					);
					if ( item ) {
						item.unread = false;
						store.notify();
					}
				} ).catch( ( error ) => {
					if ( ! isAbortError( error ) ) {
						setError( error );
					}
				} );
			}
			return;
		}
		if ( action === 'toggle-read' && feedId && actionElement.dataset.itemId ) {
			void updateReadState(
				{
					scope: 'item',
					read: actionElement.dataset.read === 'true',
					feedId,
					itemIds: [ actionElement.dataset.itemId ],
				},
				context.signal,
			)
				.then( async ( next ) => {
					applyServerState( next );
					await loadItemsForSelection( context.signal );
				} )
				.catch( setError );
			return;
		}
		if ( action && feedId ) {
			void handleManagerAction(
				root,
				action,
				feedId,
				context.signal,
				() => {
					if ( store.state.server?.preferences.soundEnabled ) {
						chimeCleanups.add( playRetroChime( 'sign-off' ) );
					}
				},
			).catch(
				( error ) => {
					setError( error );
					setStatus( root, error instanceof Error ? error.message : String( error ), true );
				},
			);
		}
	};

	root.addEventListener( 'wpd-pick', onPick );
	root.addEventListener( 'submit', onSubmit );
	root.addEventListener( 'click', onClick );
	root.addEventListener( 'keydown', onSecretKeyDown );

	context.markLoading();
	try {
		await ensureState( context.signal );
		await loadItemsForSelection( context.signal );
		renderReader( root, store.getState() );
	} catch ( error ) {
		if ( ( error as DOMException )?.name !== 'AbortError' ) {
			setError( error );
		}
	} finally {
		if ( ! context.signal.aborted ) {
			context.markReady();
		}
	}

	return () => {
		root.removeEventListener( 'wpd-pick', onPick );
		root.removeEventListener( 'submit', onSubmit );
		root.removeEventListener( 'click', onClick );
		root.removeEventListener( 'keydown', onSecretKeyDown );
		for ( const cleanup of chimeCleanups ) {
			cleanup();
		}
		aboutCleanup?.();
		offResize();
		offChannel();
		offStore();
		desktop().applyWindowTheme( WINDOW_ID, null );
	};
}

const widgetRegistry = ( window.desktopModeWidgets ??= {} );
widgetRegistry[ WIDGET_ID ] = mountWidget;

const windowRegistry = ( window.desktopModeNativeWindows ??= {} );
windowRegistry[ WINDOW_ID ] = mountReader;

export {
	applyReaderTheme,
	loadItemsForSelection,
	mountReader,
	mountWidget,
	renderReader,
	renderTranscript,
	renderWidget,
};
