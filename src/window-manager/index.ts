import { HOOKS, doAction, applyFilters } from '../hooks';
import { isMobileStamped } from '../mode/stamp';
import type {
	Desktop,
	Session,
	SessionWindow,
	VisibleWindowRect,
	WindowConfig,
	WindowState,
} from '../types';
import type { Window } from '../window';
import { urlReuseKey } from '../utils';
import {
	ensureWindowSystemLoaded,
	windowSystemBundleUrl,
} from '../window-system/loader';
import {
	ensureShellOverlaysLoaded,
	shellOverlaysBundleUrl,
} from '../shell-overlays/loader';

import {
	applyDesktopVisibility,
	createDesktop,
	closeDesktop,
	getActiveDesktop,
	getActiveDesktopId,
	getDesktops,
	moveWindowToDesktop,
	renameDesktop,
	seedDesktops,
	switchDesktop,
	type SwitchDesktopOptions,
} from './desktops';

import { cascade, columns, focus as focusLayout, tile } from './arrange';
import {
	getSnapConfig,
	loadSnapEnabled,
	setSnapEnabled,
} from './snap';
import {
	abortSnapIfPending,
	commitSnapIfPending,
	installSnapPartnerReflow,
	snapPartnerMinWidth,
	updateSnapZoneForDrag,
} from './snap-zones';
import { snapHalfRect } from './geometry';
import {
	beginGridSnap,
	cancelGridSnap,
	commitGridSnapIfActive,
	GridSnapAnchorReason,
	gridSpanRect,
	resetGridSnapAnchor,
	updateGridSnap,
} from './grid-snap';
import { destroyDesktopNameHud } from './desktop-name-hud';
import { cancelOverviewTimers, enterOverview, exitOverview } from './overview';
import { loadNativeWindowGeometry } from './native-window-geometry';
import { clampWindowPosition } from '../window/pointer';
import { subscribeWorkArea, workAreaRectOf, type WorkAreaRect } from '../work-area';

const BASE_Z_INDEX = 100;

const CASCADE_OFFSET = 30;

export interface ResolvedWindowGeometry {
	x: number;
	y: number;
	width: number;
	height: number;

	state?: WindowState;
}

export interface WindowGeometryContext {
	windowId: string;
	baseId: string;
	hasSavedGeometry: boolean;
	callerPinned: boolean;
	desktopRect: {
		width: number;
		height: number;
	};
	workArea: WorkAreaRect;
}

export class WindowManager {
	public _stack: Window[] = [];

	private _cascadeMinimized: WeakSet< Window > = new WeakSet();

	private _cascadeDepth = 0;

	public _desktop: HTMLElement;

	private cascadeIndex = 0;

	private _pendingRestoreState = new Map< string, Partial< WindowConfig > >();

	private _reservedRestoreIds = new Set< string >();

	private _openingWindowIds = new Set< string >();

	private _openingBaseIds = new Set< string >();

	private _prewarmed: { baseId: string; win: Window; timer: number } | null =
		null;

	private _prewarmInFlight = false;

	public _desktops: Desktop[] = [

		{ id: 'desktop-1', label: 'Workspace 1' },
	];

	public _activeDesktopId = 'desktop-1';

	public _desktopSeq = 1;

	public onToggleStartupRequested: ( ( win: Window ) => void ) | null = null;

	private desktopResizeObserver: ResizeObserver | null = null;

	private _unsubscribeWorkArea: () => void;
	private _uninstallSnapPartnerReflow: () => void;

	private _reflowRestoreTimer: number | null = null;

	public _snapEnabled = loadSnapEnabled();

	public _overviewActive = false;

	public _overviewSnapshot: Map<
		string,
		{ transform: string; transition: string }
	> = new Map();

	public _overviewLabels: Map<string, HTMLElement> = new Map();

	public _overviewPointerDownHandler: ( ( e: PointerEvent ) => void ) | null = null;

	public _overviewPointerUpHandler: ( ( e: PointerEvent ) => void ) | null = null;

	public _overviewKeyHandler: ( ( e: KeyboardEvent ) => void ) | null = null;

	public _overviewPressTarget: { id: string; element: HTMLElement } | null = null;

	public _overviewClickBlocker: ( ( e: MouseEvent ) => void ) | null = null;

	public _overviewTopBar: HTMLElement | null = null;

	public _overviewMouseHandler: ( ( e: MouseEvent ) => void ) | null = null;

	public _lastOverviewHoverId: string | null = null;

	public _overviewAddTileFocused = false;

	public _overviewEnterTimeoutId: number | null = null;

	public _overviewExitTimeoutId: number | null = null;

	public _overviewExitFinalizer: ( () => void ) | null = null;

	public _snapPendingZone: 'left' | 'right' | null = null;

	public _snapPreviewEl: HTMLElement | null = null;

	public _gridSnap: import( './grid-snap' ).GridSnapSession | null = null;

	public _splitOverviewActive = false;

	public _splitOverviewAnchor: Window | null = null;

	public _splitOverviewZone: 'left' | 'right' | null = null;

	public _splitOverviewSnapshot: Map< string, { transform: string; transition: string } > = new Map();

	public _splitOverviewLabels: Map< string, HTMLElement > = new Map();

	public _splitOverviewPointerDown: ( ( e: PointerEvent ) => void ) | null = null;

	public _splitOverviewPointerUp: ( ( e: PointerEvent ) => void ) | null = null;

	public _splitOverviewPressTarget: { id: string; element: HTMLElement } | null = null;

	public _splitOverviewClickBlocker: ( ( e: MouseEvent ) => void ) | null = null;

	public _splitOverviewKey: ( ( e: KeyboardEvent ) => void ) | null = null;

	constructor( desktop: HTMLElement ) {
		this._desktop = desktop;
		if ( typeof ResizeObserver !== 'undefined' ) {
			this.desktopResizeObserver = new ResizeObserver( () =>
				this.reflowStatefulWindows(),
			);
			this.desktopResizeObserver.observe( desktop );
		}
		this._unsubscribeWorkArea = subscribeWorkArea( () => this.reflowStatefulWindows() );
		this._uninstallSnapPartnerReflow = installSnapPartnerReflow( this );
		this.installIframeFocusBridge();
	}

