import { activity } from './activity';
import { HOOKS, addAction, doAction, removeAction } from './hooks';
import { isMobileStamped } from './mode/stamp';
import { injectInlineScript, loadVendorScript } from './wallpapers/vendor-loader';
import { registerSyntheticIframe } from './connection';
import { isShellDocumentUrl } from './shell-url';
import {
	registerNativeUrlRemap,
	unregisterNativeUrlRemap,
} from './native-url-remap';
import { setPanelTabs } from './window/tab-strip';
import {
	loadNativeWindowGeometry,
	saveNativeWindowGeometry,
	saveNativeWindowPosition,
	setNativeWindowSavedState,
} from './window-manager/native-window-geometry';
import type { SystemDockItem } from './dock';
import type {
	NativeRenderContext,
	LazyScriptDependency,
	NativeWindowCompanionScript,
	NativeWindowDef,
	NativeWindowIframeContent,
	NativeWindowScriptData,
	NativeWindowServerEntry,
	NativeWindowTabEntry,
	NativeWindowWireEntry,
	WindowConfig,
} from './types';
import type { WindowManager } from './window-manager';
import type { Window as DesktopWindow } from './window';
import {
	addNativeSubscriber,
	dispatchFromWindow,
	markWindowContentLoading,
	markWindowContentReady,
	type WindowChannelCb,
} from './window-channels';

export interface WindowLifecycleHandlers {
	opened?: () => void;

	reopened?: ( payload: {
		baseId: string;
		wasMinimized: boolean;
		navigated?: boolean;
	} ) => void;
	focused?: () => void;

	blurred?: ( payload: { focusedTo: string | null } ) => void;
	closing?: ( payload: { element: HTMLElement } ) => void;
	closed?: () => void;
	minimized?: () => void;
	restored?: () => void;
	maximized?: () => void;

	unmaximized?: () => void;

	fullscreenEntered?: () => void;

	fullscreenExited?: () => void;
	resized?: ( payload: { width: number; height: number } ) => void;

	bodyResized?: ( payload: { width: number; height: number } ) => void;

	boundsChanged?: ( payload: {
		x: number;
		y: number;
		width: number;
		height: number;
	} ) => void;
}

const DEFAULT_NATIVE_MIN_WIDTH = 280;
const DEFAULT_NATIVE_MIN_HEIGHT = 220;
const DEFAULT_NATIVE_WIDTH = 520;
const DEFAULT_NATIVE_HEIGHT = 400;

let _ctxInstance = 0;

function buildNativeRenderContext(
	windowId: string,
	params: Record< string, string | number | boolean > = {},
): {
	ctx: NativeRenderContext;
	dispose: () => void;
} {
	const instance = ++_ctxInstance;
	const ns = ( label: string ): string =>
		`desktop-mode/native-render-ctx/${ windowId }/${ instance }/${ label }`;

	const controller = new AbortController();
	const teardowns: Array< () => void > = [];

	const subscribeWindowed = (
		hookName: string,
		label: string,
		match: ( payload: unknown ) => boolean,
		invoke: ( payload: unknown ) => void,
	): ( () => void ) => {
		const namespace = ns( label );
		addAction( hookName, namespace, ( payload: unknown ) => {
			if ( match( payload ) ) {
				invoke( payload );
			}
		} );
		const off = (): void => {
			removeAction( hookName, namespace );
		};
		teardowns.push( off );
		return off;
	};

	const matchByWindowId = ( payload: unknown ): boolean =>
		!! payload &&
		typeof payload === 'object' &&
		( payload as { windowId?: string } ).windowId === windowId;

	const ctx: NativeRenderContext = {
		window: {
			send< T = unknown >( channel: string, payload?: T ): void {
				if ( typeof channel !== 'string' || channel === '' ) {
					return;
				}
				dispatchFromWindow( windowId, channel, payload );
			},
			on< T = unknown >(
				channel: string,
				cb: (
					payload: T,
					meta: { channel: string; windowId: string },
				) => void,
			): () => void {
				if (
					typeof channel !== 'string' ||
					channel === '' ||
					typeof cb !== 'function'
				) {
					return () => undefined;
				}
				return addNativeSubscriber(
					windowId,
					channel,
					cb as WindowChannelCb,
				);
			},
			markLoading(): void {
				markWindowContentLoading( windowId );
			},
			markReady(): void {
				markWindowContentReady( windowId );
			},
		},
		markLoading(): void {
			markWindowContentLoading( windowId );
		},
		markReady(): void {
			markWindowContentReady( windowId );
		},
		signal: controller.signal,
		onResize( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => undefined;
			}
			return subscribeWindowed(
				HOOKS.WINDOW_BODY_RESIZED,
				'on-resize',
				matchByWindowId,
				( payload ) => {
					const { width, height } = payload as {
						width: number;
						height: number;
					};
					try {
						cb( width, height );
					} catch ( err ) {
						doAction( HOOKS.SHELL_ERROR, {
							scope: 'native-render-ctx/onResize',
							id: windowId,
							error: err,
						} );
					}
				},
			);
		},
		onHide( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => undefined;
			}
			return subscribeWindowed(
				HOOKS.WINDOW_MINIMIZED,
				'on-hide',
				matchByWindowId,
				() => {
					try {
						cb();
					} catch ( err ) {
						doAction( HOOKS.SHELL_ERROR, {
							scope: 'native-render-ctx/onHide',
							id: windowId,
							error: err,
						} );
					}
				},
			);
		},
		onShow( cb ) {
			if ( typeof cb !== 'function' ) {
				return () => undefined;
			}
			return subscribeWindowed(
				HOOKS.WINDOW_RESTORED,
				'on-show',
				matchByWindowId,
				() => {
					try {
						cb();
					} catch ( err ) {
						doAction( HOOKS.SHELL_ERROR, {
							scope: 'native-render-ctx/onShow',
							id: windowId,
							error: err,
						} );
					}
				},
			);
		},
		params,
	};

	const dispose = (): void => {
		try {
			controller.abort();
		} catch {

		}
		while ( teardowns.length ) {
			const off = teardowns.pop();
			try {
				off?.();
			} catch {

			}
		}
	};

	return { ctx, dispose };
}

