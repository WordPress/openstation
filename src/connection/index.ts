import { applyFilters, doAction, HOOKS } from './../hooks';
import type { WindowManager } from './../window-manager';
import {
	addParentSubscriber,
	dispatchToNative,
	type WindowChannelCb,
} from './../window-channels';
import { createSharedStore } from './../shared-store';

const INITIAL_ORIGIN = window.location.origin;

export interface ConnectOptions {

	topics?: string[];

	onOpen?: () => void;

	onClose?: ( reason: 'disconnect' | 'window-closed' | 'navigated' ) => void;
}

export interface WindowConnection {

	readonly id: string;

	readonly target: string;

	isOpen(): boolean;

	subscribe< T = unknown >(
		topic: string,
		cb: ( payload: T, meta: { topic: string } ) => void,
	): () => void;

	send< T = unknown >( topic: string, payload: T ): void;

	disconnect(): void;
}

interface InternalConnection extends WindowConnection {
	_targetWindow: () => HTMLIFrameElement | null;
	_handleIframeMessage( data: unknown ): void;
	_destroy( reason: 'disconnect' | 'window-closed' | 'navigated' ): void;
}

interface ConnectionState {
	connSeq: number;
	connections: Map< string, InternalConnection >;
	connectionsByTarget: Map< string, Set< string > >;

	syntheticIframes: Map< string, HTMLIFrameElement >;
}

const connectionStore = createSharedStore< ConnectionState >(
	'desktop-mode/connection',
	() => ( {
		connSeq: 0,
		connections: new Map(),
		connectionsByTarget: new Map(),
		syntheticIframes: new Map(),
	} ),
);

export function registerSyntheticIframe(
	windowId: string,
	iframe: HTMLIFrameElement,
): () => void {
	const { syntheticIframes } = connectionStore.state;
	syntheticIframes.set( windowId, iframe );
	return () => {
		if ( syntheticIframes.get( windowId ) === iframe ) {
			syntheticIframes.delete( windowId );
		}
	};
}

export function getSyntheticIframe(
	windowId: string,
): HTMLIFrameElement | null {
	return connectionStore.state.syntheticIframes.get( windowId ) ?? null;
}

function nextId(): string {
	return `os-conn-${ ++connectionStore.state.connSeq }`;
}