	private installIframeFocusBridge(): void {
		window.addEventListener( 'blur', () => {
			window.setTimeout( () => {
				const active = this._desktop.ownerDocument?.activeElement ?? null;
				if ( ! active || active.tagName !== 'IFRAME' ) {
					return;
				}
				const winEl = active.closest<HTMLElement>(
					'.os-window',
				);
				if ( ! winEl ) {
					return;
				}
				const id = winEl.id.replace( /^wp-window-/, '' );
				const win = this.getById( id );
				if ( ! win ) {
					return;
				}

				if ( this._overviewActive ) {
					return;
				}

				if ( this.getFocused() === win ) {
					return;
				}
				this.focus( win );
			}, 0 );
		} );
	}

	private reflowStatefulWindows(): void {
		if ( this._overviewActive ) {
			return;
		}
		for ( const w of this._stack ) {
			const parent = w.element.parentElement;
			if ( ! parent ) {
				continue;
			}
			const area = workAreaRectOf( parent );
			if ( w.state === 'maximized' ) {
				w.element.classList.add( 'os-window--reflowing' );
				w.element.style.left = `${ area.x }px`;
				w.element.style.top = `${ area.y }px`;
				w.element.style.width = `${ area.width }px`;
				w.element.style.height = `${ area.height }px`;
			} else if (
				w.state === 'snapped-left' ||
				w.state === 'snapped-right'
			) {
				w.element.classList.add( 'os-window--reflowing' );
				const zone = w.state === 'snapped-left' ? 'left' : 'right';
				const rect = snapHalfRect(
					area,
					zone,
					w.config.minWidth || 0,
					snapPartnerMinWidth( this, w, zone ),
				);
				w.element.style.left = `${ rect.x }px`;
				w.element.style.top = `${ rect.y }px`;
				w.element.style.width = `${ rect.width }px`;
				w.element.style.height = `${ rect.height }px`;
			} else if ( w.state === 'normal' ) {
				const currentX = parseInt( w.element.style.left, 10 ) || 0;
				const currentY = parseInt( w.element.style.top, 10 ) || 0;
				const width = w.element.offsetWidth || 0;

				const safe = clampWindowPosition( currentX, currentY, width, {
					x: 0,
					y: 0,
					width: parent.clientWidth,
					height: parent.clientHeight,
				} );

				if ( currentX !== safe.x || currentY !== safe.y ) {
					w.element.classList.add( 'os-window--reflowing' );
					w.element.style.left = `${ safe.x }px`;
					w.element.style.top = `${ safe.y }px`;
				}
			}
		}

		if ( this._reflowRestoreTimer !== null ) {
			window.clearTimeout( this._reflowRestoreTimer );
		}
		this._reflowRestoreTimer = window.setTimeout( () => {
			this._reflowRestoreTimer = null;
			for ( const w of this._stack ) {
				w.element.classList.remove( 'os-window--reflowing' );
			}
		}, 140 ) as unknown as number;
	}

	public async open(
		config: Partial<WindowConfig> & { id: string; url: string; title: string },
	): Promise< Window > {
		if ( ! config || typeof config !== 'object' ) {
			throw new TypeError(
				'windowManager.open() requires a config object with at least { id, url, title }; received ' +
					( config === null ? 'null' : typeof config ),
			);
		}
		if ( typeof config.id !== 'string' || config.id === '' ) {
			throw new TypeError(
				'windowManager.open(): config.id must be a non-empty string.',
			);
		}
		if ( typeof config.url !== 'string' || config.url === '' ) {
			throw new TypeError(
				'windowManager.open(): config.url must be a non-empty string. Pass an admin URL (e.g. "/wp-admin/edit.php") or a hash fragment (e.g. "#my-window") for native windows.',
			);
		}
		if ( typeof config.title !== 'string' ) {
			throw new TypeError(
				'windowManager.open(): config.title must be a string.',
			);
		}
		const baseId = config.baseId || config.id;

		const existing = this.getByBaseIdOnActiveDesktop( baseId );
		if ( existing ) {
			const wasMinimized = existing.state === 'minimized';
			this.focus( existing );
			if ( wasMinimized ) {
				existing.restore();
			}

			let navigated = false;
			if ( ! existing.config.native ) {
				const requestedKey = urlReuseKey( config.url );
				const alreadyThere =
					requestedKey === urlReuseKey( existing.getCurrentUrl() ) ||
					requestedKey === urlReuseKey( existing.config.url || '' ) ||
					requestedKey ===
						urlReuseKey(
							existing.config.parentUrl ?? existing.config.url ?? '',
						);
				if ( ! alreadyThere ) {
					navigated = existing.navigateTo( config.url );
				}
			}

			if ( config.params ) {
				existing.config.params = { ...config.params };
			}

			const reopenedDetail = {
				windowId: existing.id,
				baseId,
				wasMinimized,
				navigated,
				params: existing.config.params ?? {},
			};
			document.dispatchEvent(
				new CustomEvent( 'os-window-reopened', { detail: reopenedDetail } ),
			);
			doAction( HOOKS.WINDOW_REOPENED, reopenedDetail );
			return existing;
		}

		const adopted = this.adoptPrewarmed( baseId, config );
		if ( adopted ) {
			return adopted;
		}

		const id = this.getByBaseId( baseId )
			? this.nextInstanceId( baseId )
			: config.id;
		return this.createWindow( { ...config, id, baseId } );
	}