export { buildNativeRenderContext as _buildNativeRenderContext };

function resolveMountedWindowId(
	body: HTMLElement,
	fallback: string,
): string {
	const root = body.closest< HTMLElement >( '[id^="wp-window-"]' );
	const id = root?.id.slice( 'wp-window-'.length );
	return id ? id : fallback;
}

function buildIframeContentRender(
	cfg: NativeWindowIframeContent,
	cleanups: ( () => void )[],
	registeredId: string,
): ( body: HTMLElement ) => Promise< void > {
	return ( body: HTMLElement ) => {
		const windowId = resolveMountedWindowId( body, registeredId );
		const iframe = document.createElement( 'iframe' );
		iframe.style.width = '100%';
		iframe.style.height = '100%';
		iframe.style.border = '0';
		iframe.setAttribute( 'src', cfg.url );
		if ( typeof cfg.sandbox === 'string' && cfg.sandbox !== '' ) {
			iframe.setAttribute( 'sandbox', cfg.sandbox );
		}
		body.style.padding = '0';
		body.appendChild( iframe );

		const unregisterSynth = registerSyntheticIframe( windowId, iframe );
		cleanups.push( unregisterSynth );

		let targetOrigin: string;
		try {
			targetOrigin = new URL( cfg.url, window.location.origin ).origin;
		} catch {
			targetOrigin = window.location.origin;
		}

		let resolveReady: ( () => void ) | null = null;
		const readyPromise = new Promise< void >( ( resolve ) => {
			resolveReady = resolve;
		} );
		const onLoad = (): void => {
			if ( cfg.bridge ) {
				try {
					const doc = iframe.contentDocument;
					if ( doc && ! doc.querySelector( 'script[data-os-iframe-bridge]' ) ) {
						const bridgeUrl = (
							window as unknown as {
								openStationConfig?: { iframeBridgeUrl?: string };
							}
						).openStationConfig?.iframeBridgeUrl;
						if ( bridgeUrl ) {
							const s = doc.createElement( 'script' );
							s.src = bridgeUrl;
							s.setAttribute( 'data-os-iframe-bridge', '1' );
							doc.head?.appendChild( s );
						}
					}
				} catch {

				}
			}

			markWindowContentReady( windowId );
			resolveReady?.();
		};
		iframe.addEventListener( 'load', onLoad );

		const onMessage = ( e: MessageEvent ): void => {
			if ( ! iframe.contentWindow || e.source !== iframe.contentWindow ) {
				return;
			}
			if ( e.origin !== targetOrigin && e.origin !== window.location.origin ) {
				return;
			}
			const data = e.data;
			if (
				data &&
				typeof data === 'object' &&
				typeof ( data as { type?: string } ).type === 'string' &&
				( data as { type: string } ).type.startsWith( 'os-bridge-' )
			) {
				const bridgeRouter = (
					window as unknown as {
						__openStationConnectionBridge?: {
							routeIncomingFromIframe(
								d: unknown,
								fromWindowId?: string,
							): void;
						};
					}
				).__openStationConnectionBridge;
				bridgeRouter?.routeIncomingFromIframe( data, windowId );
			}

			if (
				data &&
				typeof data === 'object' &&
				( data as { type?: string } ).type === 'os-window-publish' &&
				typeof ( data as { channel?: string } ).channel === 'string' &&
				( data as { channel: string } ).channel !== ''
			) {
				dispatchFromWindow(
					windowId,
					( data as { channel: string } ).channel,
					( data as { payload?: unknown } ).payload,
				);
			}
			try {
				cfg.onMessage?.( e.data );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] iframeContent.onMessage threw:',
						err,
					);
				}
			}
		};
		window.addEventListener( 'message', onMessage );

		cleanups.push( () => {
			window.removeEventListener( 'message', onMessage );
			iframe.removeEventListener( 'load', onLoad );
		} );

		return readyPromise;
	};
}