export function createConnectionBridge( manager: WindowManager ) {
	const sendToIframe = (
		win: HTMLIFrameElement,
		message: unknown,
	): void => {
		try {
			win.contentWindow?.postMessage( message, INITIAL_ORIGIN );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] connection: postMessage failed',
					err,
				);
			}
		}
	};

	const connect = (
		targetWindowId: string,
		opts: ConnectOptions = {},
	): WindowConnection => {
		const id = nextId();
		const topics = Array.isArray( opts.topics ) ? [ ...opts.topics ] : [];
		const subs = new Map< string, Set<( payload: unknown, meta: { topic: string } ) => void > >();
		const queue: { topic: string; payload: unknown }[] = [];
		let isOpen = false;
		let destroyed = false;

		const targetIframe = (): HTMLIFrameElement | null => {
			const synth = connectionStore.state.syntheticIframes.get( targetWindowId );
			if ( synth ) {
				return synth;
			}
			const w = manager.getById( targetWindowId );
			return w?.iframe ?? null;
		};

		const isNativeTarget = (): boolean => {
			if ( targetIframe() ) {
				return false;
			}
			const w = manager.getById( targetWindowId );
			return !! w && w.config?.native === true;
		};

		const nativeSubUnsubs: Array< () => void > = [];

		const flushQueue = (): void => {
			const iframe = targetIframe();
			if ( ! iframe ) {
				return;
			}
			while ( queue.length ) {
				const msg = queue.shift()!;
				sendToIframe( iframe, {
					type: 'os-bridge-publish',
					connectionId: id,
					topic: msg.topic,
					payload: msg.payload,
				} );
			}
		};

		const conn: InternalConnection = {
			id,
			target: targetWindowId,
			isOpen: () => isOpen,
			subscribe( topic, cb ) {
				const wrapped = cb as ( p: unknown, m: { topic: string } ) => void;

				if ( isNativeTarget() ) {
					const off = addParentSubscriber(
						targetWindowId,
						topic,
						( ( payload: unknown, meta ) => {
							doAction( HOOKS.CONNECTION_MESSAGE, {
								connectionId: id,
								topic: meta.channel,
								direction: 'in',
							} );
							try {
								wrapped( payload, { topic: meta.channel } );
							} catch ( err ) {
								if ( typeof console !== 'undefined' ) {
									console.error(
										'[openstation] connection subscriber threw:',
										err,
									);
								}
							}
						} ) as WindowChannelCb,
					);
					nativeSubUnsubs.push( off );
					return off;
				}
				let bucket = subs.get( topic );
				if ( ! bucket ) {
					bucket = new Set();
					subs.set( topic, bucket );
				}
				bucket.add( wrapped );
				return () => {
					bucket?.delete( wrapped );
				};
			},
			send( topic, payload ) {
				if ( destroyed ) {
					return;
				}
				doAction( HOOKS.CONNECTION_MESSAGE, {
					connectionId: id,
					topic,
					direction: 'out',
				} );

				if ( isNativeTarget() ) {
					dispatchToNative( targetWindowId, topic, payload );
					return;
				}
				if ( ! isOpen ) {
					queue.push( { topic, payload } );
					return;
				}
				const iframe = targetIframe();
				if ( ! iframe ) {
					return;
				}
				sendToIframe( iframe, {
					type: 'os-bridge-publish',
					connectionId: id,
					topic,
					payload,
				} );
			},
			disconnect() {
				conn._destroy( 'disconnect' );
			},
			_targetWindow: targetIframe,
			_handleIframeMessage( data ) {
				if ( ! data || typeof data !== 'object' ) {
					return;
				}
				const msg = data as { type?: string };
				if ( msg.type === 'os-bridge-handshake-ack' ) {
					if ( isOpen ) {
						return;
					}
					isOpen = true;
					doAction( HOOKS.CONNECTION_OPENED, {
						connectionId: id,
						targetWindowId,
						topics,

						connection: conn,
					} );
					try {
						opts.onOpen?.();
					} catch ( err ) {
						if ( typeof console !== 'undefined' ) {
							console.error(
								'[openstation] connection.onOpen threw:',
								err,
							);
						}
					}
					flushQueue();
					return;
				}
				if ( msg.type === 'os-bridge-publish' ) {
					const m = data as {
						topic?: string;
						payload?: unknown;
					};
					const topic = typeof m.topic === 'string' ? m.topic : '';
					if ( ! topic ) {
						return;
					}
					doAction( HOOKS.CONNECTION_MESSAGE, {
						connectionId: id,
						topic,
						direction: 'in',
					} );
					const exact = subs.get( topic );
					if ( exact ) {
						for ( const cb of Array.from( exact ) ) {
							try {
								cb( m.payload, { topic } );
							} catch ( err ) {
								if ( typeof console !== 'undefined' ) {
									console.error(
										'[openstation] connection subscriber threw:',
										err,
									);
								}
							}
						}
					}
					const wildcard = subs.get( '*' );
					if ( wildcard ) {
						for ( const cb of Array.from( wildcard ) ) {
							try {
								cb( m.payload, { topic } );
							} catch ( err ) {
								if ( typeof console !== 'undefined' ) {
									console.error(
										'[openstation] connection wildcard subscriber threw:',
										err,
									);
								}
							}
						}
					}
					return;
				}
				if ( msg.type === 'os-bridge-disconnect' ) {
					conn._destroy( 'disconnect' );
				}
			},
			_destroy( reason ) {
				if ( destroyed ) {
					return;
				}
				destroyed = true;
				const wasOpen = isOpen;
				isOpen = false;
				connectionStore.state.connections.delete( id );
				const targetSet = connectionStore.state.connectionsByTarget.get( targetWindowId );
				if ( targetSet ) {
					targetSet.delete( id );
					if ( targetSet.size === 0 ) {
						connectionStore.state.connectionsByTarget.delete( targetWindowId );
					}
				}

				for ( const off of nativeSubUnsubs.splice( 0 ) ) {
					try {
						off();
					} catch {

					}
				}

				if ( wasOpen ) {
					const iframe = targetIframe();
					if ( iframe ) {
						sendToIframe( iframe, {
							type: 'os-bridge-disconnect',
							connectionId: id,
						} );
					}
				}
				doAction( HOOKS.CONNECTION_CLOSED, {
					connectionId: id,
					reason,
				} );
				try {
					opts.onClose?.( reason );
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[openstation] connection.onClose threw:',
							err,
						);
					}
				}
			},
		};

		connectionStore.state.connections.set( id, conn );
		let bucket = connectionStore.state.connectionsByTarget.get( targetWindowId );
		if ( ! bucket ) {
			bucket = new Set();
			connectionStore.state.connectionsByTarget.set( targetWindowId, bucket );
		}
		bucket.add( id );

		if ( isNativeTarget() ) {
			Promise.resolve().then( () => {
				if ( destroyed || isOpen ) {
					return;
				}
				isOpen = true;
				doAction( HOOKS.CONNECTION_OPENED, {
					connectionId: id,
					targetWindowId,
					topics,
				} );
				try {
					opts.onOpen?.();
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[openstation] connection.onOpen threw:',
							err,
						);
					}
				}
			} );
			return conn;
		}

		const iframe = targetIframe();
		if ( iframe ) {
			sendToIframe( iframe, {
				type: 'os-bridge-handshake',
				connectionId: id,
				targetWindowId,
				topics,
			} );
		}

		return conn;
	};

	const routeIncomingFromIframe = ( data: unknown, windowId?: string ): void => {
		if ( ! data || typeof data !== 'object' ) {
			return;
		}
		const msg = data as {
			type?: string;
			connectionId?: string;
			requestId?: string;
			topics?: unknown;
		};
		if ( typeof msg.type !== 'string' || ! msg.type.startsWith( 'os-bridge-' ) ) {
			return;
		}

		if (
			msg.type === 'os-bridge-connection-request' &&
			typeof msg.requestId === 'string' &&
			typeof windowId === 'string' &&
			windowId !== ''
		) {
			handleConnectionRequest( windowId, msg.requestId, Array.isArray( msg.topics ) ? ( msg.topics as string[] ) : [] );
			return;
		}

		if ( typeof msg.connectionId !== 'string' ) {
			return;
		}
		const conn = connectionStore.state.connections.get( msg.connectionId );
		conn?._handleIframeMessage( data );
	};

	const handleConnectionRequest = (
		windowId: string,
		requestId: string,
		topics: string[],
	): void => {
		const synth = connectionStore.state.syntheticIframes.get( windowId );
		const iframe = synth ?? manager.getById( windowId )?.iframe ?? null;
		if ( ! iframe ) {
			return;
		}

		const decision: unknown = applyFilters(
			HOOKS.IFRAME_CONNECTION_REQUEST,
			true as boolean | { topics: string[] },
			{ windowId, requestId, topics: topics.slice() },
		);

		if ( decision === false ) {
			try {
				iframe.contentWindow?.postMessage( {
					type: 'os-bridge-connection-ack',
					requestId,
					accepted: false,
					reason: 'rejected',
				}, INITIAL_ORIGIN );
			} catch { }
			return;
		}

		const finalTopics = decision && typeof decision === 'object' && Array.isArray( ( decision as { topics?: unknown } ).topics )
			? ( decision as { topics: string[] } ).topics
			: topics;

		const conn = connect( windowId, { topics: finalTopics } );

		try {
			iframe.contentWindow?.postMessage( {
				type: 'os-bridge-connection-ack',
				requestId,
				accepted: true,
				connectionId: conn.id,
			}, INITIAL_ORIGIN );
		} catch { }
	};

	const onIframeReady = ( windowId: string ): void => {
		const bucket = connectionStore.state.connectionsByTarget.get( windowId );
		if ( ! bucket ) {
			return;
		}
		for ( const connId of Array.from( bucket ) ) {
			const conn = connectionStore.state.connections.get( connId );
			if ( ! conn || conn.isOpen() ) {
				continue;
			}
			const iframe = conn._targetWindow();
			if ( ! iframe ) {
				continue;
			}
			sendToIframe( iframe, {
				type: 'os-bridge-handshake',
				connectionId: conn.id,
				targetWindowId: conn.target,
				topics: [],
			} );
		}
	};

	const onWindowClosed = ( windowId: string ): void => {
		const bucket = connectionStore.state.connectionsByTarget.get( windowId );
		if ( ! bucket ) {
			return;
		}
		for ( const connId of Array.from( bucket ) ) {
			const conn = connectionStore.state.connections.get( connId );
			conn?._destroy( 'window-closed' );
		}
	};

	const getConnection = (
		connectionId: string,
	): WindowConnection | null => {
		const conn = connectionStore.state.connections.get( connectionId );
		return conn ?? null;
	};

	return {
		connect,
		getConnection,
		routeIncomingFromIframe,
		onIframeReady,
		onWindowClosed,
	};
}
