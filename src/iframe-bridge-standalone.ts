interface ConnectionRecord {
	id: string;
	topics: string[];
}

type SubscriberCb = (
	payload: unknown,
	meta: { topic: string; connectionId?: string },
) => void;

type ConnectionListenerCb = ( conn: ConnectionRecord ) => void;

interface RequestConnectionOptions {
	topics?: string[];
	timeoutMs?: number;
	onOpen?: ( conn: ConnectionRecord ) => void;
}

interface IframeChromeApi {
	setTheme( tokens: Record< string, string > | null ): void;
	setControls( config: unknown ): void;
	setSlot( name: string, html: string ): void;
}

interface IframeApi {
	publish( topic: string, payload: unknown ): void;
	subscribe( topic: string, cb: SubscriberCb ): () => void;
	onConnection( cb: ConnectionListenerCb ): () => void;
	requestConnection(
		opts: RequestConnectionOptions,
	): Promise< ConnectionRecord >;
	chrome: IframeChromeApi;

	readonly windowId: string | null;

	whenWindowId(): Promise< string >;

	isParentReachable(): boolean;
}

type WindowChannelCb = (
	payload: unknown,
	meta: { channel: string },
) => void;

interface IframeWp {
	os?: {
		iframe?: IframeApi;
		send?: ( channel: string, payload?: unknown ) => void;
		on?: ( channel: string, cb: WindowChannelCb ) => () => void;
	};
}