export function embedAdminPage(
	host: HTMLElement,
	url: string,
	opts: { windowId?: string } = {},
): () => void {
	let chromeless: string;
	try {
		const parsed = new URL( url, window.location.origin );
		if ( parsed.origin !== window.location.origin ) {
			return () => {};
		}
		if ( isShellDocumentUrl( parsed ) ) {
			return () => {};
		}
		parsed.searchParams.set( 'openstation_chromeless', '1' );
		chromeless = parsed.toString();
	} catch {
		return () => {};
	}

	host.replaceChildren();
	const cleanups: ( () => void )[] = [];
	const windowId = resolveMountedWindowId( host, opts.windowId ?? '' );
	const ready = buildIframeContentRender( { url: chromeless }, cleanups, windowId )(
		host,
	);

	if ( getComputedStyle( host ).position === 'static' ) {
		host.style.position = 'relative';
	}
	const overlay = document.createElement( 'div' );
	overlay.style.position = 'absolute';
	overlay.style.inset = '0';
	overlay.style.display = 'flex';
	overlay.style.alignItems = 'center';
	overlay.style.justifyContent = 'center';
	const spinner = document.createElement( 'os-spinner' );
	spinner.setAttribute( 'preset', 'comet' );
	overlay.appendChild( spinner );
	host.appendChild( overlay );
	void ready.then( () => overlay.remove() );

	return () => {
		for ( const fn of cleanups ) {
			try {
				fn();
			} catch {

			}
		}
		host.replaceChildren();
	};
}

export function createRegisterWindow(
	manager: WindowManager,
): ( def: NativeWindowDef ) => Promise< DesktopWindow > {
	return async ( def: NativeWindowDef ) => {
		const userRender = def.render;
		let render = userRender;
		const cleanups: ( () => void )[] = [];
		if ( def.iframeContent ) {
			if ( userRender && typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] registerWindow: both `render` and `iframeContent` provided — ignoring `render` and using the iframe shorthand. Drop one.',
				);
			}
			render = buildIframeContentRender(
				def.iframeContent,
				cleanups,
				def.id,
			);
		}

		const userOnClose = def.onClose;

		const onClose: typeof userOnClose = def.iframeContent
			? ( () => {
				for ( const fn of cleanups ) {
					try {
						fn();
					} catch {

					}
				}
				userOnClose?.();
			} )
			: userOnClose;

		const win = await manager.open( {
			id: def.id,
			baseId: def.baseId || def.id,
			native: true,
			url: def.url || `#${ def.id }`,
			title: def.title,
			icon: def.icon,
			x: def.x ?? 0,
			y: def.y ?? 0,
			width: def.width ?? DEFAULT_NATIVE_WIDTH,
			height: def.height ?? DEFAULT_NATIVE_HEIGHT,
			minWidth: def.minWidth ?? DEFAULT_NATIVE_MIN_WIDTH,
			minHeight: def.minHeight ?? DEFAULT_NATIVE_MIN_HEIGHT,
			render,
			onClose,
			onResize: def.onResize,
			autofocus: def.autofocus,
			initialState: def.initialState,
			ownerHandle: def.ownerHandle,
			multi: def.multi,
			desktopId: def.desktopId,
		} );

		return win;
	};
}

export interface OnWindowOptions {

	persistent?: boolean;
}