	public async prewarm(
		config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		},
	): Promise< boolean > {
		const baseId = config.baseId || config.id;
		if (
			config.native ||
			this._prewarmInFlight ||
			this._prewarmed?.baseId === baseId ||
			this.getByBaseId( baseId )
		) {
			return false;
		}
		this._prewarmInFlight = true;
		try {
			this.discardPrewarmed();
			const win = await this.createWindow(
				{ ...config, id: config.id, baseId },
				{ prewarm: true },
			);

			if ( this.getByBaseId( baseId ) ) {
				this.teardownSpeculativeWindow( win );
				return false;
			}

			const timer = window.setTimeout(
				() => this.discardPrewarmed(),
				45_000,
			);
			this._prewarmed = { baseId, win, timer };
			return true;
		} finally {
			this._prewarmInFlight = false;
		}
	}

	private adoptPrewarmed(
		baseId: string,
		config: Partial< WindowConfig > & { url: string },
	): Window | null {
		const slot = this._prewarmed;
		if ( ! slot || slot.baseId !== baseId ) {
			return null;
		}
		const win = slot.win;

		if (
			urlReuseKey( config.url ) !== urlReuseKey( win.config.url || '' ) ||
			this.getById( win.id )
		) {
			this.discardPrewarmed();
			return null;
		}
		window.clearTimeout( slot.timer );
		this._prewarmed = null;
		win.config.desktopId = this._activeDesktopId;
		win.element.style.display = '';
		win.element.removeAttribute( 'aria-hidden' );
		this._stack.push( win );
		applyDesktopVisibility( this, win );
		this.focus( win );
		const openedDetail = {
			windowId: win.id,
			page: win.config.url ?? config.url,
			title: win.config.title,
			url: win.config.url ?? config.url,
		};
		document.dispatchEvent(
			new CustomEvent( 'os-window-opened', { detail: openedDetail } ),
		);
		doAction( HOOKS.WINDOW_OPENED, openedDetail );
		return win;
	}

	public discardPrewarmed(): void {
		const slot = this._prewarmed;
		if ( ! slot ) {
			return;
		}
		this._prewarmed = null;
		window.clearTimeout( slot.timer );
		this.teardownSpeculativeWindow( slot.win );
	}

	private teardownSpeculativeWindow( win: Window ): void {
		try {
			(
				globalThis as unknown as {
					__openStationConnectionBridge?: {
						onWindowClosed?: ( id: string ) => void;
					};
				}
			).__openStationConnectionBridge?.onWindowClosed?.( win.id );
		} catch {

		}
		win.onClose = null;
		try {
			win.destroy();
		} catch {

		}
		win.element.remove();
	}

	public async openNew(
		config: Partial<WindowConfig> & { id: string; url: string; title: string },
	): Promise< Window > {
		const baseId = config.baseId || config.id;
		const nextId =
			config.id !== baseId &&
			! this.getById( config.id ) &&
			! this._openingWindowIds.has( config.id )
				? config.id
				: this.nextInstanceId( baseId );
		const duplicate =
			!! this.getByBaseIdOnActiveDesktop( baseId ) ||
			this._openingBaseIds.has( baseId );
		if ( ! duplicate ) {
			const adopted = this.adoptPrewarmed( baseId, config );
			if ( adopted ) {
				return adopted;
			}
		}
		const cascadeX = 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;
		const cascadeY = 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;
		return this.createWindow( {

			...( duplicate && 'default' === ( config.openAs ?? this.openWindowsAs() )
				? { initialState: 'normal', x: cascadeX, y: cascadeY }
				: {} ),
			...config,
			id: nextId,
			baseId,
		} );
	}

	private async createWindow(
		config: Partial<WindowConfig> & { id: string; url: string; title: string; baseId?: string },
		createOpts: { prewarm?: boolean } = {},
	): Promise< Window > {
		const staged = this._pendingRestoreState.get( config.id );
		if ( staged ) {
			this._pendingRestoreState.delete( config.id );
			this._reservedRestoreIds.delete( config.id );
			config = { ...config, ...staged };
		}

		const desktopRect = this._desktop.getBoundingClientRect();

		const workArea = workAreaRectOf( this._desktop );
		const margin = 12;
		const defaultWidth = Math.min( Math.round( workArea.width * 0.8 ), 1200 );
		const defaultHeight = Math.min( Math.round( workArea.height * 0.8 ), 800 );
		const cascadeX = workArea.x + 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;
		const cascadeY = workArea.y + 40 + ( this.cascadeIndex % 8 ) * CASCADE_OFFSET;

		const resolvedBaseId = config.baseId || config.id;
		const minWidth = config.minWidth ?? 320;
		const minHeight = config.minHeight ?? 200;
		const hasExplicitWidth = typeof config.width === 'number';
		const hasExplicitHeight = typeof config.height === 'number';
		const hasExplicitX = typeof config.x === 'number';
		const hasExplicitY = typeof config.y === 'number';
		const hasExplicitState = typeof config.initialState === 'string';
		const saved =
			! hasExplicitWidth ||
			! hasExplicitHeight ||
			! hasExplicitState ||
			! hasExplicitX ||
			! hasExplicitY
				? loadNativeWindowGeometry( resolvedBaseId )
				: null;
		let resolvedWidth =
			config.width ??
			( saved ? Math.max( saved.width, minWidth ) : defaultWidth );
		let resolvedHeight =
			config.height ??
			( saved ? Math.max( saved.height, minHeight ) : defaultHeight );

		const placedByDefault = ! hasExplicitX && ! hasExplicitY && ! saved;
		if ( placedByDefault ) {
			resolvedWidth = Math.max(
				minWidth,
				Math.min( resolvedWidth, workArea.width - margin * 2 ),
			);
			resolvedHeight = Math.max(
				minHeight,
				Math.min( resolvedHeight, workArea.height - margin * 2 ),
			);
		}
		const defaultX = Math.max(
			workArea.x + margin,
			Math.min( cascadeX, workArea.x + workArea.width - resolvedWidth - margin ),
		);
		const defaultY = Math.max(
			workArea.y + margin,
			Math.min( cascadeY, workArea.y + workArea.height - resolvedHeight - margin ),
		);

		const openAs =
			! hasExplicitState && ! staged && ! createOpts.prewarm
				? config.openAs ?? this.openWindowsAs()
				: 'default';
		const resolvedState =
			config.initialState ??
			( 'default' !== openAs ? 'maximized' : undefined ) ??
			( saved?.state === 'maximized' ? 'maximized' : undefined );

		let clampedSavedX: number | undefined;
		let clampedSavedY: number | undefined;
		if (
			saved &&
			typeof saved.x === 'number' &&
			typeof saved.y === 'number'
		) {
			const maxX = Math.max(
				workArea.x,
				workArea.x + workArea.width - resolvedWidth - margin,
			);
			const maxY = Math.max(
				workArea.y,
				workArea.y + workArea.height - resolvedHeight - margin,
			);
			clampedSavedX = Math.max( workArea.x + margin, Math.min( saved.x, maxX ) );
			clampedSavedY = Math.max( workArea.y + margin, Math.min( saved.y, maxY ) );
		}
		const resolvedX = config.x ?? clampedSavedX ?? defaultX;
		const resolvedY = config.y ?? clampedSavedY ?? defaultY;

		const callerPinned =
			hasExplicitWidth ||
			hasExplicitHeight ||
			hasExplicitX ||
			hasExplicitY ||
			hasExplicitState;
		const hasSavedGeometry = !! saved;

		const preFilterGeometry: ResolvedWindowGeometry = {
			x: resolvedX,
			y: resolvedY,
			width: resolvedWidth,
			height: resolvedHeight,
			state: resolvedState,
		};
		let filtered: ResolvedWindowGeometry;
		try {
			filtered = applyFilters<
				ResolvedWindowGeometry,
				[ WindowGeometryContext ]
			>(
				HOOKS.WINDOW_GEOMETRY,
				preFilterGeometry,
				{
					windowId: config.id,
					baseId: resolvedBaseId,
					hasSavedGeometry,
					callerPinned,
					desktopRect: {
						width: desktopRect.width,
						height: desktopRect.height,
					},
					workArea: { ...workArea },
				},
			);
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-geometry-filter',
				windowId: config.id,
				error: err,
			} );
			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] WINDOW_GEOMETRY filter threw for "${ config.id }":`,
					err,
				);
			}
			filtered = preFilterGeometry;
		}

		const coalesce = ( v: unknown, fallback: number ): number =>
			typeof v === 'number' && Number.isFinite( v ) ? v : fallback;
		const safeFiltered: ResolvedWindowGeometry =
			filtered && typeof filtered === 'object' ? filtered : preFilterGeometry;
		const finalWidth = Math.max(
			coalesce( safeFiltered.width, resolvedWidth ),
			minWidth,
		);
		const finalHeight = Math.max(
			coalesce( safeFiltered.height, resolvedHeight ),
			minHeight,
		);
		const finalX = coalesce( safeFiltered.x, resolvedX );
		const finalY = coalesce( safeFiltered.y, resolvedY );
		const finalState: WindowState | undefined =
			safeFiltered.state ?? resolvedState;

		const fullConfig: WindowConfig = {
			icon: config.icon || 'dashicons-admin-generic',
			...config,

			x: finalX,
			y: finalY,
			width: finalWidth,
			height: finalHeight,
			minWidth,
			minHeight,
			...( finalState ? { initialState: finalState } : {} ),
			baseId: resolvedBaseId,

			desktopId: config.desktopId || this._activeDesktopId,
		};

		if ( config.gridSpan ) {
			const onGrid = gridSpanRect(
				config.gridSpan,
				workAreaRectOf( this._desktop ),
			);
			fullConfig.x = onGrid.x;
			fullConfig.y = onGrid.y;
			fullConfig.width = onGrid.width;
			fullConfig.height = onGrid.height;
		}

		this.cascadeIndex++;

		this._openingWindowIds.add( config.id );
		this._openingBaseIds.add( resolvedBaseId );
		const bundles = Promise.all( [
			ensureWindowSystemLoaded( windowSystemBundleUrl() ),
			ensureShellOverlaysLoaded( shellOverlaysBundleUrl() ),
		] );
		let loaded: Awaited< typeof bundles >;
		try {
			loaded = await bundles;
		} catch ( err ) {
			this._openingWindowIds.delete( config.id );
			this._openingBaseIds.delete( resolvedBaseId );
			throw err;
		}
		this._openingWindowIds.delete( config.id );
		this._openingBaseIds.delete( resolvedBaseId );
		const [ system ] = loaded;
		const win = system.createWindow( fullConfig );

		if ( config.gridSpan ) {
			win._gridSpan = {
				anchor: { ...config.gridSpan.anchor },
				cursor: { ...config.gridSpan.cursor },
				cols: config.gridSpan.cols,
				rows: config.gridSpan.rows,
			};
		}

		win.onFocusRequest = ( w: Window ) => {
			if ( this._cascadeDepth > 0 ) {
				return;
			}
			this.focus( w );
		};
		win.onClose = ( w: Window ) => this.remove( w );
		win.onMinimize = ( w: Window ) => {
			this._cascadeDepth++;
			try {
				this.cascadeMinimize( w );
			} finally {
				this._cascadeDepth--;
			}
			if ( this._cascadeDepth > 0 ) {
				return;
			}
			const activeDesktopId = this.getActiveDesktopId();
			const visible = this._stack.filter(
				( x ) =>
					( x.config.desktopId || activeDesktopId ) === activeDesktopId &&
					x.state !== 'minimized',
			);
			if ( visible.length > 0 ) {
				this.focus( visible[ visible.length - 1 ] );
			}
		};
		win.onRestore = ( w: Window ) => {
			this._cascadeDepth++;
			try {
				this.cascadeRestore( w );
			} finally {
				this._cascadeDepth--;
			}
		};
		win.onOpenAnother = ( w: Window ) => {
			const baseId = w.config.baseId || w.id;
			if ( w.config.native ) {
				const api = ( window as unknown as {
					wp?: {
						os?: {
							openNewWindow?: (
								id: string,
								opts?: { source?: string },
							) => boolean;
						};
					};
				} ).wp?.os;
				if ( api?.openNewWindow?.( baseId, { source: 'open-another' } ) ) {
					return;
				}
			}
			void this.openNew( {
				id: baseId,
				baseId,
				url: w.config.url || '',
				title: w.config.title,
				icon: w.config.icon,
				submenu: w.config.submenu,
				multi: true,
			} );
		};

		win.onOpenInNewWindow = ( w: Window ) => {
			const baseId = w.config.baseId || w.id;
			if ( w.config.native ) {
				const api = ( window as unknown as {
					wp?: {
						os?: {
							openNewWindow?: (
								id: string,
								opts?: { source?: string },
							) => boolean;
						};
					};
				} ).wp?.os;
				if ( api?.openNewWindow?.( baseId, { source: 'open-in-new-window' } ) ) {
					return;
				}
			}
			const currentUrl = w.getCurrentUrl();
			void this.openNew( {
				id: baseId,
				baseId,
				url: currentUrl || w.config.url || '',
				title: w.config.title,
				icon: w.config.icon,
				submenu: w.config.submenu,
				multi: true,
			} );
		};

		win.onToggleStartup = ( w: Window ) => {
			this.onToggleStartupRequested?.( w );
		};
		win.snapConfigProvider = () => this.getSnapConfig();
		win.snapPartnerMinWidthProvider = ( zone ) =>
			snapPartnerMinWidth( this, win, zone );

		win.onDragMove = ( w, clientX, clientY ) => {
			if ( this._gridSnap ) {
				updateGridSnap( this, clientX, clientY );
				return;
			}
			updateSnapZoneForDrag( this, w, clientX );
		};
		win.onDragGesture = ( w, gesture ) => {
			switch ( gesture.type ) {
				case 'modifier':
					if ( gesture.active ) {
						beginGridSnap( this, w, gesture.clientX, gesture.clientY );
					} else {
						cancelGridSnap( this );
					}
					break;
				case 'shake':

					resetGridSnapAnchor(
						this,
						gesture.clientX,
						gesture.clientY,
						GridSnapAnchorReason.Shake,
					);
					break;
			}
		};
		win.onDragEnd = ( w ) => {
			if ( this._gridSnap ) {
				return commitGridSnapIfActive( this, w );
			}
			if ( this._snapPendingZone ) {
				return commitSnapIfPending( this, w );
			}
			abortSnapIfPending( this );
			return false;
		};

		if ( createOpts.prewarm ) {
			win.element.style.display = 'none';
			win.element.setAttribute( 'aria-hidden', 'true' );
			this._desktop.appendChild( win.element );
			return win;
		}

		this._stack.push( win );
		this._desktop.appendChild( win.element );
		applyDesktopVisibility( this, win );

		win.hydrateNative();

		const onOtherDesktop = ( w: Window ): boolean =>
			( w.config.desktopId || this._activeDesktopId ) !== this._activeDesktopId;
		if ( onOtherDesktop( win ) ) {
			this._stack.splice( this._stack.indexOf( win ), 1 );
			let slot = this._stack.length;
			while ( slot > 0 && ! onOtherDesktop( this._stack[ slot - 1 ] ) ) {
				slot--;
			}
			this._stack.splice( slot, 0, win );
			this._stack.forEach( ( w, i ) => w.setZIndex( BASE_Z_INDEX + i ) );
		} else {
			this.focus( win );
		}

		if ( 'focused' === openAs ) {
			for ( const other of this._stack ) {
				if (
					other !== win &&
					other.state !== 'minimized' &&
					( other.config.desktopId || this._activeDesktopId ) === win.config.desktopId
				) {
					other.minimize();
				}
			}
		}

		const openedDetail = {
			windowId: win.id,
			page: config.url,
			title: config.title,
			url: config.url,
		};
		document.dispatchEvent(
			new CustomEvent( 'os-window-opened', { detail: openedDetail } ),
		);

		doAction( HOOKS.WINDOW_OPENED, openedDetail );

		return win;
	}

	private nextInstanceId( baseId: string ): string {
		const taken = new Set( [
			...this._stack.map( ( w ) => w.id ),
			...this._openingWindowIds,
			...this._reservedRestoreIds,
		] );
		if ( ! taken.has( baseId ) ) {
			return baseId;
		}
		let n = 2;
		while ( taken.has( `${ baseId }-${ n }` ) ) {
			n++;
		}
		return `${ baseId }-${ n }`;
	}

	public focus( winOrId: Window | string ): void {
		const requested =
			typeof winOrId === 'string' ? this.getById( winOrId ) : winOrId;
		if ( ! requested || typeof requested.setZIndex !== 'function' ) {
			if ( winOrId && typeof winOrId !== 'string' ) {
				console.warn(
					'[openstation] windowManager.focus() expects a Window or a window id; received',
					winOrId,
				);
			}
			return;
		}

		const win = this.blockingChildOf( requested ) ?? requested;
		if ( win !== requested ) {
			win.shake?.();
			doAction( HOOKS.WINDOW_CHILD_BLOCKED, {
				windowId: requested.id,
				childWindowId: win.id,
			} );
			document.dispatchEvent(
				new CustomEvent( 'os-window-child-blocked', {
					detail: { windowId: requested.id, childWindowId: win.id },
				} ),
			);
		}

		const targetDesktopId = win.config.desktopId || this._activeDesktopId;
		if (
			targetDesktopId !== this._activeDesktopId &&
			this._desktops.some( ( d ) => d.id === targetDesktopId )
		) {
			this.switchDesktop( targetDesktopId, { skipFocus: true } );
		}

		const previouslyFocused =
			this._stack.length > 0 ? this._stack[ this._stack.length - 1 ] : null;

		const priorFullscreen = this._stack.find(
			( w ) => w !== win && w.isFocused() && w.isFullscreen(),
		);
		if ( priorFullscreen ) {
			const shouldExit = applyFilters<
				boolean,
				[ { windowId: string; focusedTo: string } ]
			>(
				HOOKS.WINDOW_AUTO_EXIT_FULLSCREEN,
				true,
				{ windowId: priorFullscreen.id, focusedTo: win.id },
			);
			if ( shouldExit ) {
				priorFullscreen.toggleFullscreen();
			}
		}

		const idx = this._stack.indexOf( win );
		if ( idx > -1 ) {
			this._stack.splice( idx, 1 );
		}
		this._stack.push( win );

		this.enforceOwnershipOrder();

		this._stack.forEach( ( w, i ) => {
			w.setZIndex( BASE_Z_INDEX + i );
			w.setFocused( i === this._stack.length - 1 );
		} );

		if (
			previouslyFocused &&
			previouslyFocused !== win &&
			previouslyFocused.id !== win.id
		) {
			const blurredDetail = {
				windowId: previouslyFocused.id,
				focusedTo: win.id,
			};
			document.dispatchEvent(
				new CustomEvent( 'os-window-blurred', { detail: blurredDetail } ),
			);
			doAction( HOOKS.WINDOW_BLURRED, blurredDetail );
		}

		const focusedDetail = { windowId: win.id };
		document.dispatchEvent(
			new CustomEvent( 'os-window-focused', { detail: focusedDetail } ),
		);
		doAction( HOOKS.WINDOW_FOCUSED, focusedDetail );
	}

	public raise( windowId: string ): void {
		const win = this.getById( windowId );
		if ( ! win || this._stack.length < 2 ) {
			return;
		}
		const idx = this._stack.indexOf( win );
		if ( idx === -1 || idx === this._stack.length - 1 ) {
			return;
		}
		this._stack.splice( idx, 1 );
		this._stack.splice( this._stack.length - 1, 0, win );
		this.enforceOwnershipOrder();
		this._stack.forEach( ( w, i ) => {
			w.setZIndex( BASE_Z_INDEX + i );
		} );
	}

	public async openChild(
		parentWindowId: string,
		config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		},
	): Promise< Window > {
		const parent = this.getById( parentWindowId );
		if ( ! parent ) {
			throw new Error(
				`windowManager.openChild(): no open window with id "${ parentWindowId }". Open the owner first, or use open() for a standalone window.`,
			);
		}

		const savedGeometry = loadNativeWindowGeometry(
			config.baseId || config.id,
		);
		const hasSavedPlacement =
			!! savedGeometry &&
			typeof savedGeometry.x === 'number' &&
			typeof savedGeometry.y === 'number';

		let placement: Partial< WindowConfig > = {};
		if (
			config.x === undefined &&
			config.y === undefined &&
			! hasSavedPlacement
		) {
			const owner = parent.getSnapshot();
			const width = config.width ?? Math.round( owner.width * 0.8 );
			const height = config.height ?? Math.round( owner.height * 0.8 );

			const area = workAreaRectOf( this._desktop );
			const maxX = Math.max( area.x, area.x + area.width - width );
			const maxY = Math.max( area.y, area.y + area.height - height );
			placement = {
				width,
				height,
				x: Math.min(
					maxX,
					Math.max( area.x, Math.round( owner.x + ( owner.width - width ) / 2 ) ),
				),
				y: Math.min(
					maxY,
					Math.max( area.y, Math.round( owner.y + ( owner.height - height ) / 2 ) ),
				),
			};
		}

		return this.open( {
			...config,
			...placement,

			desktopId: parent.config.desktopId,
			parentWindowId,
		} );
	}

	public ownerOf( win: Window ): Window | undefined {
		const parentId = win.config.parentWindowId;
		return parentId ? this.getById( parentId ) : undefined;
	}

	public childrenOf( winOrId: Window | string ): Window[] {
		const id = typeof winOrId === 'string' ? winOrId : winOrId.id;
		return this._stack.filter( ( w ) => w.config.parentWindowId === id );
	}

	public blockingChildOf( win: Window ): Window | undefined {
		let current = win;
		let blocker: Window | undefined;

		const seen = new Set< Window >( [ win ] );
		for ( ;; ) {
			const open = this.childrenOf( current ).filter(
				( w ) => w.state !== 'minimized' && ! seen.has( w ),
			);
			if ( open.length === 0 ) {
				return blocker;
			}

			current = open[ open.length - 1 ];
			seen.add( current );
			blocker = current;
		}
	}

	private enforceOwnershipOrder(): void {
		if ( ! this._stack.some( ( w ) => w.config.parentWindowId ) ) {
			return;
		}

		const ordered: Window[] = [];
		const placed = new Set< Window >();

		const place = ( win: Window, chain: Set< Window > ): void => {
			if ( placed.has( win ) || chain.has( win ) ) {
				return;
			}
			chain.add( win );
			if ( win.state !== 'minimized' ) {
				const owner = this.ownerOf( win );
				if ( owner && owner !== win ) {
					place( owner, chain );
				}
			}
			if ( ! placed.has( win ) ) {
				placed.add( win );
				ordered.push( win );
			}
		};

		for ( const win of this._stack ) {
			place( win, new Set() );
		}

		this._stack.length = 0;
		this._stack.push( ...ordered );
	}

	private cascadeMinimize( win: Window ): void {
		for ( const child of this.childrenOf( win ) ) {
			if ( child.state === 'minimized' ) {
				continue;
			}
			this._cascadeMinimized.add( child );

			child.minimize();
		}
	}

	private cascadeRestore( win: Window ): void {
		for ( const child of this.childrenOf( win ) ) {
			if ( ! this._cascadeMinimized.has( child ) ) {
				continue;
			}
			this._cascadeMinimized.delete( child );

			child.restore();
		}
	}

	private remove( win: Window ): void {
		const idx = this._stack.indexOf( win );
		if ( idx > -1 ) {
			this._stack.splice( idx, 1 );
		}

		const children = this.childrenOf( win ).slice();
		if ( children.length > 0 ) {
			this._cascadeDepth++;
			try {
				for ( const child of children ) {
					this._cascadeMinimized.delete( child );
					child.close();
				}
			} finally {
				this._cascadeDepth--;
			}
		}

		for ( let i = this._stack.length - 1; this._cascadeDepth === 0 && i >= 0; i-- ) {
			const candidate = this._stack[ i ];
			if ( candidate.state === 'minimized' ) {
				continue;
			}
			const candidateDesktop =
				candidate.config.desktopId || this._activeDesktopId;
			if ( candidateDesktop !== this._activeDesktopId ) {
				continue;
			}
			this.focus( candidate );
			break;
		}

		const closingDetail = { windowId: win.id, element: win.element };
		document.dispatchEvent(
			new CustomEvent( 'os-window-closing', { detail: closingDetail } ),
		);
		doAction( HOOKS.WINDOW_CLOSING, closingDetail );

		const closedDetail = { windowId: win.id };
		document.dispatchEvent(
			new CustomEvent( 'os-window-closed', { detail: closedDetail } ),
		);
		doAction( HOOKS.WINDOW_CLOSED, closedDetail );
	}

	public getById( id: string ): Window | undefined {
		return this._stack.find( ( w ) => w.id === id );
	}

	public getByBaseId( baseId: string ): Window | undefined {
		for ( let i = this._stack.length - 1; i >= 0; i-- ) {
			const w = this._stack[ i ];
			if ( ( w.config.baseId || w.id ) === baseId ) {
				return w;
			}
		}
		return undefined;
	}

	public getByBaseIdOnActiveDesktop( baseId: string ): Window | undefined {
		for ( let i = this._stack.length - 1; i >= 0; i-- ) {
			const w = this._stack[ i ];
			if ( ( w.config.baseId || w.id ) !== baseId ) {
				continue;
			}
			const winDesktop = w.config.desktopId || this._activeDesktopId;
			if ( winDesktop === this._activeDesktopId ) {
				return w;
			}
		}
		return undefined;
	}

	public getAllByBaseId( baseId: string ): Window[] {
		const instanceSlot = ( id: string ): number => {
			if ( id === baseId ) {
				return 1;
			}
			const prefix = `${ baseId }-`;
			if ( id.startsWith( prefix ) ) {
				const n = parseInt( id.slice( prefix.length ), 10 );
				return Number.isFinite( n ) ? n : 999;
			}
			return 999;
		};
		return this._stack
			.filter( ( w ) => ( w.config.baseId || w.id ) === baseId )
			.sort( ( a, b ) => instanceSlot( a.id ) - instanceSlot( b.id ) );
	}

	public getAllByBaseIdOnActiveDesktop( baseId: string ): Window[] {
		return this.getAllByBaseId( baseId ).filter(
			( w ) => ( w.config.desktopId || this._activeDesktopId ) === this._activeDesktopId,
		);
	}

	public getAll(): Window[] {
		return [ ...this._stack ];
	}

	public findByIframeSource( source: MessageEventSource | null ): Window | undefined {
		if ( ! source ) {
			return undefined;
		}
		return this._stack.find(
			( w ) => w.iframe !== null && w.iframe.contentWindow === source,
		);
	}

	public getFocused(): Window | undefined {
		return this._stack.length > 0 ? this._stack[ this._stack.length - 1 ] : undefined;
	}

	public isActive( id: string ): boolean {
		const win = this.getById( id );
		if ( ! win ) {
			return false;
		}
		if ( win.state === 'minimized' ) {
			return false;
		}
		const winDesktop = win.config.desktopId || this._activeDesktopId;
		if ( winDesktop !== this._activeDesktopId ) {
			return false;
		}
		const focused = this.getFocused();
		return !! focused && focused.id === id;
	}

	public isActiveByBaseId( baseId: string ): boolean {
		const focused = this.getFocused();
		if ( ! focused ) {
			return false;
		}
		if ( focused.state === 'minimized' ) {
			return false;
		}
		const winDesktop = focused.config.desktopId || this._activeDesktopId;
		if ( winDesktop !== this._activeDesktopId ) {
			return false;
		}
		return ( focused.config.baseId || focused.id ) === baseId;
	}

	public getDesktops(): Desktop[] {
		return getDesktops( this );
	}
	public getActiveDesktop(): Desktop {
		return getActiveDesktop( this );
	}
	public getActiveDesktopId(): string {
		return getActiveDesktopId( this );
	}
	public createDesktop( init?: { label?: string } ): Desktop {
		return createDesktop( this, init );
	}
	public switchDesktop( id: string, opts?: SwitchDesktopOptions ): void {
		switchDesktop( this, id, opts );
	}
	public closeDesktop( id: string ): void {
		closeDesktop( this, id );
	}
	public renameDesktop( id: string, label: string ): boolean {
		return renameDesktop( this, id, label );
	}

	public moveWindowToDesktop( windowId: string, desktopId: string ): boolean {
		return moveWindowToDesktop( this, windowId, desktopId );
	}

	public getPrimaryDesktopId(): string {
		const all = this.getDesktops();
		const fallback = all.length > 0 ? all[ 0 ].id : 'desktop-1';
		const filtered = applyFilters< string, [ Desktop[] ] >(
			HOOKS.PRIMARY_DESKTOP_ID,
			fallback,
			all,
		);

		if ( typeof filtered !== 'string' || filtered === '' ) {
			return fallback;
		}
		const exists = all.some( ( d ) => d.id === filtered );
		return exists ? filtered : fallback;
	}

	public closeAll( options?: { exceptIds?: string[] } ): number {
		const exceptSet = new Set( options?.exceptIds ?? [] );

		const initialCandidates = this._stack.filter(
			( w ) => ! exceptSet.has( w.id ),
		);

		doAction( HOOKS.WINDOWS_BEFORE_CLOSE_ALL, { candidates: initialCandidates } );

		const filtered = applyFilters< Window[], [] >(
			HOOKS.WINDOWS_CLOSE_ALL,
			initialCandidates,
		);
		const finalList = Array.isArray( filtered ) ? filtered : initialCandidates;
		const skipped = initialCandidates.filter( ( w ) => ! finalList.includes( w ) );

		let closed = 0;
		const refused: Window[] = [];

		for ( const win of finalList.slice() ) {
			try {
				win.close();
				if ( win._isDestroyed || win._closePending ) {
					closed++;
				} else {
					refused.push( win );
				}
			} catch ( err ) {
				refused.push( win );
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] closeAll: window.close() threw for',
						win.id,
						err,
					);
				}
			}
		}

		doAction( HOOKS.WINDOWS_AFTER_CLOSE_ALL, { closed, skipped, refused } );

		return closed;
	}

	public minimizeAll(): Window[] {
		const minimized: Window[] = [];
		for ( const win of this._stack.slice() ) {
			const winDesktop = win.config.desktopId || this._activeDesktopId;
			if ( winDesktop !== this._activeDesktopId ) {
				continue;
			}
			if ( win.state === 'minimized' ) {
				continue;
			}
			try {
				win.minimize();
				minimized.push( win );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] minimizeAll: window.minimize() threw for',
						win.id,
						err,
					);
				}
			}
		}
		return minimized;
	}

	public restoreFrom( windows: Window[] ): void {
		if ( ! Array.isArray( windows ) ) {
			return;
		}
		const live = new Set( this._stack );
		for ( const win of windows ) {
			if ( ! live.has( win ) ) {
				continue;
			}
			const winDesktop = win.config.desktopId || this._activeDesktopId;
			if ( winDesktop !== this._activeDesktopId ) {
				continue;
			}
			if ( win.state !== 'minimized' ) {
				continue;
			}
			try {
				win.restore();
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] restoreFrom: window.restore() threw for',
						win.id,
						err,
					);
				}
			}
		}
	}

	public toggleShowDesktop(): boolean {
		const all = this._stack.filter(
			( w ) => ( w.config.desktopId || this._activeDesktopId ) === this._activeDesktopId,
		);
		if ( all.length === 0 ) {
			return false;
		}
		const allMinimized = all.every( ( w ) => w.state === 'minimized' );
		if ( allMinimized ) {
			for ( const win of all ) {
				try {
					win.restore();
				} catch {

				}
			}
			return false;
		}
		this.minimizeAll();
		return true;
	}

	public cascade(): void {
		cascade( this );
	}
	public tile(): void {
		tile( this );
	}
	public columns(): void {
		columns( this );
	}
	public focusLayout(): void {
		focusLayout( this );
	}
	public isSnapEnabled(): boolean {
		return this._snapEnabled;
	}
	public setSnapEnabled( enabled: boolean ): void {
		setSnapEnabled( this, enabled );
	}
	public getSnapConfig(): { enabled: boolean; cellWidth: number; cellHeight: number } {
		return getSnapConfig( this );
	}

	public openWindowsAs: () => 'default' | 'maximized' | 'focused' = () => 'default';

	public enterOverview(): void {
		if ( isMobileStamped() ) {
			document.dispatchEvent( new CustomEvent( 'os-mobile-open-switcher' ) );
			return;
		}
		enterOverview( this );
	}
	public exitOverview( selected?: Window, maximize = false ): void {
		exitOverview( this, selected, maximize );
	}

	public destroy(): void {
		this._unsubscribeWorkArea();
		this._uninstallSnapPartnerReflow();
		this.desktopResizeObserver?.disconnect();
		if ( this._reflowRestoreTimer !== null ) {
			window.clearTimeout( this._reflowRestoreTimer );
			this._reflowRestoreTimer = null;
		}
		if ( this._overviewActive ) {
			exitOverview( this );
		}
		this.discardPrewarmed();
		cancelOverviewTimers( this );
		destroyDesktopNameHud();
	}

	public getVisibleRects(): VisibleWindowRect[] {
		return this._stack.map( ( w ) => {
			const snap = w.getSnapshot();
			return {
				windowId: w.id,
				rect: {
					x: snap.x,
					y: snap.y,
					width: snap.width,
					height: snap.height,
				},
				state: snap.state,
				element: w.element,
			};
		} );
	}

	private sanitizeParams(
		params: Record< string, unknown >,
	): Record< string, string | number | boolean > | undefined {
		const out: Record< string, string | number | boolean > = {};
		for ( const [ key, value ] of Object.entries( params ) ) {
			if (
				typeof value === 'string' ||
				typeof value === 'boolean' ||
				( typeof value === 'number' && Number.isFinite( value ) )
			) {
				out[ key ] = value;
			}
		}
		return Object.keys( out ).length > 0 ? out : undefined;
	}

	public snapshot(): Session {
		const focused = this.getFocused();

		const persistable = this._stack.filter(
			( w ) => ! w.config.ephemeral && ! w.config.parentWindowId,
		);
		const windows: SessionWindow[] = persistable.map( ( w ) => {
			const snap = w.getSnapshot();
			const externalTabs = w.getExternalTabsSnapshot();
			const native = !! w.config.native;

			const openParams = w.config.params;
			const params =
				native && openParams
					? this.sanitizeParams( openParams )
					: null;
			return {
				id: w.id,
				baseId: w.config.baseId || w.id,
				desktopId: w.config.desktopId || this._activeDesktopId,
				...( native ? { native: true } : {} ),

				...( params ? { params } : {} ),

				url: native ? w.config.url || `#${ w.id }` : w.getCurrentUrl(),
				title: w.config.title,
				icon: w.config.icon,
				state: snap.state,
				x: snap.x,
				y: snap.y,
				width: snap.width,
				height: snap.height,
				...( externalTabs.length > 0 ? { externalTabs } : {} ),

				...( w._gridSpan ? { gridSpan: { ...w._gridSpan } } : {} ),
			};
		} );

		const focusedId =
			focused &&
			! focused.config.ephemeral &&
			! focused.config.parentWindowId
				? focused.id
				: '';

		const session: Session = {
			windows,
			desktops: this.getDesktops(),
			activeDesktop: this._activeDesktopId,
			focused: focusedId,

			updated: Date.now(),
		};

		const filtered = applyFilters< Session >( HOOKS.SESSION_SNAPSHOT, session );
		return filtered && Array.isArray( filtered.windows ) ? filtered : session;
	}

	public seedWindowRestoreState(
		entries: Record< string, Partial< WindowConfig > >,
		opts: { reserveIds?: boolean } = {},
	): void {
		this._pendingRestoreState = new Map( Object.entries( entries ) );
		this._reservedRestoreIds = opts.reserveIds
			? new Set( Object.keys( entries ) )
			: new Set();
	}

	public discardWindowRestoreState( id?: string ): void {
		if ( id ) {
			this._pendingRestoreState.delete( id );
			this._reservedRestoreIds.delete( id );
			return;
		}
		this._pendingRestoreState.clear();
		this._reservedRestoreIds.clear();
	}

	public seedDesktops( desktops: Desktop[], activeDesktopId: string ): void {
		seedDesktops( this, desktops, activeDesktopId );
	}
}