export function installEditorAutosaveHandler(): void {
	const flagged = window as unknown as {
		__openStationEditorAutosaveInstalled?: boolean;
	};
	if ( flagged.__openStationEditorAutosaveInstalled ) {
		return;
	}
	flagged.__openStationEditorAutosaveInstalled = true;

	const origin = window.location.origin;

	interface EditorSelect {
		isEditedPostAutosaveable?: () => boolean;
		isEditedPostDirty?: () => boolean;
		isAutosavingPost?: () => boolean;
		isSavingPost?: () => boolean;
		getEditedPostAttribute?: ( attr: string ) => unknown;
	}
	interface BlockEditorSelect {
		getBlocks?: () => unknown;
	}
	interface EditorDispatch {
		__unstableSaveForPreview?: () => Promise< unknown > | unknown;
		autosave?: () => unknown;
	}
	interface EditorWp {
		data?: {
			select?: (
				store: string,
			) => ( EditorSelect & BlockEditorSelect ) | undefined;
			dispatch?: ( store: string ) => EditorDispatch | undefined;
			subscribe?: ( cb: () => void ) => () => void;
		};
		autosave?: {
			server?: { triggerSave?: () => void };
		};
	}

	const getEditorWp = (): EditorWp | undefined =>
		( window as unknown as { wp?: EditorWp } ).wp;

	const sameOriginLink = ( link: unknown ): string | undefined => {
		if ( typeof link !== 'string' || link === '' ) {
			return undefined;
		}
		try {
			return new URL( link, origin ).origin === origin
				? link
				: undefined;
		} catch {
			return undefined;
		}
	};

	const postToParent = ( message: Record< string, unknown > ): void => {
		try {
			window.parent.postMessage( message, origin );
		} catch {

		}
	};

	const liveWatches: Map< string, () => void > = new Map();

	const startLiveWatch = (
		watchId: string,
		debounceMs: number,
	): ( () => void ) | null => {
		const editorWp = getEditorWp();
		const select = editorWp?.data?.select?.( 'core/editor' );

		if ( select && typeof editorWp?.data?.subscribe === 'function' ) {
			const blockSelect = editorWp.data.select?.( 'core/block-editor' );
			const dispatch = editorWp.data.dispatch?.( 'core/editor' );
			let timer: number | null = null;
			let stopped = false;

			let lastBlocks = blockSelect?.getBlocks?.();
			let lastTitle = select.getEditedPostAttribute?.( 'title' );
			let absorbSettleTick = false;

			const save = (): void => {
				timer = null;
				if ( stopped ) {
					return;
				}

				if (
					( select.isSavingPost?.() ?? false ) ||
					( select.isAutosavingPost?.() ?? false )
				) {
					timer = window.setTimeout( save, 1000 );
					return;
				}

				if (
					typeof select.isEditedPostAutosaveable === 'function' &&
					! select.isEditedPostAutosaveable()
				) {
					return;
				}
				if ( typeof dispatch?.__unstableSaveForPreview === 'function' ) {
					Promise.resolve( dispatch.__unstableSaveForPreview() )
						.then( ( link ) => {
							if ( ! stopped ) {
								postToParent( {
									type: 'os-editor-live-saved',
									watchId,
									...( sameOriginLink( link )
										? { previewUrl: sameOriginLink( link ) }
										: {} ),
								} );
							}
						} )
						.catch( () => {

						} );
					return;
				}
				if ( typeof dispatch?.autosave === 'function' ) {
					void dispatch.autosave();
					postToParent( {
						type: 'os-editor-live-saved',
						watchId,
					} );
				}
			};

			const unsubscribe = editorWp.data.subscribe( () => {
				const blocks = blockSelect?.getBlocks?.();
				const title = select.getEditedPostAttribute?.( 'title' );

				const saving =
					( select.isSavingPost?.() ?? false ) ||
					( select.isAutosavingPost?.() ?? false );
				if ( saving ) {
					lastBlocks = blocks;
					lastTitle = title;
					absorbSettleTick = true;
					return;
				}
				if ( absorbSettleTick ) {
					absorbSettleTick = false;
					lastBlocks = blocks;
					lastTitle = title;
					return;
				}

				if ( blocks === lastBlocks && title === lastTitle ) {
					return;
				}
				lastBlocks = blocks;
				lastTitle = title;

				if (
					typeof select.isEditedPostDirty === 'function' &&
					! select.isEditedPostDirty()
				) {
					return;
				}

				if ( timer !== null ) {
					window.clearTimeout( timer );
				}
				timer = window.setTimeout( save, debounceMs );
			} );

			return () => {
				stopped = true;
				unsubscribe();
				if ( timer !== null ) {
					window.clearTimeout( timer );
					timer = null;
				}
			};
		}

		if ( editorWp?.autosave?.server ) {
			const jqWindow = window as unknown as {
				jQuery?: ( el: Document ) => {
					on: ( evt: string, cb: () => void ) => void;
					off: ( evt: string ) => void;
				};
			};
			const jq = jqWindow.jQuery;
			if ( ! jq ) {
				return null;
			}

			let timer: number | null = null;
			let stopped = false;

			let inFlight = false;

			interface TinyEditor {
				on?: ( events: string, cb: () => void ) => void;
				off?: ( events: string, cb: () => void ) => void;
				getContent?: () => string;
				isHidden?: () => boolean;
			}
			interface Tiny {
				editors?: TinyEditor[];
				get?: ( id: string ) => TinyEditor | null | undefined;
				on?: (
					name: string,
					cb: ( e: { editor?: TinyEditor } ) => void,
				) => void;
				off?: (
					name: string,
					cb: ( e: { editor?: TinyEditor } ) => void,
				) => void;
			}
			const tiny = ( window as unknown as { tinymce?: Tiny } )
				.tinymce;

			const fieldValue = ( id: string ): string | null => {
				const el = document.getElementById( id );
				if ( ! el || ! ( 'value' in el ) ) {
					return null;
				}
				return String(
					( el as HTMLInputElement | HTMLTextAreaElement ).value,
				);
			};

			const contentFingerprint = (): string | null => {
				const parts: string[] = [];
				let found = false;
				const title = fieldValue( 'title' );
				if ( title !== null ) {
					found = true;
				}
				parts.push( title ?? '' );
				for ( const field of [ 'content', 'excerpt' ] ) {
					let text: string | null = null;
					try {
						const ed = tiny?.get?.( field );
						if ( ed && ! ed.isHidden?.() ) {
							text = ed.getContent?.() ?? null;
						}
					} catch {

					}
					if ( text === null ) {
						text = fieldValue( field );
					}
					if ( text !== null ) {
						found = true;
					}
					parts.push( text ?? '' );
				}

				return found
					? parts.map( ( p ) => `${ p.length }:${ p }` ).join( '' )
					: null;
			};

			let announced = contentFingerprint();

			let pending: string | null = null;

			let sawEdit = false;

			const save = (): void => {
				timer = null;
				if ( stopped ) {
					return;
				}
				if ( inFlight ) {
					timer = window.setTimeout( save, 1000 );
					return;
				}

				const current = contentFingerprint();
				if ( current !== null && current === announced ) {
					return;
				}
				try {
					editorWp.autosave?.server?.triggerSave?.();
				} catch {

				}
			};

			const schedule = (): void => {
				if ( stopped ) {
					return;
				}
				sawEdit = true;
				if ( timer !== null ) {
					window.clearTimeout( timer );
				}
				timer = window.setTimeout( save, debounceMs );
			};

			const ns = `.os-live-${ watchId }`;
			jq( document ).on( `before-autosave${ ns }`, () => {
				inFlight = true;

				pending = contentFingerprint();
			} );
			jq( document ).on( `after-autosave${ ns }`, () => {
				inFlight = false;
				const saved = pending;
				pending = null;
				const unchanged = saved !== null && saved === announced;

				if ( saved !== null ) {
					announced = saved;
				}

				if ( unchanged || ! sawEdit ) {
					return;
				}
				sawEdit = false;
				postToParent( {
					type: 'os-editor-live-saved',
					watchId,
				} );
			} );

			const fields: HTMLElement[] = [];
			for ( const fieldId of [ 'title', 'content', 'excerpt' ] ) {
				const el = document.getElementById( fieldId );
				if ( el ) {
					el.addEventListener( 'input', schedule );
					fields.push( el );
				}
			}

			const tinyEvents =
				'keyup input change undo redo SetContent ExecCommand';
			const bound: TinyEditor[] = [];
			const bindEditor = ( ed: TinyEditor | undefined ): void => {
				if ( ed?.on ) {
					ed.on( tinyEvents, schedule );
					bound.push( ed );
				}
			};
			( tiny?.editors ?? [] ).forEach( bindEditor );
			const onAddEditor = ( e: { editor?: TinyEditor } ): void =>
				bindEditor( e?.editor );
			tiny?.on?.( 'AddEditor', onAddEditor );

			return () => {
				stopped = true;
				if ( timer !== null ) {
					window.clearTimeout( timer );
					timer = null;
				}
				jq( document ).off( `before-autosave${ ns }` );
				jq( document ).off( `after-autosave${ ns }` );
				for ( const el of fields ) {
					el.removeEventListener( 'input', schedule );
				}
				for ( const ed of bound ) {
					try {
						ed.off?.( tinyEvents, schedule );
					} catch {

					}
				}
				tiny?.off?.( 'AddEditor', onAddEditor );
			};
		}

		return null;
	};

	window.addEventListener( 'message', ( ev: MessageEvent ) => {
		if ( ev.origin !== origin ) {
			return;
		}
		const data = ev?.data as {
			type?: unknown;
			requestId?: unknown;
			watchId?: unknown;
			debounceMs?: unknown;
		} | null;
		if ( ! data || typeof data !== 'object' ) {
			return;
		}

		if (
			data.type === 'os-editor-live-watch' &&
			typeof data.watchId === 'string'
		) {
			liveWatches.get( data.watchId )?.();
			liveWatches.delete( data.watchId );
			const debounceMs = Math.min(
				30000,
				Math.max(
					500,
					typeof data.debounceMs === 'number' ? data.debounceMs : 1500,
				),
			);
			try {
				const teardown = startLiveWatch( data.watchId, debounceMs );
				if ( teardown ) {
					liveWatches.set( data.watchId, teardown );
				}
			} catch {

			}
			return;
		}

		if (
			data.type === 'os-editor-live-unwatch' &&
			typeof data.watchId === 'string'
		) {
			try {
				liveWatches.get( data.watchId )?.();
			} catch {

			}
			liveWatches.delete( data.watchId );
			return;
		}

		if (
			data.type !== 'os-editor-autosave-request' ||
			typeof data.requestId !== 'string'
		) {
			return;
		}
		const requestId = data.requestId;

		let responded = false;
		const respond = (
			status: 'saved' | 'no-editor' | 'not-dirty' | 'error',
			previewUrl?: string,
		): void => {
			if ( responded ) {
				return;
			}
			responded = true;
			try {
				window.parent.postMessage(
					{
						type: 'os-editor-autosave-response',
						requestId,
						status,
						...( previewUrl ? { previewUrl } : {} ),
					},
					origin,
				);
			} catch {

			}
		};

		try {
			const editorWp = getEditorWp();
			const select = editorWp?.data?.select?.( 'core/editor' );

			if ( select ) {
				const dispatch = editorWp?.data?.dispatch?.( 'core/editor' );

				if ( typeof dispatch?.__unstableSaveForPreview === 'function' ) {
					Promise.resolve( dispatch.__unstableSaveForPreview() )
						.then( ( link ) => {
							respond( 'saved', sameOriginLink( link ) );
						} )
						.catch( () => respond( 'error' ) );
					return;
				}

				if (
					typeof select.isEditedPostAutosaveable === 'function' &&
					! select.isEditedPostAutosaveable()
				) {
					respond( 'not-dirty' );
					return;
				}

				if (
					typeof dispatch?.autosave === 'function' &&
					typeof editorWp?.data?.subscribe === 'function'
				) {
					let sawAutosaving = false;
					const unsubscribe = editorWp.data.subscribe( () => {
						const saving = select.isAutosavingPost?.() ?? false;
						if ( saving ) {
							sawAutosaving = true;
							return;
						}
						if ( sawAutosaving ) {
							unsubscribe();
							respond( 'saved' );
						}
					} );

					window.setTimeout( () => {
						unsubscribe();
						respond( 'saved' );
					}, 8000 );
					void dispatch.autosave();
					return;
				}

				respond( 'no-editor' );
				return;
			}

			const triggerSave = editorWp?.autosave?.server?.triggerSave;
			if ( typeof triggerSave === 'function' ) {
				const jqWindow = window as unknown as {
					jQuery?: (
						el: Document,
					) => { one: ( evt: string, cb: () => void ) => void };
				};
				const jq = jqWindow.jQuery;
				if ( jq ) {
					jq( document ).one( 'after-autosave.os-editor-preview', () =>
						respond( 'saved' ),
					);

					window.setTimeout( () => respond( 'not-dirty' ), 5000 );
				} else {
					window.setTimeout( () => respond( 'saved' ), 5000 );
				}
				triggerSave.call( editorWp?.autosave?.server );
				return;
			}

			respond( 'no-editor' );
		} catch {
			respond( 'error' );
		}
	} );
}