let onWindowInstanceCounter = 0;
export function onWindow(
	id: string,
	handlers: WindowLifecycleHandlers,
	options: OnWindowOptions = {},
): () => void {
	const namespace = `desktop-mode/on-window/${ id }/${ ++onWindowInstanceCounter }`;
	const persistent = options.persistent === true;

	const bindings: Array< [ keyof WindowLifecycleHandlers, string ] > = [
		[ 'opened', HOOKS.WINDOW_OPENED ],
		[ 'reopened', HOOKS.WINDOW_REOPENED ],
		[ 'focused', HOOKS.WINDOW_FOCUSED ],
		[ 'blurred', HOOKS.WINDOW_BLURRED ],
		[ 'closing', HOOKS.WINDOW_CLOSING ],
		[ 'closed', HOOKS.WINDOW_CLOSED ],
		[ 'minimized', HOOKS.WINDOW_MINIMIZED ],
		[ 'restored', HOOKS.WINDOW_RESTORED ],
		[ 'maximized', HOOKS.WINDOW_MAXIMIZED ],
		[ 'unmaximized', HOOKS.WINDOW_UNMAXIMIZED ],
		[ 'fullscreenEntered', HOOKS.WINDOW_FULLSCREEN_ENTERED ],
		[ 'fullscreenExited', HOOKS.WINDOW_FULLSCREEN_EXITED ],
		[ 'resized', HOOKS.WINDOW_RESIZED ],
		[ 'bodyResized', HOOKS.WINDOW_BODY_RESIZED ],
		[ 'boundsChanged', HOOKS.WINDOW_BOUNDS_CHANGED ],
	];

	const registered: string[] = [];
	let disposed = false;

	const unsubscribe = (): void => {
		if ( disposed ) {
			return;
		}
		disposed = true;
		for ( const hookName of registered ) {
			removeAction( hookName, namespace );
		}
	};

	for ( const [ key, hookName ] of bindings ) {
		const handler = handlers[ key ];
		if ( ! handler ) {
			continue;
		}
		registered.push( hookName );
		addAction( hookName, namespace, ( payload: unknown ) => {
			const p = payload as { windowId?: string } & Record< string, unknown >;
			if ( p.windowId !== id ) {
				return;
			}

			const { windowId: _w, ...rest } = p;
			( handler as ( x: unknown ) => void )( rest );

			if ( key === 'closed' && ! persistent ) {
				unsubscribe();
			}
		} );
	}

	return unsubscribe;
}

export interface NativeWindowRegistryDeps {
	manager: WindowManager;

	appendSystemTile: ( item: SystemDockItem ) => void;

	removeSystemTile: ( id: string ) => void;
	desktopArea: HTMLElement;
}

type RenderCallback = (
	body: HTMLElement,
	ctx?: NativeRenderContext,
) => void | ( () => void ) | Promise< void | ( () => void ) >;

interface NativeWindowGlobals {
	openStationNativeWindows?: Record< string, RenderCallback | undefined >;

	wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
}

function readGlobalRegistry(): Record< string, RenderCallback | undefined > {
	const g = window as unknown as NativeWindowGlobals;
	return {
		...( g.wpDesktopNativeWindows || {} ),
		...( g.openStationNativeWindows || {} ),
	};
}

export interface NativeWindowSync {

	sync: ( list: NativeWindowServerEntry[] ) => Promise< void >;

	openById: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean;

	openNewById: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean;

	restoreById: (
		instanceId: string,
		baseId: string,
		state: NativeWindowRestoreState,
	) => boolean;

	loadScriptById: ( id: string ) => Promise< boolean >;

	prewarmById: ( id: string ) => Promise< boolean >;
}

export type NativeWindowRestoreState = Partial<
	Pick<
		WindowConfig,
		| 'desktopId'
		| 'x'
		| 'y'
		| 'width'
		| 'height'
		| 'initialState'
		| 'params'
		| 'gridSpan'
	>
>;

function declareServerTabs(
	body: HTMLElement,
	entry: NativeWindowServerEntry,
): void {
	const tabs = entry.tabs;
	if ( ! Array.isArray( tabs ) || tabs.length < 2 ) {
		return;
	}
	const winEl = body.closest< HTMLElement >( '.os-window' );
	if ( ! winEl ) {
		return;
	}
	setPanelTabs(
		winEl,
		tabs.map( ( tab ) => ( { value: tab.value, label: tab.label } ) ),

		tabs.find( ( tab ) => tab.isMain )?.value,
	);
}

export function hydrateServerEntries(
	entries: NativeWindowWireEntry[],
	scriptData?: NativeWindowScriptData,
): NativeWindowServerEntry[] {
	const data = scriptData ?? {};

	const depsOf = ( handle: string | undefined ): LazyScriptDependency[] | undefined => {
		const own = handle ? data[ handle ] : undefined;
		if ( ! own?.deps || own.deps.length === 0 ) {
			return undefined;
		}
		const deps: LazyScriptDependency[] = [];
		for ( const depHandle of own.deps ) {
			const dep = data[ depHandle ];
			if ( ! dep ) {
				continue;
			}
			deps.push( {
				handle: depHandle,
				url: dep.url ?? '',
				before: dep.before,
				after: dep.after,
				l10n: dep.l10n,
				translations: dep.translations,
			} );
		}
		return deps.length > 0 ? deps : undefined;
	};
	return entries.map( ( entry ) => {
		const own = entry.scriptHandle ? data[ entry.scriptHandle ] : undefined;

		const companions: NativeWindowCompanionScript[] = [];
		for ( const companion of entry.companionScripts ?? [] ) {
			if ( typeof companion !== 'string' ) {
				companions.push( companion );
				continue;
			}
			const resolved = data[ companion ];
			if ( ! resolved?.url ) {
				continue;
			}
			companions.push( {
				scriptUrl: resolved.url,
				scriptHandle: companion,
				scriptBefore: resolved.before,
				scriptAfter: resolved.after,
				scriptL10n: resolved.l10n,
				scriptTranslations: resolved.translations,
				scriptDeps: depsOf( companion ),
			} );
		}

		const tabs: NativeWindowTabEntry[] = ( entry.tabs ?? [] ).map(
			( tab ) => {
				if ( typeof tab.scriptUrl === 'string' ) {
					return tab as NativeWindowTabEntry;
				}
				const resolved = tab.scriptHandle
					? data[ tab.scriptHandle ]
					: undefined;
				return {
					...tab,
					scriptUrl: resolved?.url ?? '',
					scriptBefore: resolved?.before,
					scriptAfter: resolved?.after,
					scriptL10n: resolved?.l10n,
					scriptTranslations: resolved?.translations,
					scriptDeps: depsOf( tab.scriptHandle ),
				};
			},
		);

		return {
			...entry,
			scriptUrl: entry.scriptUrl ?? own?.url ?? '',
			scriptBefore: entry.scriptBefore ?? own?.before,
			scriptAfter: entry.scriptAfter ?? own?.after,
			scriptL10n: entry.scriptL10n ?? own?.l10n,
			scriptTranslations: entry.scriptTranslations ?? own?.translations,
			scriptDeps: entry.scriptDeps ?? depsOf( entry.scriptHandle ),
			companionScripts: companions,
			tabs,
		};
	} );
}