( function() {
	if ( ! window.parent || window.parent === window ) {
		return;
	}

	installEditorAutosaveHandler();

	const w = window as unknown as { wp?: IframeWp };
	if ( w.wp?.os?.iframe ) {
		return;
	}

	const parentOrigin = window.location.origin;
	const connections: Record< string, ConnectionRecord > = {};
	const connectionListeners: ConnectionListenerCb[] = [];
	const subs: Record< string, SubscriberCb[] > = {};

	let _windowId: string | null = null;
	const _windowIdWaiters: Array< ( id: string ) => void > = [];
	const _setWindowId = ( id: string ): void => {
		if ( ! id || _windowId === id ) {
			return;
		}
		_windowId = id;
		const waiters = _windowIdWaiters.splice( 0 );
		for ( const waiter of waiters ) {
			try {
				waiter( id );
			} catch {

			}
		}
	};

	const channelSubs: Record< string, WindowChannelCb[] > = {};

	const emitToParent = (
		connectionId: string,
		topic: string,
		payload: unknown,
	): void => {
		try {
			window.parent.postMessage(
				{
					type: 'os-bridge-publish',
					connectionId,
					topic,
					payload,
				},
				parentOrigin,
			);
		} catch {

		}
	};

	window.addEventListener( 'message', ( ev: MessageEvent ) => {
		if ( ev.origin !== parentOrigin ) {
			return;
		}
		const data = ev?.data as
			| {
					type?: string;
					connectionId?: string;
					topic?: string;
					payload?: unknown;
					topics?: unknown;
					requestId?: unknown;
				}
			| null;
		if ( ! data || typeof data !== 'object' || typeof data.type !== 'string' ) {
			return;
		}

		if (
			data.type === 'os-bridge-handshake' &&
			typeof data.connectionId === 'string'
		) {
			const tw = ( data as { targetWindowId?: unknown } ).targetWindowId;
			if ( typeof tw === 'string' && tw !== '' ) {
				_setWindowId( tw );
			}
			if ( connections[ data.connectionId ] ) {
				try {
					window.parent.postMessage(
						{
							type: 'os-bridge-handshake-ack',
							connectionId: data.connectionId,
						},
						parentOrigin,
					);
				} catch {

				}
				return;
			}
			const conn: ConnectionRecord = {
				id: data.connectionId,
				topics: Array.isArray( data.topics ) ? data.topics.slice() : [],
			};
			connections[ conn.id ] = conn;
			try {
				window.parent.postMessage(
					{
						type: 'os-bridge-handshake-ack',
						connectionId: conn.id,
					},
					parentOrigin,
				);
			} catch {

			}
			for ( const listener of connectionListeners ) {
				try {
					listener( { id: conn.id, topics: conn.topics.slice() } );
				} catch {

				}
			}
			return;
		}

		if ( data.type === 'os-bridge-beforeunload-query' ) {
			let prevent = false;
			let msg = '';

			const shimReturnValue = ( e: Event ) => {
				const self = e as unknown as Record<string, unknown>;
				Object.defineProperty( e, 'returnValue', {
					get() {
						return self._returnValue || '';
					},
					set( v ) {
						self._returnValue = v;
					},
				} );
			};

			const checkPrevent = ( event: Event, result: unknown ) => {
				const retVal: unknown = ( event as unknown as Record<string, unknown> ).returnValue;
				const hasResult = typeof result === 'string' && result !== '';
				const hasRetVal = typeof retVal === 'string' && retVal !== '';
				if ( event.defaultPrevented || hasResult || hasRetVal ) {
					prevent = true;
					if ( hasResult ) {
						msg = result as string;
					} else if ( hasRetVal ) {
						msg = retVal as string;
					}
				}
			};

			if ( typeof window.onbeforeunload === 'function' ) {
				const unloadEvent = new Event( 'beforeunload', { cancelable: true } ) as Event & { returnValue?: unknown };
				shimReturnValue( unloadEvent );
				const res = window.onbeforeunload( unloadEvent );
				checkPrevent( unloadEvent, res );
			}
			if ( ! prevent ) {
				const dispatchEvent = new Event( 'beforeunload', { cancelable: true } ) as Event & { returnValue?: unknown };
				shimReturnValue( dispatchEvent );
				window.dispatchEvent( dispatchEvent );
				checkPrevent( dispatchEvent, null );
			}
			try {
				const reply: Record< string, unknown > = {
					type: 'os-bridge-beforeunload-response',
					prevent,
					message: msg,
				};
				if (
					typeof data.requestId === 'string' &&
					data.requestId !== ''
				) {
					reply.requestId = data.requestId;
				}
				window.parent.postMessage( reply, parentOrigin );
			} catch {

			}
			return;
		}

		if (
			data.type === 'os-bridge-publish' &&
			typeof data.topic === 'string'
		) {
			const meta = {
				topic: data.topic,
				connectionId: data.connectionId,
			};
			const bucket = subs[ data.topic ];
			if ( bucket ) {
				for ( const cb of bucket ) {
					try {
						cb( data.payload, meta );
					} catch {

					}
				}
			}
			const wildcard = subs[ '*' ];
			if ( wildcard ) {
				for ( const cb of wildcard ) {
					try {
						cb( data.payload, meta );
					} catch {

					}
				}
			}
			return;
		}

		if (
			data.type === 'os-bridge-disconnect' &&
			typeof data.connectionId === 'string'
		) {
			delete connections[ data.connectionId ];
		}

		if (
			data.type === 'os-window-send' &&
			typeof ( data as { channel?: unknown } ).channel === 'string'
		) {
			const d = data as { channel: string; payload?: unknown };
			const meta = { channel: d.channel };
			const bucket = channelSubs[ d.channel ];
			if ( bucket ) {
				for ( const cb of bucket.slice() ) {
					try {
						cb( d.payload, meta );
					} catch {

					}
				}
			}
			const wildcard = channelSubs[ '*' ];
			if ( wildcard ) {
				for ( const cb of wildcard.slice() ) {
					try {
						cb( d.payload, meta );
					} catch {

					}
				}
			}
		}
	} );

	const iframeApi: IframeApi = {
		publish( topic, payload ) {
			if ( typeof topic !== 'string' || topic === '' ) {
				return;
			}
			const ids = Object.keys( connections );
			if ( ids.length === 0 ) {
				console.warn(
					'[openstation] wp.os.iframe.publish dropped: no open connection for topic "%s". The parent shell must call `wp.os.connect(windowId)` first.',
					topic,
				);
				return;
			}
			for ( const id of ids ) {
				emitToParent( id, topic, payload );
			}
		},
		subscribe( topic, cb ) {
			if (
				typeof topic !== 'string' ||
				topic === '' ||
				typeof cb !== 'function'
			) {
				return () => {};
			}
			let bucket = subs[ topic ];
			if ( ! bucket ) {
				bucket = [];
				subs[ topic ] = bucket;
			}
			bucket.push( cb );
			return () => {
				const i = bucket!.indexOf( cb );
				if ( i >= 0 ) {
					bucket!.splice( i, 1 );
				}
			};
		},
		onConnection( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => {};
			}
			connectionListeners.push( cb );

			for ( const id of Object.keys( connections ) ) {
				try {
					cb( {
						id: connections[ id ].id,
						topics: connections[ id ].topics.slice(),
					} );
				} catch {

				}
			}
			return () => {
				const i = connectionListeners.indexOf( cb );
				if ( i >= 0 ) {
					connectionListeners.splice( i, 1 );
				}
			};
		},

		chrome: {
			setTheme( tokens ) {
				try {
					window.parent.postMessage(
						{
							type: 'os-chrome-theme',
							tokens: tokens ?? {},
						},
						parentOrigin,
					);
				} catch {

				}
			},
			setControls( config ) {
				try {
					window.parent.postMessage(
						{
							type: 'os-chrome-controls',
							config: config ?? null,
						},
						parentOrigin,
					);
				} catch {

				}
			},
			setSlot( name, html ) {
				if ( typeof name !== 'string' || name === '' ) {
					return;
				}
				try {
					window.parent.postMessage(
						{
							type: 'os-chrome-slot',
							slot: name,
							html: typeof html === 'string' ? html : '',
						},
						parentOrigin,
					);
				} catch {

				}
			},
		},
		requestConnection( opts ) {
			const o = opts ?? {};
			const topics = Array.isArray( o.topics ) ? o.topics.slice() : [];
			const requestId =
				'wpdir-' + Math.random().toString( 36 ).slice( 2, 10 );

			return new Promise< ConnectionRecord >( ( resolve, reject ) => {
				let settled = false;
				const timeoutMs =
					typeof o.timeoutMs === 'number' ? o.timeoutMs : 5000;

				const settle = (
					ok: boolean,
					value: ConnectionRecord | Error,
				): void => {
					if ( settled ) {
						return;
					}
					settled = true;
					window.removeEventListener( 'message', onAck );
					clearTimeout( timer );
					if ( ok ) {
						resolve( value as ConnectionRecord );
					} else {
						reject( value );
					}
				};

				const onAck = ( ev: MessageEvent ): void => {
					if ( ev.origin !== parentOrigin ) {
						return;
					}
					const d = ev?.data as
						| {
								type?: string;
								requestId?: string;
								accepted?: boolean;
								connectionId?: string;
								reason?: string;
							}
						| null;
					if (
						! d ||
						typeof d !== 'object' ||
						d.type !== 'os-bridge-connection-ack' ||
						d.requestId !== requestId
					) {
						return;
					}
					if ( d.accepted ) {
						const summary: ConnectionRecord = {
							id:
								typeof d.connectionId === 'string'
									? d.connectionId
									: '',
							topics: topics.slice(),
						};
						if ( typeof o.onOpen === 'function' ) {
							try {
								o.onOpen( summary );
							} catch {

							}
						}
						settle( true, summary );
					} else {
						settle( false, new Error( d.reason || 'rejected' ) );
					}
				};
				window.addEventListener( 'message', onAck );

				const timer = setTimeout( () => {
					settle( false, new Error( 'timeout' ) );
				}, timeoutMs );

				try {
					window.parent.postMessage(
						{
							type: 'os-bridge-connection-request',
							requestId,
							topics,
						},
						parentOrigin,
					);
				} catch ( err ) {
					settle( false, err as Error );
				}
			} );
		},
		get windowId() {
			return _windowId;
		},
		whenWindowId(): Promise< string > {
			if ( _windowId !== null ) {
				return Promise.resolve( _windowId );
			}
			return new Promise< string >( ( resolve ) => {
				_windowIdWaiters.push( resolve );
			} );
		},
		isParentReachable(): boolean {
			if ( ! window.parent || window.parent === window ) {
				return false;
			}
			try {
				const parentOrig = window.parent.location.origin;
				return parentOrig === parentOrigin;
			} catch {
				return false;
			}
		},
	};

	if ( ! w.wp ) {
		w.wp = {};
	}
	if ( ! w.wp.os ) {
		w.wp.os = {};
	}
	w.wp.os.iframe = iframeApi;

	if ( typeof w.wp.os.send !== 'function' ) {
		w.wp.os.send = ( channel: string, payload?: unknown ): void => {
			if ( typeof channel !== 'string' || channel === '' ) {
				return;
			}
			try {
				window.parent.postMessage(
					{
						type: 'os-window-publish',
						channel,
						payload,
					},
					parentOrigin,
				);
			} catch {

			}
		};
	}
	if ( typeof w.wp.os.on !== 'function' ) {
		w.wp.os.on = (
			channel: string,
			cb: WindowChannelCb,
		): () => void => {
			if (
				typeof channel !== 'string' ||
				channel === '' ||
				typeof cb !== 'function'
			) {
				return () => undefined;
			}
			let bucket = channelSubs[ channel ];
			if ( ! bucket ) {
				bucket = [];
				channelSubs[ channel ] = bucket;
			}
			bucket.push( cb );
			return () => {
				const i = bucket!.indexOf( cb );
				if ( i >= 0 ) {
					bucket!.splice( i, 1 );
				}
			};
		};
	}

	const sentinelHost = window as unknown as {
		__openStationScreenMetaInstalled?: boolean;
		__openStationOsFileDropForwarderInstalled?: boolean;
		__openStationDragHoverForwarderInstalled?: boolean;
		__openStationPointerForwarderInstalled?: boolean;
	};
	if ( ! sentinelHost.__openStationScreenMetaInstalled ) {
		sentinelHost.__openStationScreenMetaInstalled = true;
		installScreenMetaHoist( parentOrigin );
	}

	if ( ! sentinelHost.__openStationOsFileDropForwarderInstalled ) {
		sentinelHost.__openStationOsFileDropForwarderInstalled = true;
		const hasFiles = ( ev: DragEvent ): boolean => {
			const types = ev.dataTransfer?.types;
			if ( ! types ) {
				return false;
			}
			const list = types as unknown as {
				includes?: ( s: string ) => boolean;
				contains?: ( s: string ) => boolean;
				length: number;
				[ i: number ]: string;
			};
			if ( typeof list.includes === 'function' ) {
				return list.includes( 'Files' );
			}
			if ( typeof list.contains === 'function' ) {
				return list.contains( 'Files' );
			}
			for ( let i = 0; i < list.length; i++ ) {
				if ( list[ i ] === 'Files' ) {
					return true;
				}
			}
			return false;
		};
		const dropPassthroughSelectors = [
			'.components-drop-zone',
			'[data-drop-zone]',
			'.uploader-window',
			'.media-frame-content',
		];
		const targetWantsFile = ( target: EventTarget | null ): boolean => {
			const el = target as Element | null;
			if ( ! el || ! el.closest ) {
				return false;
			}
			for ( const sel of dropPassthroughSelectors ) {
				if ( el.closest( sel ) ) {
					return true;
				}
			}
			return false;
		};

		const nativeFileInputFor = (
			target: EventTarget | null,
		): HTMLInputElement | null => {
			const el = target as Element | null;
			if ( ! el || ! el.closest ) {
				return null;
			}
			let input = el.closest< HTMLInputElement >( 'input[type="file"]' );
			if ( ! input ) {
				const form = el.closest( 'form.wp-upload-form' );
				if ( ! form ) {
					return null;
				}
				const inputs = form.querySelectorAll< HTMLInputElement >(
					'input[type="file"]',
				);
				if ( inputs.length !== 1 ) {
					return null;
				}
				input = inputs[ 0 ];
			}
			if ( input.disabled ) {
				return null;
			}
			if (
				typeof input.getClientRects === 'function' &&
				input.getClientRects().length === 0
			) {
				return null;
			}
			return input;
		};

		const handFilesToInput = (
			input: HTMLInputElement,
			list: FileList,
		): boolean => {
			if ( list.length === 0 ) {
				return false;
			}
			try {
				let picked = list;
				if (
					list.length > 1 &&
					! input.multiple &&
					typeof DataTransfer === 'function'
				) {
					const dt = new DataTransfer();
					dt.items.add( list[ 0 ] );
					picked = dt.files;
				}
				input.files = picked;
			} catch {
				return false;
			}
			input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
			return true;
		};

		const dropZoneAttr = 'data-os-file-drop-active';
		let dropZone: Element | null = null;
		let dropZoneWatchdog: ReturnType< typeof setTimeout > | null = null;
		const clearDropZone = (): void => {
			if ( dropZone ) {
				dropZone.removeAttribute( dropZoneAttr );
				dropZone = null;
			}
			if ( dropZoneWatchdog !== null ) {
				clearTimeout( dropZoneWatchdog );
				dropZoneWatchdog = null;
			}
		};
		const markDropZone = ( input: HTMLInputElement | null ): void => {
			const zone: Element | null = input
				? input.closest( 'form.wp-upload-form' ) ?? input
				: null;
			if ( zone !== dropZone ) {
				dropZone?.removeAttribute( dropZoneAttr );
				dropZone = zone;
				zone?.setAttribute( dropZoneAttr, '' );
			}
			if ( dropZoneWatchdog !== null ) {
				clearTimeout( dropZoneWatchdog );
				dropZoneWatchdog = null;
			}
			if ( zone ) {
				dropZoneWatchdog = setTimeout( clearDropZone, 250 );
			}
		};

		document.addEventListener(
			'dragover',
			( ev: DragEvent ) => {
				if ( ! hasFiles( ev ) ) {
					return;
				}
				if ( targetWantsFile( ev.target ) ) {
					return;
				}
				if ( ev.defaultPrevented ) {
					return;
				}
				markDropZone( nativeFileInputFor( ev.target ) );
				ev.preventDefault();
				if ( ev.dataTransfer ) {
					ev.dataTransfer.dropEffect = 'copy';
				}
			},
			false,
		);
		document.addEventListener(
			'drop',
			( ev: DragEvent ) => {
				if ( ! hasFiles( ev ) ) {
					return;
				}
				clearDropZone();
				if ( targetWantsFile( ev.target ) ) {
					return;
				}
				if ( ev.defaultPrevented ) {
					return;
				}
				const input = nativeFileInputFor( ev.target );
				if ( input && ev.dataTransfer?.files ) {
					if ( handFilesToInput( input, ev.dataTransfer.files ) ) {
						ev.preventDefault();
						ev.stopPropagation();
						return;
					}
					if ( ev.target === input ) {
						return;
					}
				}
				ev.preventDefault();
				ev.stopPropagation();
				const files: File[] = [];
				if ( ev.dataTransfer?.files ) {
					for ( let i = 0; i < ev.dataTransfer.files.length; i++ ) {
						files.push( ev.dataTransfer.files[ i ] );
					}
				}
				if ( files.length === 0 ) {
					return;
				}
				try {
					window.parent.postMessage(
						{
							type: 'os-file-drop',
							files,
							x: ev.clientX,
							y: ev.clientY,
						},
						parentOrigin,
					);
				} catch {

				}
			},
			false,
		);
	}

	if ( ! sentinelHost.__openStationDragHoverForwarderInstalled ) {
		sentinelHost.__openStationDragHoverForwarderInstalled = true;
		const hoverHasFiles = ( ev: DragEvent ): boolean => {
			const types = ev.dataTransfer?.types;
			if ( ! types ) {
				return false;
			}
			const list = types as unknown as {
				includes?: ( s: string ) => boolean;
				contains?: ( s: string ) => boolean;
			};
			if ( typeof list.includes === 'function' ) {
				return list.includes( 'Files' );
			}
			return typeof list.contains === 'function' && list.contains( 'Files' );
		};
		let dragHoverLastSent = 0;
		document.addEventListener(
			'dragover',
			( ev: DragEvent ) => {
				const now = Date.now();
				if ( now - dragHoverLastSent < 150 ) {
					return;
				}
				dragHoverLastSent = now;
				try {
					window.parent.postMessage(
						{
							type: 'os-drag-hover',
							payloadType: hoverHasFiles( ev ) ? 'os-file' : 'external',
						},
						parentOrigin,
					);
				} catch {

				}
			},
			true,
		);
	}

	if ( ! sentinelHost.__openStationPointerForwarderInstalled ) {
		sentinelHost.__openStationPointerForwarderInstalled = true;
		let pointerTrackOn = false;
		let pointerLastSent = 0;
		window.addEventListener( 'message', ( e: MessageEvent ) => {
			if ( e.origin !== window.location.origin ) {
				return;
			}
			const data = e.data as { type?: string; enabled?: unknown } | null;
			if ( ! data || data.type !== 'os-pointer-track' ) {
				return;
			}
			pointerTrackOn = data.enabled === true;
		} );
		document.addEventListener(
			'pointermove',
			( ev: PointerEvent ) => {
				if ( ! pointerTrackOn ) {
					return;
				}
				const now = Date.now();

				if ( now - pointerLastSent < 40 ) {
					return;
				}
				pointerLastSent = now;
				try {
					window.parent.postMessage(
						{
							type: 'os-pointer-move',
							x: ev.clientX,
							y: ev.clientY,
						},
						parentOrigin,
					);
				} catch {

				}
			},
			{ capture: true, passive: true },
		);
	}

	try {
		window.addEventListener( 'pagehide', () => {
			try {
				if ( window.parent && window.parent !== window ) {
					window.parent.postMessage(
						{ type: 'os-iframe-unloading' },
						parentOrigin,
					);
				}
			} catch {

			}
		} );
	} catch {

	}

	try {
		if ( window.parent && window.parent !== window ) {
			window.parent.postMessage(
				{ type: 'os-ready' },
				parentOrigin,
			);
		}
	} catch {

	}

	function installScreenMetaHoist( origin: string ): void {
		const hasScreenOptionsContent = (): boolean => {
			const wrap = document.getElementById( 'screen-options-wrap' );

			return (
				!! wrap &&
				!! wrap.querySelector(
					'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea',
				)
			);
		};

		const hasHelpContent = (): boolean => {
			const wrap = document.getElementById( 'contextual-help-wrap' );
			if ( ! wrap ) {
				return false;
			}
			const panelEls = wrap.querySelectorAll(
				'.help-tab-content, .contextual-help-sidebar',
			);
			for ( let i = 0; i < panelEls.length; i++ ) {
				if ( ( panelEls[ i ].textContent || '' ).trim() !== '' ) {
					return true;
				}
			}
			return false;
		};

		const start = (): void => {
			const links = document.getElementById( 'screen-meta-links' );
			const screenOptionsBtn = links
				? document.getElementById( 'show-settings-link' )
				: null;
			const helpBtn = links
				? document.getElementById( 'contextual-help-link' )
				: null;
			const panels: string[] = [];
			if ( screenOptionsBtn && hasScreenOptionsContent() ) {
				panels.push( 'screen-options' );
			}
			if ( helpBtn && hasHelpContent() ) {
				panels.push( 'help' );
			}

			try {
				window.parent.postMessage(
					{ type: 'os-screen-meta', panels },
					origin,
				);
			} catch {

			}

			if ( panels.length === 0 ) {
				return;
			}

			const getOpenPanel = (): 'screen-options' | 'help' | null => {
				if (
					screenOptionsBtn &&
					screenOptionsBtn.getAttribute( 'aria-expanded' ) === 'true'
				) {
					return 'screen-options';
				}
				if (
					helpBtn &&
					helpBtn.getAttribute( 'aria-expanded' ) === 'true'
				) {
					return 'help';
				}
				return null;
			};
			const reportState = (): void => {
				try {
					window.parent.postMessage(
						{
							type: 'os-screen-meta-state',
							open: getOpenPanel(),
						},
						origin,
					);
				} catch {

				}
			};
			reportState();

			const observer = new MutationObserver( reportState );
			if ( screenOptionsBtn ) {
				observer.observe( screenOptionsBtn, {
					attributes: true,
					attributeFilter: [ 'aria-expanded' ],
				} );
			}
			if ( helpBtn ) {
				observer.observe( helpBtn, {
					attributes: true,
					attributeFilter: [ 'aria-expanded' ],
				} );
			}

			const forceClose = ( button: HTMLElement | null ): void => {
				if ( ! button || button.getAttribute( 'aria-expanded' ) !== 'true' ) {
					return;
				}
				const panelId = button.getAttribute( 'aria-controls' );
				const panel = panelId ? document.getElementById( panelId ) : null;
				if ( ! panel ) {
					return;
				}
				const jq = ( window as unknown as {
					jQuery?: ( el: HTMLElement ) => { stop: ( c: boolean, j: boolean ) => unknown };
				} ).jQuery;
				if ( jq ) {
					try {
						jq( panel ).stop( true, false );
					} catch {

					}
				}
				panel.style.display = 'none';
				panel.classList.add( 'hidden' );
				if ( panel.parentElement ) {
					panel.parentElement.style.display = 'none';
				}
				button.classList.remove( 'screen-meta-active' );
				button.setAttribute( 'aria-expanded', 'false' );
				const toggles = document.querySelectorAll< HTMLElement >(
					'.screen-meta-toggle',
				);
				toggles.forEach( ( t ) => {
					t.style.visibility = '';
				} );
			};

			window.addEventListener( 'message', ( e: MessageEvent ) => {
				if ( e.origin !== origin ) {
					return;
				}
				const d = e.data as { type?: string; panel?: string } | null;
				if ( ! d || d.type !== 'os-toggle-panel' ) {
					return;
				}
				let target: HTMLElement | null = null;
				if ( d.panel === 'screen-options' && screenOptionsBtn ) {
					target = screenOptionsBtn;
				} else if ( d.panel === 'help' && helpBtn ) {
					target = helpBtn;
				}
				if ( ! target ) {
					return;
				}
				if ( target.getAttribute( 'aria-expanded' ) !== 'true' ) {
					forceClose(
						target === screenOptionsBtn ? helpBtn : screenOptionsBtn,
					);
				}
				target.click();
			} );
		};

		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', start, { once: true } );
		} else {
			start();
		}
	}
}() );