export function createNativeWindowSync(
	deps: NativeWindowRegistryDeps,
): NativeWindowSync {
	const { manager, appendSystemTile, removeSystemTile } = deps;

	const registered = new Set< string >();
	const injectedTemplates = new Set< string >();
	const loadedScripts = new Set< string >();

	const inflightScripts = new Map< string, Promise< void > >();
	const loadedStyles = new Set< string >();

	const entriesById = new Map< string, NativeWindowServerEntry >();

	const resolveSizeForEntry = (
		entry: NativeWindowServerEntry,
	): { width: number; height: number } => {
		const saved = loadNativeWindowGeometry( entry.id );
		if ( ! saved ) {
			return { width: entry.width, height: entry.height };
		}
		return {
			width: Math.max( saved.width, entry.minWidth ),
			height: Math.max( saved.height, entry.minHeight ),
		};
	};

	const ensureTemplate = ( entry: NativeWindowServerEntry ): void => {
		if ( injectedTemplates.has( entry.templateId ) ) {
			return;
		}

		if ( document.getElementById( entry.templateId ) ) {
			injectedTemplates.add( entry.templateId );
			return;
		}
		if ( ! entry.templateHtml ) {
			return;
		}
		const tpl = document.createElement( 'template' );
		tpl.id = entry.templateId;
		tpl.innerHTML = entry.templateHtml;
		document.body.appendChild( tpl );
		injectedTemplates.add( entry.templateId );
	};

	const injectStylesheet = ( style: {
		styleUrl?: string;
		styleHandle?: string;
		styleInline?: string[];
	} ): void => {
		const url = style.styleUrl;
		if ( ! url || loadedStyles.has( url ) ) {
			return;
		}

		const safeUrl = url.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
		const existing = document.head.querySelector< HTMLLinkElement >(
			`link[rel="stylesheet"][href="${ safeUrl }"]`,
		);
		if ( ! existing ) {
			const link = document.createElement( 'link' );
			link.rel = 'stylesheet';
			link.href = url;
			if ( style.styleHandle ) {
				link.dataset.osStyleHandle = style.styleHandle;
			}
			document.head.appendChild( link );
		}

		if ( Array.isArray( style.styleInline ) ) {
			for ( const css of style.styleInline ) {
				if ( typeof css !== 'string' || css === '' ) {
					continue;
				}
				const el = document.createElement( 'style' );
				if ( style.styleHandle ) {
					el.dataset.osStyleHandle = style.styleHandle;
				}
				el.textContent = css;
				document.head.appendChild( el );
			}
		}
		loadedStyles.add( url );
	};

	const ensureStyle = ( entry: NativeWindowServerEntry ): void => {
		injectStylesheet( entry );
	};

	const ensureCompanionStyles = ( entry: NativeWindowServerEntry ): void => {
		for ( const companion of entry.companionStyles ?? [] ) {
			injectStylesheet( companion );
		}
	};

	const injectedScriptData = new Set< string >();

	const injectScriptDataOnce = (
		key: string,
		script: {
			scriptTranslations?: string;
			scriptL10n?: string[];
			scriptBefore?: string[];
			scriptAfter?: string[];
		},
	): void => {
		if ( injectedScriptData.has( key ) ) {
			return;
		}
		injectedScriptData.add( key );
		const blobs = [
			script.scriptTranslations ?? '',
			...( script.scriptL10n ?? [] ),
			...( script.scriptBefore ?? [] ),
			...( script.scriptAfter ?? [] ),
		];
		for ( const code of blobs ) {
			if ( typeof code === 'string' && code !== '' ) {
				injectInlineScript( code );
			}
		}
	};

	const loadOnce = (
		id: string,
		script: {
			scriptUrl: string;
			scriptTranslations?: string;
			scriptL10n?: string[];
			scriptBefore?: string[];
			scriptAfter?: string[];
			scriptDeps?: LazyScriptDependency[];
		},
	): Promise< void > => {
		const url = script.scriptUrl;
		const dataKey = `${ id }|${ url }`;
		if ( loadedScripts.has( url ) ) {
			injectScriptDataOnce( dataKey, script );
			return Promise.resolve();
		}
		const pending = inflightScripts.get( url );
		if ( pending ) {
			return pending.then( () => injectScriptDataOnce( dataKey, script ) );
		}

		injectedScriptData.add( dataKey );
		const load = loadVendorScript( url, {
			translations: script.scriptTranslations,
			l10n: script.scriptL10n,
			before: script.scriptBefore,
			after: script.scriptAfter,

			deps: script.scriptDeps,
		} )
			.catch( ( err ) => {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-script-load',
					id,
					error: err,
				} );
			} )
			.then( () => {
				loadedScripts.add( url );
				inflightScripts.delete( url );
			} );
		inflightScripts.set( url, load );
		return load;
	};

	const ensureScript = async (
		entry: NativeWindowServerEntry,
	): Promise< void > => {
		ensureCompanionStyles( entry );
		for ( const companion of entry.companionScripts ?? [] ) {
			if ( ! companion.scriptUrl ) {
				continue;
			}
			await loadOnce( entry.id, companion );
		}
		if ( ! entry.scriptUrl ) {
			return;
		}
		await loadOnce( entry.id, entry );
	};

	const preloadScriptIfRequested = async (
		entry: NativeWindowServerEntry,
	): Promise< void > => {
		if ( ! entry.preloadScript ) {
			return;
		}
		await ensureScript( entry );
	};

	const prefetchedUrls = new Set< string >();
	const prefetchAsset = ( href: string | undefined, as: 'script' | 'style' ): void => {
		if ( ! href || prefetchedUrls.has( href ) || loadedScripts.has( href ) || loadedStyles.has( href ) ) {
			return;
		}
		prefetchedUrls.add( href );
		const link = document.createElement( 'link' );
		link.rel = 'prefetch';
		link.as = as;
		link.href = href;
		document.head.appendChild( link );
	};

	const prefetchDeferredBundles = (): void => {
		const connection = (
			navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
		).connection;
		if ( connection?.saveData || /2g$/.test( connection?.effectiveType ?? '' ) ) {
			return;
		}
		for ( const entry of entriesById.values() ) {
			if ( entry.preloadScript ) {
				continue;
			}
			for ( const companion of entry.companionScripts ?? [] ) {
				prefetchAsset( companion.scriptUrl, 'script' );
			}
			prefetchAsset( entry.scriptUrl, 'script' );
			for ( const companion of entry.companionStyles ?? [] ) {
				prefetchAsset( companion.styleUrl, 'style' );
			}
		}
	};

	let prefetchScheduled = false;
	const schedulePrefetch = (): void => {
		if ( prefetchScheduled ) {
			return;
		}
		prefetchScheduled = true;
		const run = (): void => {
			prefetchScheduled = false;
			prefetchDeferredBundles();
		};
		if ( typeof window.requestIdleCallback === 'function' ) {
			window.requestIdleCallback( run, { timeout: 4000 } );
		} else {
			window.setTimeout( run, 1500 );
		}
	};

	const buildRender = ( entry: NativeWindowServerEntry ): RenderCallback => {
		return async ( body, ctx ) => {
			body.appendChild( cloneTemplate( entry.templateId ) );

			declareServerTabs( body, entry );

			await ensureScript( entry );

			const apps = (
				window.wp?.os as unknown as
					| { apps?: { refresh?: () => unknown } }
					| undefined
			)?.apps;
			apps?.refresh?.();

			const render = readGlobalRegistry()[ entry.id ];

			return render?.( body, ctx );
		};
	};

	const openFromEntry = (
		entry: NativeWindowServerEntry,
		params?: Record< string, string | number | boolean >,
	): void => {
		const finalRender = buildRender( entry );

		const size = resolveSizeForEntry( entry );

		void manager.open( {
			id: entry.id,
			baseId: entry.id,
			native: true,
			url: `#${ entry.id }`,
			title: entry.title,
			icon: entry.icon,
			width: size.width,
			height: size.height,
			minWidth: entry.minWidth,
			minHeight: entry.minHeight,
			render: finalRender,
			autofocus: entry.autofocus,
			ownerHandle: entry.ownerHandle || entry.scriptHandle,

			...( params ? { params } : {} ),
		} );
	};

	const openNewFromEntry = (
		entry: NativeWindowServerEntry,
		params?: Record< string, string | number | boolean >,
	): void => {
		const finalRender = buildRender( entry );

		const size = resolveSizeForEntry( entry );

		void manager.openNew( {
			id: entry.id,
			baseId: entry.id,
			native: true,
			url: `#${ entry.id }`,
			title: entry.title,
			icon: entry.icon,
			width: size.width,
			height: size.height,
			minWidth: entry.minWidth,
			minHeight: entry.minHeight,
			render: finalRender,
			autofocus: entry.autofocus,
			ownerHandle: entry.ownerHandle || entry.scriptHandle,
			...( params ? { params } : {} ),
		} );
	};

	const restoreFromEntry = (
		entry: NativeWindowServerEntry,
		instanceId: string,
		state: NativeWindowRestoreState,
	): void => {
		const finalRender = buildRender( entry );
		const size = resolveSizeForEntry( entry );

		void manager.openNew( {
			id: instanceId,
			baseId: entry.id,
			native: true,
			url: `#${ entry.id }`,
			title: entry.title,
			icon: entry.icon,
			width: size.width,
			height: size.height,
			minWidth: entry.minWidth,
			minHeight: entry.minHeight,
			render: finalRender,
			autofocus: entry.autofocus,
			ownerHandle: entry.ownerHandle || entry.scriptHandle,
			...state,
		} );
	};

	const registerTile = async (
		entry: NativeWindowServerEntry,
	): Promise< void > => {
		if ( registered.has( entry.id ) ) {
			return;
		}
		if ( 'none' === entry.placement ) {
			ensureTemplate( entry );
			ensureStyle( entry );
			await preloadScriptIfRequested( entry );
			registered.add( entry.id );
			return;
		}

		ensureTemplate( entry );
		ensureStyle( entry );
		await preloadScriptIfRequested( entry );

		appendSystemTile( {
			id: entry.id,
			title: entry.title,
			icon: entry.icon,
			windowId: entry.id,
			navKind: 'control' === entry.navKind ? 'control' : 'app',

			defaultPlacement: 'rail',
			order: entry.dockOrder,
			placeable: true === entry.placeable,
			isOpen: () => !! manager.getById( entry.id ),
			onOpen: () => openFromEntry( entry ),
		} );

		doAction( HOOKS.DOCK_ITEM_APPENDED, { id: entry.id } );

		registered.add( entry.id );
	};

	const unregisterTile = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}
		removeSystemTile( id );
		registered.delete( id );
		entriesById.delete( id );
	};

	const adminPageKey = ( url: string ): string => {
		try {
			const parsed = new URL( url, window.location.origin );
			const parts = [ parsed.pathname.split( '/' ).pop() ?? '' ];
			for ( const key of [ 'post_type', 'taxonomy', 'page' ] ) {
				const value = parsed.searchParams.get( key );
				if ( value ) {
					parts.push( `${ key }=${ value }` );
				}
			}
			return parts.join( '&' );
		} catch {
			return url;
		}
	};

	const menuPagesRemapId = ( windowId: string ): string =>
		`desktop-mode/menu-pages/${ windowId }`;

	const syncMenuPages = ( entry: NativeWindowServerEntry ): void => {
		const id = menuPagesRemapId( entry.id );
		const pages = entry.menuPages ?? [];
		if ( pages.length === 0 ) {
			unregisterNativeUrlRemap( id );
			return;
		}

		const claims = pages.map( ( page ) => ( {
			tab: page.id,
			key: adminPageKey( page.page ),
		} ) );
		const tabFor = ( parsed: URL ): string | null =>
			claims.find( ( claim ) => claim.key === adminPageKey( parsed.href ) )
				?.tab ?? null;
		registerNativeUrlRemap( {
			id,
			nativeWindowId: entry.id,
			matches: ( _url, parsed ) => tabFor( parsed ) !== null,
			params: ( _url, parsed ) => {
				const tab = tabFor( parsed );
				return tab ? { tab } : undefined;
			},
		} );
	};

	const sync = async ( list: NativeWindowServerEntry[] ) => {
		const incoming = new Set< string >();
		for ( const entry of list ) {
			incoming.add( entry.id );
			syncMenuPages( entry );

			entriesById.set( entry.id, entry );
		}

		for ( const id of Array.from( registered ) ) {
			if ( ! incoming.has( id ) ) {
				unregisterTile( id );
				unregisterNativeUrlRemap( menuPagesRemapId( id ) );
			}
		}

		for ( const entry of list ) {
			if ( ! registered.has( entry.id ) ) {
				await registerTile( entry );
			}
		}

		schedulePrefetch();
	};

	const openById = (
		id: string,
		opts: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		} = {},
	): boolean => {
		const entry = entriesById.get( id );
		if ( ! entry ) {
			return false;
		}

		activity.publish( 'os/open-requested', {
			windowId: id,
			source: opts.source ?? 'api',
		} );
		openFromEntry( entry, opts.params );
		return true;
	};

	const openNewById = (
		id: string,
		opts: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		} = {},
	): boolean => {
		const entry = entriesById.get( id );
		if ( ! entry ) {
			return false;
		}
		activity.publish( 'os/open-requested', {
			windowId: id,
			source: opts.source ?? 'api',
		} );
		openNewFromEntry( entry, opts.params );
		return true;
	};

	const restoreById = (
		instanceId: string,
		baseId: string,
		state: NativeWindowRestoreState,
	): boolean => {
		const entry = entriesById.get( baseId );
		if ( ! entry ) {
			return false;
		}
		restoreFromEntry( entry, instanceId, state );
		return true;
	};

	addAction(
		HOOKS.WINDOW_RESIZE_END,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const p = payload as
				| { windowId?: string; width?: number; height?: number }
				| null;
			const windowId = p?.windowId;
			const width = p?.width;
			const height = p?.height;
			if (
				! windowId ||
				typeof width !== 'number' ||
				typeof height !== 'number'
			) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			if ( win.state !== 'normal' ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			saveNativeWindowGeometry( baseId, { width, height } );

			if ( win.element ) {
				saveNativeWindowPosition( baseId, {
					x: win.element.offsetLeft,
					y: win.element.offsetTop,
				} );
			}
		},
	);

	addAction(
		HOOKS.WINDOW_DRAG_END,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const windowId = ( payload as { windowId?: string } | null )?.windowId;
			if ( ! windowId ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			if ( win.state !== 'normal' ) {
				return;
			}
			if ( ! win.element ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			saveNativeWindowGeometry( baseId, {
				width: win.element.offsetWidth,
				height: win.element.offsetHeight,
			} );
			saveNativeWindowPosition( baseId, {
				x: win.element.offsetLeft,
				y: win.element.offsetTop,
			} );
		},
	);

	addAction(
		HOOKS.WINDOW_MAXIMIZED,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const windowId = ( payload as { windowId?: string } | null )?.windowId;
			if ( ! windowId ) {
				return;
			}

			if ( isMobileStamped() ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			const entry = entriesById.get( baseId );
			const defaults = entry
				? { width: entry.width, height: entry.height }
				: { width: win.config.width, height: win.config.height };
			setNativeWindowSavedState( baseId, 'maximized', defaults );
		},
	);

	addAction(
		HOOKS.WINDOW_UNMAXIMIZED,
		'desktop-mode-native-window-geometry',
		( payload: unknown ) => {
			const windowId = ( payload as { windowId?: string } | null )?.windowId;
			if ( ! windowId ) {
				return;
			}
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			const baseId = win.config.baseId || win.id;
			setNativeWindowSavedState( baseId, null );
		},
	);

	const loadScriptById = async ( id: string ): Promise< boolean > => {
		const entry = entriesById.get( id );
		if ( ! entry ) {
			return false;
		}
		await ensureScript( entry );
		return true;
	};

	const prewarmById = async ( id: string ): Promise< boolean > => {
		const entry = entriesById.get( id );
		if ( ! entry || manager.getById( id ) ) {
			return false;
		}
		await ensureScript( entry );
		const apps = (
			window as unknown as { wp?: { os?: { apps?: { prewarm?: ( appId: string ) => boolean } } } }
		).wp?.os?.apps;
		return apps?.prewarm?.( id ) === true;
	};

	return {
		sync,
		openById,
		openNewById,
		restoreById,
		loadScriptById,
		prewarmById,
	};
}

export function cloneTemplate(
	template: string | HTMLTemplateElement,
): DocumentFragment {
	let tpl: HTMLTemplateElement | null = null;
	if ( typeof template === 'string' ) {
		const found = document.getElementById( template );
		if ( found instanceof HTMLTemplateElement ) {
			tpl = found;
		}
	} else {
		tpl = template;
	}
	if ( ! tpl ) {
		throw new Error(
			`[openstation] cloneTemplate: no <template> found for ${
				typeof template === 'string' ? `#${ template }` : '<reference>'
			}`,
		);
	}
	return tpl.content.cloneNode( true ) as DocumentFragment;
}
