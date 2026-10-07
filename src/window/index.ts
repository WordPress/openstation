import type { DragGesture, GridSpan, WindowConfig, WindowState } from './../types';
import { activity } from './../activity';
import { getSyntheticIframe } from './../connection';
import { HOOKS, applyFilters, doAction } from './../hooks';
import { isMobileStamped } from '../mode/stamp';
import { workAreaRectOf } from '../work-area';
import { snapHalfRect } from '../window-manager/geometry';
import { __, _x, sprintf } from './../i18n';
import { attachTooltip } from '../ui/components/os-tooltip/os-tooltip';
import {
	addParentSubscriber,
	clearWindowChannels,
	dispatchToNative,
	enqueueWindowSend,
	isWindowContentReady,
	markWindowContentLoading,
	markWindowContentReady,
	type WindowChannelCb,
} from './../window-channels';

import { _buildNativeRenderContext } from './../native-windows';
import {
	createWindowElement,
	updateFullscreenBodyClass,
	withChromelessParam,
} from './dom';
import {
	adoptPageTitle,
	handleFinishedScreenHandoff,
	handleWindowMessage,
} from './iframe-bridge';
import { noteFrameLoaded } from '../plugin-presence';
import {
	buttonsForWindow,
	subscribeTitleBarButtons,
	type TitleBarButtonDef,
} from './../title-bar-buttons/registry';
import { paintTitleBarButtonIcon } from './../title-bar-buttons/paint-icon';
import {
	applyWindowTheme,
	clearWindowTheme,
} from './../window-chrome/apply';
import { subscribeWindowThemes } from './../window-chrome/themes/registry';
import { subscribeWindowControls } from './../window-chrome/controls/registry';
import { paintWindowControls } from './../window-chrome/controls/render';
import { paintThemedControlIcon } from './../window-chrome/controls/paint-themed-icon';
import { renderIcon } from '../icon';
import { slotForTileId } from '../desktop-themes/slots';
import { subscribeWindowSlots } from './../window-chrome/slots/registry';
import { paintWindowSlots } from './../window-chrome/slots/render';
import {
	subscribeWindowChromes,
	type ChromeRenderHandle,
} from './../window-chrome/chrome/registry';
import {
	captureChromeState,
	CUSTOM_CHROME_CLASS,
	mountWindowChrome,
	resolveChromeId,
	STANDARD_CHROME_ID,
} from './../window-chrome/chrome/apply';

const INITIAL_ORIGIN = window.location.origin;

const OPENING_ANIMATION_NAME = 'os-window-open';

const OPENING_FALLBACK_MS = 300;

import {
	activatePanelTab,
	addExternalTab,
	externalTabCount,
	externalTabsSnapshot,
	handleTabStripClick,
	handleTabStripKeydown,
	observeTabOverflow,
	setPanelTabs,
	syncActiveTab,
} from './tabs';
import type { PanelTabEntry } from './tabs';
import {
	closeActionsMenu,
	describeActionsMenu,
	flipMenuItemCheckOptimistically,
	openActionsMenu,
	refreshStartupCheckState,
	toggleActionsMenu,
} from './menus';
import { handleDragStart, handleResizeStart } from './pointer';
import { navigateWithUnsavedGuard } from './unsaved-guard';
import { speculateDocument } from '../pwa/speculate';

function speculateTabDocument( rawUrl: string ): void {
	const os = (
		window as unknown as {
			wp?: {
				os?: {
					getOsSettings?: () => { windowPrewarmEnabled?: boolean };
				};
			};
		}
	).wp?.os;
	if ( ! os?.getOsSettings?.().windowPrewarmEnabled ) {
		return;
	}
	const target = withChromelessParam( rawUrl );
	if ( target ) {
		speculateDocument( target );
	}
}

const TAB_SPECULATE_DWELL_MS = 120;

export type WindowAttentionMode = 'pulse' | 'shake' | 'bounce' | null;

export interface WindowAttentionOptions {

	durationMs?: number;

	intensity?: 'subtle' | 'normal' | 'strong';
}

export class Window {
	public readonly id: string;
	public readonly config: WindowConfig;
	public readonly element: HTMLElement;

	public iframe: HTMLIFrameElement | null;
	public state: WindowState = 'normal';

	public _hasExplicitTitle = false;

	public _reportedLocation: { url: string; src: string } | null = null;

	public _titleBar: HTMLElement;

	public _titleEl: HTMLElement;

	public _activityCount = 0;

	public _activityPhase: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' =
		'idle';

	public _activityError: string | null = null;

	public _activityClearTimer: number | null = null;

	public _activitySavingStartedAt = 0;

	public _activitySettleTimer: number | null = null;

	public _navigationActivity: 'none' | 'pending' | 'settled' = 'none';

	public _navigationActivityTimer: number | null = null;

	public _isDragging = false;

	public _isResizing = false;

	public _isDestroyed = false;

	public _boundOnMessage: ( e: MessageEvent ) => void;

	public _dragOffsetX = 0;

	public _dragOffsetY = 0;

	public _resizeStartX = 0;

	public _resizeStartY = 0;

	public _resizeStartW = 0;

	public _resizeStartH = 0;

	public _savedGeometry: { x: number; y: number; width: number; height: number } | null = null;

	public _gridSpan: GridSpan | null = null;

	public _savedFullscreenState: {
		state: WindowState;
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;

	private _stateBeforeMinimize: WindowState | null = null;

	private _minimizeAnimation: Animation | null = null;

	private _restoreAnimation: Animation | null = null;

	public _externalTabs: Map<
		string,
		{
			tabEl: HTMLElement;
			iframe: HTMLIFrameElement;
			url: string;
			label: string;
			cancelProbe: () => void;
		}
	> = new Map();

	public _externalTabSeq = 0;

	public _titleBarButtonsUnsubscribe: ( () => void ) | null = null;

	public _windowThemesUnsubscribe: ( () => void ) | null = null;

	public _windowControlsUnsubscribe: ( () => void ) | null = null;

	public _windowControlsTeardown: ( () => void ) | null = null;

	public _windowSlotsUnsubscribe: ( () => void ) | null = null;

	public _windowSlotsTeardown: ( () => void ) | null = null;

	public _chromeHandle: ChromeRenderHandle | null = null;

	public _chromeId: string = STANDARD_CHROME_ID;

	public _windowChromesUnsubscribe: ( () => void ) | null = null;

	public _nativeRenderTeardown: ( () => void ) | null = null;

	public _nativeRenderCtxDispose: ( () => void ) | null = null;

	public _closeSafetyNetTimer: ReturnType< typeof setTimeout > | null = null;

	private _clearOpeningClassRemoval: ( () => void ) | null = null;

	public _onCloseTransitionEnd: ( ( e: TransitionEvent ) => void ) | null = null;

	public _isFinalized: boolean = false;

	public _iframeBridgeReady: boolean = false;

	public _iframeCloseTimeout: ReturnType< typeof setTimeout > | null = null;

	public _closePending: boolean = false;

	public _unsavedGuardPending: boolean = false;

	public _deferredNavigationCommit: ( () => void ) | null = null;

	public _deferredNavigationTimer: number | null = null;

	public _activeTabId: 'primary' | string = 'primary';

	public onFocusRequest: ( ( win: Window ) => void ) | null = null;
	public onClose: ( ( win: Window ) => void ) | null = null;
	public onMinimize: ( ( win: Window ) => void ) | null = null;

	public onRestore: ( ( win: Window ) => void ) | null = null;

	public onOpenAnother: ( ( win: Window ) => void ) | null = null;

	public onOpenInNewWindow: ( ( win: Window ) => void ) | null = null;

	public onToggleStartup: ( ( win: Window ) => void ) | null = null;

	public snapConfigProvider:
		| ( () => { enabled: boolean; cellWidth: number; cellHeight: number } )
		| null = null;

	public snapPartnerMinWidthProvider:
		| ( ( zone: 'left' | 'right' ) => number )
		| null = null;

	public onDragMove: ( ( win: Window, clientX: number, clientY: number ) => void ) | null = null;

	public onDragEnd: ( ( win: Window ) => boolean ) | null = null;

	public onDragGesture: ( ( win: Window, gesture: DragGesture ) => void ) | null = null;

	public _boundOnDocumentPointerDown: ( ( e: PointerEvent ) => void ) | null = null;

	public _unsubscribeWindowActions: ( () => void ) | null = null;

	public _bodyResizeObserver: ResizeObserver | null = null;

	public _tabOverflowTeardown: ( () => void ) | null = null;

	public _tabSpeculateTimer: number | null = null;

	constructor( config: WindowConfig ) {
		this.id = config.id;
		this.config = config;
		this.element = createWindowElement( config );
		this.iframe = config.native
			? null
			: ( this.element.querySelector( '.os-window__iframe' ) as HTMLIFrameElement );
		this._titleBar = this.element.querySelector( '.os-window__titlebar' ) as HTMLElement;
		this._titleEl = this.element.querySelector( '.os-window__title' ) as HTMLElement;
		this._boundOnMessage = ( e: MessageEvent ) => handleWindowMessage( this, e );

		this.bindEvents();
		if ( this.iframe ) {
			this._wireContentFocusForwarder( this.iframe );
		}

		this.renderCustomTitleBarButtons();
		this._titleBarButtonsUnsubscribe = subscribeTitleBarButtons( () => {
			this.renderCustomTitleBarButtons();
		} );

		applyWindowTheme( this, this.config.appearance?.theme );
		this._windowThemesUnsubscribe = subscribeWindowThemes( () => {
			if ( this._isDestroyed ) {
				return;
			}
			applyWindowTheme( this, this.config.appearance?.theme );
		} );

		this.repaintWindowControls();
		this._windowControlsUnsubscribe = subscribeWindowControls( () => {
			if ( this._isDestroyed ) {
				return;
			}
			this.repaintWindowControls();
		} );

		this.repaintWindowSlots();
		this._windowSlotsUnsubscribe = subscribeWindowSlots( () => {
			if ( this._isDestroyed ) {
				return;
			}
			this.repaintWindowSlots();
		} );

		this.remountWindowChrome();
		this._windowChromesUnsubscribe = subscribeWindowChromes( () => {
			if ( this._isDestroyed ) {
				return;
			}

			const next = resolveChromeId( this );
			if ( next !== this._chromeId ) {
				this.remountWindowChrome();
			}
		} );

		this._bodyResizeObserver = this.installBodyResizeObserver();

		if ( config.initialState === 'minimized' ) {
			this.state = 'minimized';
			this.element.classList.add( 'os-window--minimized' );
			if ( this.iframe ) {
				this.iframe.style.visibility = 'hidden';
			}

			this.element.style.setProperty( 'content-visibility', 'hidden' );
			return;
		}

		if (
			config.initialState === 'snapped-left' ||
			config.initialState === 'snapped-right'
		) {
			this.element.classList.add(
				`os-window--${ config.initialState }`,
			);
		}

		if ( ! document.hidden ) {
			this.element.classList.add( 'os-window--opening' );
			this._armOpeningClassRemoval();
		}

		if ( config.initialState && config.initialState !== 'normal' ) {
			requestAnimationFrame( () => this.applyInitialState( config.initialState! ) );
		}
	}

	private _armOpeningClassRemoval(): void {
		const el = this.element;
		let timer: number | null = null;
		let cleared = false;

		const clear = (): void => {
			if ( cleared ) {
				return;
			}
			cleared = true;
			this._clearOpeningClassRemoval = null;

			if ( timer !== null ) {
				window.clearTimeout( timer );
				timer = null;
			}
			el.removeEventListener( 'animationend', onAnimationDone );
			el.removeEventListener( 'animationcancel', onAnimationDone );
			el.classList.remove( 'os-window--opening' );
		};

		const onAnimationDone = ( event: AnimationEvent ): void => {
			if (
				event.target !== el ||
				event.animationName !== OPENING_ANIMATION_NAME
			) {
				return;
			}
			clear();
		};

		el.addEventListener( 'animationend', onAnimationDone );
		el.addEventListener( 'animationcancel', onAnimationDone );
		timer = window.setTimeout( () => {
			timer = null;
			clear();
		}, OPENING_FALLBACK_MS );
		this._clearOpeningClassRemoval = clear;
	}

	public hydrateNative(): void {
		if ( ! this.config.native || ! this.config.render ) {
			return;
		}
		const rawBody = this.element.querySelector(
			'.os-window__body',
		) as HTMLElement | null;
		if ( ! rawBody ) {
			return;
		}

		const filtered = applyFilters(
			HOOKS.NATIVE_WINDOW_BEFORE_RENDER,
			rawBody,
			{ windowId: this.id, config: this.config },
		);
		const body = filtered instanceof HTMLElement ? filtered : rawBody;

		const { ctx, dispose } = _buildNativeRenderContext(
			this.id,
			this.config.params ?? {},
		);
		this._nativeRenderCtxDispose = dispose;

		const maybeTeardown = this.config.render( body, ctx );

		const captureTeardown = ( v: unknown ): void => {
			if ( typeof v === 'function' ) {
				this._nativeRenderTeardown = v as () => void;
			}
		};

		if ( maybeTeardown instanceof Promise ) {
			maybeTeardown.then(
				( resolved ) => {
					if ( this._isDestroyed ) {
						return;
					}
					captureTeardown( resolved );
					markWindowContentReady( this.id );
				},
				( err ) => {
					if ( typeof console !== 'undefined' ) {
						console.error(
							`[openstation] native render rejected for "${ this.id }":`,
							err,
						);
					}
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'window-open',
						id: this.id,
						error: err,
					} );
					if ( this._isDestroyed ) {
						return;
					}
					markWindowContentReady( this.id );
				},
			);
		} else {
			captureTeardown( maybeTeardown );

			requestAnimationFrame( () => {
				if ( this._isDestroyed ) {
					return;
				}
				markWindowContentReady( this.id );
			} );
		}

		doAction( HOOKS.NATIVE_WINDOW_AFTER_RENDER, {
			windowId: this.id,
			body,
			config: this.config,
		} );

		const autofocus = this.config.autofocus;
		if ( autofocus ) {
			requestAnimationFrame( () => {
				if ( this._isDestroyed ) {
					return;
				}
				if ( typeof autofocus === 'string' ) {
					const target = body.querySelector< HTMLElement >(
						autofocus,
					);
					target?.focus();
					return;
				}
				const hadTabIndex = body.hasAttribute( 'tabindex' );
				if ( ! hadTabIndex ) {
					body.tabIndex = -1;
				}
				body.focus();
			} );
		}
	}

	private applyInitialState( state: WindowState ): void {
		if ( state === 'minimized' ) {
			this.minimize();
		} else if ( state === 'maximized' ) {
			this.toggleMaximize();
		} else if ( state === 'fullscreen' ) {
			this.toggleFullscreen();
		} else if ( state === 'snapped-left' ) {
			this.applySnap( 'left' );
		} else if ( state === 'snapped-right' ) {
			this.applySnap( 'right' );
		}
	}

	public _emitChange( reason: 'moved' | 'resized' | 'state' ): void {
		if ( reason === 'state' ) {
			this._gridSpan = null;
		}
		document.dispatchEvent(
			new CustomEvent( 'os-window-changed', {
				detail: { windowId: this.id, reason, state: this.state },
			} ),
		);
	}

	private snapGeometry( g: { x: number; y: number; width: number; height: number } ): {
		x: number;
		y: number;
		width: number;
		height: number;
	} {
		const snap = this.snapConfigProvider?.();
		if ( ! snap || ! snap.enabled ) {
			return g;
		}
		const width = Math.max(
			this.config.minWidth,
			Math.round( g.width / snap.cellWidth ) * snap.cellWidth,
		);
		const height = Math.max(
			this.config.minHeight,
			Math.round( g.height / snap.cellHeight ) * snap.cellHeight,
		);
		return {
			x: Math.round( g.x / snap.cellWidth ) * snap.cellWidth,
			y: Math.round( g.y / snap.cellHeight ) * snap.cellHeight,
			width,
			height,
		};
	}

	public getCurrentUrl(): string {
		if ( ! this.iframe ) {
			return this.config.url || `#${ this.id }`;
		}
		try {
			const href = this.iframe.contentWindow?.location.href;
			if ( href && href !== 'about:blank' ) {
				return href;
			}
		} catch {
			const reported = this._reportedLocation;
			if ( reported && reported.src === this.iframe.src ) {
				return reported.url;
			}
		}
		return this.iframe.src;
	}

	private bindEvents(): void {
		this.element.addEventListener( 'pointerdown', () => {
			if ( this.element.classList.contains( 'os-window--overview' ) ) {
				return;
			}
			this.onFocusRequest?.( this );
		} );

		this.element.addEventListener( 'focusin', () => {
			if ( this.element.classList.contains( 'os-window--overview' ) ) {
				return;
			}
			this.onFocusRequest?.( this );
		} );

		this._titleBar.addEventListener( 'pointerdown', ( e: PointerEvent ) =>
			handleDragStart( this, e ),
		);

		const resizeHandles = this.element.querySelectorAll<HTMLElement>(
			'.os-window__resize-handle',
		);
		resizeHandles.forEach( ( handle ) => {
			handle.addEventListener( 'pointerdown', ( e: PointerEvent ) =>
				handleResizeStart( this, e ),
			);
		} );

		const menuBtn = this.element.querySelector<HTMLElement>(
			'.os-window__menu-btn',
		);
		const menuPanel = this.element.querySelector<HTMLElement>(
			'.os-window__menu-panel',
		);
		if ( menuBtn && menuPanel ) {
			menuBtn.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				toggleActionsMenu( this );
			} );

			attachTooltip( menuBtn, () => ( {
				heading: __( 'Window actions' ),
				text: describeActionsMenu( this ).reduce( ( list, label ) =>
					list
						? sprintf(

							_x( '%1$s, %2$s', 'list of menu item names' ),
							list,
							label,
						)
						: label,
				'' ),
			} ) );
			const openAnother = menuPanel.querySelector(
				'.os-window__menu-item--open-another',
			);
			if ( openAnother ) {
				openAnother.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.onOpenAnother?.( this );
				} );
			}
			const openInNew = menuPanel.querySelector(
				'.os-window__menu-item--open-in-new-window',
			);
			if ( openInNew ) {
				openInNew.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.onOpenInNewWindow?.( this );
				} );
			}

			const reload = menuPanel.querySelector(
				'.os-window__menu-item--reload',
			);
			if ( reload ) {
				reload.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.reload();
				} );
			}
			const openExternal = menuPanel.querySelector(
				'.os-window__menu-item--open-external',
			);
			if ( openExternal ) {
				openExternal.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					closeActionsMenu( this );
					this.detach();
				} );
			}

			const startup = menuPanel.querySelector<HTMLElement>(
				'.os-window__menu-item--startup',
			);
			if ( startup ) {
				refreshStartupCheckState( this, startup );

				startup.addEventListener( 'os-menu-item-click', ( e: Event ) => {
					e.stopPropagation();
					flipMenuItemCheckOptimistically( startup );
					this.onToggleStartup?.( this );
				} );

				document.addEventListener(
					'os-default-window-changed',
					() => {
						refreshStartupCheckState( this, startup );
					},
				);
			}

			menuPanel.addEventListener( 'keydown', ( e: Event ) => {
				const kev = e as KeyboardEvent;
				if ( kev.key === 'Escape' ) {
					e.stopPropagation();
					closeActionsMenu( this );
					menuBtn.focus();
				}
			} );
		}

		this._titleBar.addEventListener( 'dblclick', ( e: MouseEvent ) => {
			const target = e.target as Element | null;
			if (
				target?.closest(
					'button, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], os-window-button, os-menu, os-menu-item, .os-window__menu-panel, .os-window__custom-buttons, input, select, textarea, a',
				)
			) {
				return;
			}

			if ( isMobileStamped() ) {
				return;
			}
			this.toggleMaximize();
		} );

		const tabs = this.element.querySelector< HTMLElement >(
			'.os-window__tabs',
		);
		if ( tabs ) {
			tabs.addEventListener( 'click', ( e: Event ) =>
				handleTabStripClick( this, e ),
			);

			tabs.addEventListener( 'keydown', ( e: Event ) =>
				handleTabStripKeydown( tabs, e ),
			);

			tabs.addEventListener( 'pointerover', ( e: Event ) => {
				const ev = e as PointerEvent;
				if ( ev.pointerType !== 'mouse' ) {
					return;
				}
				const tab = ( ev.target as HTMLElement | null )?.closest?.(
					'.os-window__tab[data-url]',
				) as HTMLElement | null;
				const href = tab?.dataset.url;
				if ( ! href ) {
					return;
				}

				if ( tab?.classList.contains( 'is-active' ) ) {
					return;
				}

				if ( this._tabSpeculateTimer ) {
					window.clearTimeout( this._tabSpeculateTimer );
				}
				this._tabSpeculateTimer = window.setTimeout( () => {
					this._tabSpeculateTimer = null;
					speculateTabDocument( href );
				}, TAB_SPECULATE_DWELL_MS );
			} );
			tabs.addEventListener( 'pointerleave', () => {
				if ( this._tabSpeculateTimer ) {
					window.clearTimeout( this._tabSpeculateTimer );
					this._tabSpeculateTimer = null;
				}
			} );

			this._tabOverflowTeardown = observeTabOverflow( tabs );
		}

		if ( this.iframe ) {
			const iframe = this.iframe;

			this._wireTabNavSync( iframe );

			window.addEventListener( 'message', this._boundOnMessage );
		}
	}

	public addExternalTab( url: string, label: string ): void {
		addExternalTab( this, url, label );
	}

	public setTabs(
		entries: readonly PanelTabEntry[],
		activeValue?: string,
	): void {
		setPanelTabs( this.element, entries, activeValue );
	}

	public activateTab( value: string ): void {
		activatePanelTab( this.element, value );
	}

	public setZIndex( z: number ): void {
		this.element.style.zIndex = String( z );
	}

	public setFocused( focused: boolean ): void {
		this.element.classList.toggle( 'os-window--focused', focused );
		this._notifyChromeStateChanged();
	}

	public setTitle( title: string ): void {
		const titleEl = this.element.querySelector< HTMLElement >(
			'.os-window__title',
		);
		if ( titleEl ) {
			this._titleEl = titleEl;
			titleEl.textContent = title;
		}
		this.config.title = title;
		doAction( HOOKS.WINDOW_TITLE_CHANGED, { windowId: this.id, title } );
		this._notifyChromeStateChanged();
	}

	public repaintWindowControls(): void {
		const controlsHost = this.element.querySelector< HTMLElement >(
			'.os-window__controls',
		);
		if ( ! controlsHost ) {
			return;
		}
		if ( this._windowControlsTeardown ) {
			try {
				this._windowControlsTeardown();
			} catch {

			}
			this._windowControlsTeardown = null;
		}
		this._windowControlsTeardown = paintWindowControls( this, controlsHost );
	}

	public repaintThemedChrome(): void {
		const iconHost = this.element.querySelector< HTMLElement >(
			'.os-window__slot--icon',
		);
		if ( iconHost ) {
			const existing = iconHost.querySelector(
				'.os-window__icon',
			);
			if ( existing ) {
				existing.replaceWith(
					renderIcon( this.config.icon, {
						title: this.config.title,
						className: 'os-window__icon',
						slot: slotForTileId( this.config.id ),
					} ),
				);
			}
		}

		const menuBtn = this.element.querySelector< HTMLElement >(
			'.os-window__menu-btn',
		);
		if ( menuBtn ) {
			menuBtn
				.querySelectorAll( ':scope > .dashicons' )
				.forEach( ( el ) => el.remove() );
			menuBtn.removeAttribute( 'icon-src' );
			menuBtn.setAttribute( 'icon', 'menu' );
			paintThemedControlIcon( menuBtn, 'core/menu' );
		}
	}

	public setAppearanceControls(
		override: import( '../types' ).WindowControlsConfig | null | undefined,
	): void {
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			controls: override ?? undefined,
		};
		this.repaintWindowControls();
	}

	public repaintWindowSlots(): void {
		if ( this._windowSlotsTeardown ) {
			try {
				this._windowSlotsTeardown();
			} catch {

			}
			this._windowSlotsTeardown = null;
		}
		this._windowSlotsTeardown = paintWindowSlots( this );
	}

	public remountWindowChrome(): void {
		if ( this._chromeHandle ) {
			try {
				this._chromeHandle.destroy();
			} catch {

			}
			this._chromeHandle = null;
		}

		this.element.classList.remove( CUSTOM_CHROME_CLASS );
		const mounted = mountWindowChrome( this );
		if ( mounted ) {
			this._chromeHandle = mounted.handle;
			this._chromeId = mounted.id;
		} else {
			this._chromeId = STANDARD_CHROME_ID;
		}
	}

	public setAppearanceChrome( chromeId: string | null | undefined ): void {
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			chrome: chromeId ?? undefined,
		};
		this.remountWindowChrome();
	}

	public _notifyChromeStateChanged(): void {
		if ( this._isDestroyed ) {
			return;
		}
		if ( ! this._chromeHandle?.update ) {
			return;
		}
		try {
			this._chromeHandle.update( captureChromeState( this ) );
		} catch {

		}
	}

	public setAppearanceSlot(
		slot: import( '../types' ).WindowSlotName,
		config: import( '../types' ).WindowSlotConfig | undefined,
	): void {
		const existing = this.config.appearance?.slots ?? {};
		const next = { ...existing };
		if ( config === undefined ) {
			delete next[ slot ];
		} else {
			next[ slot ] = config;
		}
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			slots: next,
		};
		this.repaintWindowSlots();
	}

	public setAppearanceTheme(
		override:
			| import( '../types' ).WindowThemeRef
			| Record< string, string >
			| string
			| null
			| undefined,
	): void {
		let resolved: import( '../types' ).WindowThemeRef | undefined;
		if ( override === null || override === undefined ) {
			resolved = undefined;
		} else if ( typeof override === 'string' ) {
			resolved = { themeId: override };
		} else if (
			typeof override === 'object' &&
			(
				'themeId' in override ||
				'tokens' in override
			)
		) {
			resolved = override as import( '../types' ).WindowThemeRef;
		} else if ( typeof override === 'object' ) {
			resolved = { tokens: override as Record< string, string > };
		}
		this.config.appearance = {
			...( this.config.appearance ?? {} ),
			theme: resolved,
		};
		applyWindowTheme( this, resolved );
	}

	public applySnap( zone: 'left' | 'right' ): void {
		if ( ! this._applySnapVisuals( zone ) ) {
			return;
		}
		this.state = zone === 'left' ? 'snapped-left' : 'snapped-right';
		this._emitChange( 'state' );
	}

	public snapTo( zone: 'left' | 'right' ): void {
		if ( this.state === 'normal' ) {
			this._savedGeometry = {
				x: this.element.offsetLeft,
				y: this.element.offsetTop,
				width: this.element.offsetWidth,
				height: this.element.offsetHeight,
			};
		}
		this.applySnap( zone );
	}

	private _applySnapVisuals( zone: 'left' | 'right' ): boolean {
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return false;
		}

		const rect = snapHalfRect(
			workAreaRectOf( parent ),
			zone,
			this.config.minWidth || 0,
			this.snapPartnerMinWidthProvider?.( zone ) ?? 0,
		);
		this.element.classList.remove(
			'os-window--maximized',
			'os-window--fullscreen',
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		this.element.classList.add( `os-window--snapped-${ zone }` );
		this.element.style.left = `${ rect.x }px`;
		this.element.style.top = `${ rect.y }px`;
		this.element.style.width = `${ rect.width }px`;
		this.element.style.height = `${ rect.height }px`;
		return true;
	}

	public unsnap(): void {
		if ( ! this.isSnapped() ) {
			return;
		}
		this.element.classList.remove(
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		const parent = this.element.parentElement;
		if ( parent ) {
			const area = workAreaRectOf( parent );
			const saved = this._savedGeometry;
			const width = saved?.width ?? Math.min( 960, Math.round( area.width * 0.6 ) );
			const height = saved?.height ?? Math.min( 640, Math.round( area.height * 0.7 ) );
			const x = saved?.x ?? area.x + Math.round( ( area.width - width ) / 2 );
			const y = saved?.y ?? area.y + Math.round( ( area.height - height ) / 2 );
			this.element.style.left = `${ x }px`;
			this.element.style.top = `${ y }px`;
			this.element.style.width = `${ width }px`;
			this.element.style.height = `${ height }px`;
		}
		this.state = 'normal';
		this._emitChange( 'state' );
	}

	public isMinimized(): boolean {
		return this.state === 'minimized';
	}

	public isMaximized(): boolean {
		return this.state === 'maximized';
	}

	public isFullscreen(): boolean {
		return this.state === 'fullscreen';
	}

	public isSnapped( side?: 'left' | 'right' ): boolean {
		if ( side === 'left' ) {
			return this.state === 'snapped-left';
		}
		if ( side === 'right' ) {
			return this.state === 'snapped-right';
		}
		return (
			this.state === 'snapped-left' || this.state === 'snapped-right'
		);
	}

	public isFocused(): boolean {
		return this.element.classList.contains( 'os-window--focused' );
	}

	private _prefersReducedMotion(): boolean {
		try {
			return window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		} catch {
			return false;
		}
	}

	private _getDockTarget(): HTMLElement | null {
		const candidates: string[] = [];
		const push = ( v: string | undefined ): void => {
			if ( typeof v === 'string' && v !== '' && ! candidates.includes( v ) ) {
				candidates.push( v );
			}
		};
		push( this.id );
		push( this.config.baseId );

		for ( const id of candidates ) {
			let esc = id;
			try {
				if ( typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ) {
					esc = CSS.escape( id );
				}
			} catch {
				esc = id;
			}
			const selectors = [
				`.os-dock__item[data-os-window-base-id="${ esc }"] .os-dock__item-primary`,
				`.os-dock__item[data-os-window-base-id="${ esc }"]`,
				`.os-dock__item[data-menu-slug="${ esc }"] .os-dock__item-primary`,
				`.os-dock__item[data-system-id="${ esc }"] .os-dock__item-primary`,
				`.os-dock__item[data-nav-id="${ esc }"] .os-dock__item-primary`,
				`.os-dock__item[data-menu-slug="${ esc }"]`,
				`.os-dock__item[data-system-id="${ esc }"]`,
				`.os-dock__item[data-nav-id="${ esc }"]`,
			];
			for ( const sel of selectors ) {
				const el = document.querySelector< HTMLElement >( sel );
				if ( el ) {
					const rect = el.getBoundingClientRect();
					if ( rect.width > 0 && rect.height > 0 ) {
						return el;
					}
				}
			}
		}

		const systemSelectors = [
			'.os-dock__item[data-os-window-base-id="os-system"] .os-dock__item-primary',
			'.os-dock__item[data-system-id="os-system"] .os-dock__item-primary',
			'.os-dock__item[data-os-window-base-id="os-system"]',
			'.os-dock__item[data-system-id="os-system"]',
		];
		if (
			this.id === 'desktop-mode-os-settings' ||
			this.id === 'os-settings' ||
			this.config.baseId === 'desktop-mode-os-settings'
		) {
			for ( const sel of systemSelectors ) {
				const el = document.querySelector< HTMLElement >( sel );
				if ( el ) {
					const rect = el.getBoundingClientRect();
					if ( rect.width > 0 && rect.height > 0 ) {
						return el;
					}
				}
			}
		}

		const dock =
			document.querySelector< HTMLElement >( '#os-dock' ) ??
			document.querySelector< HTMLElement >( '.os-dock' );
		if ( dock ) {
			const rect = dock.getBoundingClientRect();
			if ( rect.width > 0 && rect.height > 0 ) {
				return dock;
			}
		}
		return null;
	}

	private _clearGenieStyles(): void {
		this.element.style.removeProperty( 'will-change' );
		this.element.style.removeProperty( 'transform' );
		this.element.style.removeProperty( 'opacity' );
	}

	private _cancelGenieAnimation( which: 'minimize' | 'restore' ): void {
		const isMinimize = which === 'minimize';
		const anim = isMinimize ? this._minimizeAnimation : this._restoreAnimation;
		if ( ! anim ) {
			return;
		}
		try {
			anim.cancel();
		} catch {

		}
		if ( isMinimize ) {
			this._minimizeAnimation = null;
			this.element.classList.remove( 'os-window--minimizing' );
		} else {
			this._restoreAnimation = null;
			this.element.classList.remove( 'os-window--restoring' );
		}
		this._clearGenieStyles();
	}

	private _buildGenieTransform(
		winRect: DOMRect,
		dockRect: DOMRect,
		maxScale: number,
	): { dx: number; dy: number; scale: number } {
		const dx =
			( dockRect.left + dockRect.width / 2 ) -
			( winRect.left + winRect.width / 2 );
		const dy =
			( dockRect.top + dockRect.height / 2 ) -
			( winRect.top + winRect.height / 2 );
		const rawScale = Math.min(
			dockRect.width / winRect.width,
			dockRect.height / winRect.height,
		);
		return { dx, dy, scale: Math.max( 0.06, Math.min( rawScale, maxScale ) ) };
	}

	private _canGenieAnimate( dockTarget: HTMLElement | null ): dockTarget is HTMLElement {
		return (
			!! dockTarget &&
			! this._prefersReducedMotion() &&
			typeof this.element.animate === 'function' &&
			! document.hidden &&
			! this.element.classList.contains( 'os-window--overview' )
		);
	}

	private _installMinimizeContentVisibilityGuard(): void {
		const applyHidden = (): void => {
			if (
				this.state === 'minimized' &&
				! this.element.classList.contains( 'os-window--overview' )
			) {
				if ( this.iframe ) {
					this.iframe.style.visibility = 'hidden';
				}
				this.element.style.setProperty( 'content-visibility', 'hidden' );
			}
		};
		applyHidden();
		this.element.addEventListener(
			'transitionend',
			( e: TransitionEvent ) => {
				if ( e.propertyName === 'opacity' ) {
					applyHidden();
				}
			},
			{ once: true },
		);
	}

	public minimize(): void {
		if ( this.state === 'minimized' ) {
			return;
		}

		this._cancelGenieAnimation( 'restore' );
		this._cancelGenieAnimation( 'minimize' );

		this._stateBeforeMinimize = this.state;

		const dockTarget = this._getDockTarget();
		if ( this._canGenieAnimate( dockTarget ) ) {
			const startRect = this.element.getBoundingClientRect();
			const targetRect = dockTarget.getBoundingClientRect();
			const hasGeometry =
				startRect.width > 0 &&
				startRect.height > 0 &&
				targetRect.width > 0 &&
				targetRect.height > 0;

			if ( hasGeometry ) {
				this.state = 'minimized';
				this.element.classList.add( 'os-window--minimizing' );
				this.element.style.willChange = 'transform';

				const { dx, dy, scale } = this._buildGenieTransform( startRect, targetRect, 0.22 );

				let anim: Animation | null = null;
				try {
					anim = this.element.animate(
						[
							{ transform: 'translate(0px, 0px) scale(1)', opacity: 1 },

							{
								offset: 0.6,
								transform: `translate(${ dx * 0.6 }px, ${ dy * 0.6 }px) scale(${ 1 - ( 1 - scale ) * 0.6 })`,
								opacity: 1,
							},
							{
								transform: `translate(${ dx }px, ${ dy }px) scale(${ scale })`,
								opacity: 0,
							},
						],
						{
							duration: 480,
							easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
							fill: 'forwards',
						},
					);
				} catch {
					anim = null;
				}

				if ( anim ) {
					this._minimizeAnimation = anim;
					anim.onfinish = (): void => {
						if ( this._minimizeAnimation !== anim ) {
							return;
						}
						this._minimizeAnimation = null;
						this.element.classList.add( 'os-window--minimized' );
						this.element.classList.remove( 'os-window--minimizing' );
						this._clearGenieStyles();
						try {
							anim!.cancel();
						} catch {

						}
						this._installMinimizeContentVisibilityGuard();
					};
					anim.oncancel = (): void => {
						if ( this._minimizeAnimation === anim ) {
							this._minimizeAnimation = null;
							this.element.classList.remove( 'os-window--minimizing' );
							this._clearGenieStyles();
						}
					};

					this.onMinimize?.( this );
					this._emitChange( 'state' );
					doAction( HOOKS.WINDOW_MINIMIZED, {
						windowId: this.id,
						element: this.element,
					} );
					if ( this._stateBeforeMinimize === 'fullscreen' ) {
						updateFullscreenBodyClass();
					}
					return;
				}

				this.element.classList.remove( 'os-window--minimizing' );
				this._clearGenieStyles();
			}
		}

		this.state = 'minimized';
		this.element.classList.add( 'os-window--minimized' );
		this._installMinimizeContentVisibilityGuard();

		this.onMinimize?.( this );
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_MINIMIZED, {
			windowId: this.id,
			element: this.element,
		} );

		if ( this._stateBeforeMinimize === 'fullscreen' ) {
			updateFullscreenBodyClass();
		}
	}

	public restore(): void {
		this._cancelGenieAnimation( 'minimize' );
		this._cancelGenieAnimation( 'restore' );

		const wasMinimized = this.state === 'minimized';
		const dockTarget = wasMinimized ? this._getDockTarget() : null;

		if ( wasMinimized && this._canGenieAnimate( dockTarget ) ) {
			this.element.style.removeProperty( 'content-visibility' );
			if ( this.iframe ) {
				this.iframe.style.visibility = '';
			}

			this.element.classList.remove( 'os-window--minimized' );
			this.element.classList.add( 'os-window--restoring' );
			this.element.style.willChange = 'transform';

			const nextState = this._stateBeforeMinimize ?? 'normal';
			this.state = nextState;
			this._stateBeforeMinimize = null;
			if ( nextState === 'fullscreen' ) {
				updateFullscreenBodyClass();
				this.updateFocusButtonState();
			}

			const endRect = this.element.getBoundingClientRect();
			const targetRect = dockTarget.getBoundingClientRect();
			const hasGeometry =
				endRect.width > 0 &&
				endRect.height > 0 &&
				targetRect.width > 0 &&
				targetRect.height > 0;

			if ( hasGeometry ) {
				const { dx, dy, scale } = this._buildGenieTransform( endRect, targetRect, 0.24 );

				let anim: Animation | null = null;
				try {
					anim = this.element.animate(
						[

							{
								transform: `translate(${ dx }px, ${ dy }px) scale(${ scale })`,
								opacity: 0,
							},
							{
								offset: 0.4,
								transform: `translate(${ dx * 0.4 }px, ${ dy * 0.4 }px) scale(${ 1 - ( 1 - scale ) * 0.4 })`,
								opacity: 1,
							},
							{ transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
						],
						{
							duration: 480,
							easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
							fill: 'forwards',
						},
					);
				} catch {
					anim = null;
				}

				if ( anim ) {
					this._restoreAnimation = anim;
					const cleanup = (): void => {
						if ( this._restoreAnimation !== anim ) {
							return;
						}
						this._restoreAnimation = null;
						this.element.classList.remove( 'os-window--restoring' );
						this._clearGenieStyles();
						try {
							anim!.cancel();
						} catch {

						}
					};
					anim.onfinish = cleanup;
					anim.oncancel = (): void => {
						if ( this._restoreAnimation === anim ) {
							this._restoreAnimation = null;
							this.element.classList.remove( 'os-window--restoring' );
							this._clearGenieStyles();
						}
					};

					this.onRestore?.( this );
					this.onFocusRequest?.( this );
					this._emitChange( 'state' );
					doAction( HOOKS.WINDOW_RESTORED, {
						windowId: this.id,
						element: this.element,
					} );
					return;
				}
			}

			this.element.classList.remove( 'os-window--restoring' );
			this._clearGenieStyles();

			this.onRestore?.( this );
			this.onFocusRequest?.( this );
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_RESTORED, {
				windowId: this.id,
				element: this.element,
			} );
			return;
		}

		this.element.style.removeProperty( 'content-visibility' );
		if ( this.iframe ) {
			this.iframe.style.visibility = '';
		}

		this.element.classList.remove( 'os-window--minimized' );
		if ( wasMinimized ) {
			this.state = this._stateBeforeMinimize ?? 'normal';
			this._stateBeforeMinimize = null;

			if ( this.state === 'fullscreen' ) {
				updateFullscreenBodyClass();
				this.updateFocusButtonState();
			}
		}
		if ( wasMinimized ) {
			this.onRestore?.( this );
		}
		this.onFocusRequest?.( this );
		this._emitChange( 'state' );
		if ( wasMinimized ) {
			doAction( HOOKS.WINDOW_RESTORED, {
				windowId: this.id,
				element: this.element,
			} );
		}
	}

	public maximize(): void {
		if ( this.state === 'maximized' ) {
			return;
		}

		if ( this.state === 'normal' ) {
			this._savedGeometry = {
				x: this.element.offsetLeft,
				y: this.element.offsetTop,
				width: this.element.offsetWidth,
				height: this.element.offsetHeight,
			};
		}
		if ( ! this._applyMaximizeVisuals() ) {
			return;
		}
		this.state = 'maximized';
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_MAXIMIZED, {
			windowId: this.id,
			element: this.element,
		} );
	}

	private _applyMaximizeVisuals(): boolean {
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return false;
		}

		this.element.classList.remove(
			'os-window--fullscreen',
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		this.element.classList.add( 'os-window--maximized' );

		const area = workAreaRectOf( parent );
		this.element.style.left = `${ area.x }px`;
		this.element.style.top = `${ area.y }px`;
		this.element.style.width = `${ area.width }px`;
		this.element.style.height = `${ area.height }px`;
		return true;
	}

	public toggleMaximize(): void {
		const parent = this.element.parentElement;
		if ( ! parent ) {
			return;
		}

		if ( this.state === 'maximized' ) {
			this.element.classList.remove( 'os-window--maximized' );
			if ( this._savedGeometry ) {
				const restored = this.snapGeometry( this._savedGeometry );
				this.element.style.left = `${ restored.x }px`;
				this.element.style.top = `${ restored.y }px`;
				this.element.style.width = `${ restored.width }px`;
				this.element.style.height = `${ restored.height }px`;

				this._savedGeometry = restored;
			}
			this.state = 'normal';
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_UNMAXIMIZED, {
				windowId: this.id,
				element: this.element,
			} );
			return;
		}

		if ( this.state === 'fullscreen' ) {
			this._savedFullscreenState = null;
			this._applyMaximizeVisuals();
			this.state = 'maximized';
			updateFullscreenBodyClass();
			this.updateFocusButtonState();
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_FULLSCREEN_EXITED, {
				windowId: this.id,
				element: this.element,
			} );
			doAction( HOOKS.WINDOW_MAXIMIZED, {
				windowId: this.id,
				element: this.element,
			} );
			return;
		}

		this.maximize();
	}

	public toggleFullscreen(): void {
		if ( this.state === 'fullscreen' ) {
			this.element.classList.remove( 'os-window--fullscreen' );
			const s = this._savedFullscreenState;
			this._savedFullscreenState = null;
			let landedOnMaximize = false;
			if ( s && s.state === 'maximized' ) {
				this._applyMaximizeVisuals();
				this.state = 'maximized';
				landedOnMaximize = true;
			} else if (
				s && ( s.state === 'snapped-left' || s.state === 'snapped-right' )
			) {
				const zone: 'left' | 'right' =
					s.state === 'snapped-left' ? 'left' : 'right';
				this._applySnapVisuals( zone );
				this.state = s.state;
			} else if ( s ) {
				this.element.style.left = `${ s.x }px`;
				this.element.style.top = `${ s.y }px`;
				this.element.style.width = `${ s.width }px`;
				this.element.style.height = `${ s.height }px`;
				this.state = 'normal';
			} else {
				this.state = 'normal';
			}
			updateFullscreenBodyClass();
			this.updateFocusButtonState();
			this._emitChange( 'state' );
			doAction( HOOKS.WINDOW_FULLSCREEN_EXITED, {
				windowId: this.id,
				element: this.element,
			} );
			if ( landedOnMaximize ) {
				doAction( HOOKS.WINDOW_MAXIMIZED, {
					windowId: this.id,
					element: this.element,
				} );
			}
			return;
		}

		if ( this.state === 'normal' ) {
			this._savedGeometry = {
				x: this.element.offsetLeft,
				y: this.element.offsetTop,
				width: this.element.offsetWidth,
				height: this.element.offsetHeight,
			};
		}
		this._savedFullscreenState = {
			state: this.state,
			x: this.element.offsetLeft,
			y: this.element.offsetTop,
			width: this.element.offsetWidth,
			height: this.element.offsetHeight,
		};

		this.element.classList.remove(
			'os-window--maximized',
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		this.element.classList.add( 'os-window--fullscreen' );
		this.state = 'fullscreen';
		updateFullscreenBodyClass();
		this.updateFocusButtonState();
		this._emitChange( 'state' );
		doAction( HOOKS.WINDOW_FULLSCREEN_ENTERED, {
			windowId: this.id,
			element: this.element,
		} );
	}

	private updateFocusButtonState(): void {
		const btn = this.element.querySelector<HTMLButtonElement>(
			'.os-window__btn--focus',
		);
		if ( ! btn ) {
			return;
		}
		const isFullscreen = this.state === 'fullscreen';
		btn.classList.toggle( 'os-window__btn--active', isFullscreen );
		btn.setAttribute( 'aria-pressed', isFullscreen ? 'true' : 'false' );
		btn.setAttribute(
			'aria-label',
			isFullscreen ? __( 'Exit fullscreen' ) : __( 'Enter fullscreen' ),
		);
	}

	public detach(): void {
		const current = this.getCurrentUrl();
		let url: URL;
		try {
			url = new URL( current, INITIAL_ORIGIN );
		} catch {
			return;
		}
		if ( url.origin !== INITIAL_ORIGIN ) {
			return;
		}
		url.searchParams.delete( 'openstation_chromeless' );
		url.searchParams.delete( 'desktop_mode_portal' );
		url.searchParams.set( 'desktop_mode_classic', '1' );

		window.open( url.toString(), '_blank', 'noopener' );
		doAction( HOOKS.WINDOW_DETACHED, { windowId: this.id, url: url.toString() } );
	}

	public reload(): void {
		const body = this.element.querySelector( '.os-window__body' );
		if ( body?.classList.contains( 'os-window__body--loading' ) ) {
			return;
		}

		if ( this._unsavedGuardPending ) {
			return;
		}
		if ( this.config.native ) {
			this._reloadNative();
			return;
		}

		let reloadedUrl: string;
		let triggerReload: () => void;
		if ( this._activeTabId === 'primary' ) {
			if ( ! this.iframe ) {
				return;
			}
			const iframe = this.iframe;
			reloadedUrl = this.getCurrentUrl();
			triggerReload = () => {
				try {
					iframe.contentWindow?.location.reload();
				} catch {
					iframe.src = iframe.src;
				}
			};
		} else {
			const entry = this._externalTabs.get( this._activeTabId );
			if ( ! entry ) {
				return;
			}
			reloadedUrl = entry.url;
			triggerReload = () => {
				try {
					entry.iframe.contentWindow?.location.reload();
				} catch {
					entry.iframe.src = entry.url;
				}
			};
		}

		this._spinReloadButton();
		const commit = (): void => {
			this.markContentLoading();
		};
		const navigate = (): void => {
			triggerReload();
			doAction( HOOKS.WINDOW_RELOADED, {
				windowId: this.id,
				url: reloadedUrl,
			} );
		};

		if ( this._activeTabId === 'primary' ) {
			navigateWithUnsavedGuard( this, { commit, navigate } );
		} else {
			commit();
			navigate();
		}
	}

	private _reloadNative(): void {
		if ( ! this.config.render ) {
			return;
		}
		const body = this.element.querySelector(
			'.os-window__body',
		) as HTMLElement | null;
		if ( ! body ) {
			return;
		}

		if ( this._nativeRenderCtxDispose ) {
			try {
				this._nativeRenderCtxDispose();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-ctx-dispose',
					id: this.id,
					error: err,
				} );
			}
			this._nativeRenderCtxDispose = null;
		}
		if ( this._nativeRenderTeardown ) {
			try {
				this._nativeRenderTeardown();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-teardown',
					id: this.id,
					error: err,
				} );
			}
			this._nativeRenderTeardown = null;
		}

		body.replaceChildren();

		this._spinReloadButton();
		this.markContentLoading();
		this.hydrateNative();
		doAction( HOOKS.WINDOW_RELOADED, {
			windowId: this.id,
			url: this.config.url ?? '',
		} );
	}

	public navigateTo( url: string ): boolean {
		if ( this.config.native || ! this.iframe ) {
			return false;
		}
		const target = withChromelessParam( url );
		if ( ! target ) {
			return false;
		}
		navigateWithUnsavedGuard( this, {
			commit: () => {
				this.markContentLoading();

				syncActiveTab( this, url );
			},
			navigate: () => {
				const inner = this.iframe?.contentWindow;
				if ( inner ) {
					try {
						inner.location.assign( target );
						return;
					} catch {

					}
				}
				if ( this.iframe ) {
					this.iframe.src = target;
				}
			},
		} );
		return true;
	}

	private _wireContentFocusForwarder( iframe: HTMLIFrameElement ): void {
		const attach = (): void => {
			let doc: Document | null = null;
			try {
				doc = iframe.contentDocument;
			} catch {
				return;
			}
			if ( ! doc ) {
				return;
			}
			if ( doc.location && doc.location.pathname.indexOf( '/wp-admin/' ) !== -1 ) {
				return;
			}
			doc.addEventListener(
				'pointerdown',
				() => {
					if (
						this.element.classList.contains(
							'os-window--overview',
						)
					) {
						return;
					}
					this.onFocusRequest?.( this );
				},
				{ capture: true, passive: true },
			);
		};
		iframe.addEventListener( 'load', attach );

		attach();
	}

	private _wireTabNavSync( iframe: HTMLIFrameElement ): void {
		iframe.addEventListener( 'load', () => {
			try {
				const href = iframe.contentWindow?.location.href;
				if ( ! href ) {
					return;
				}

				if ( handleFinishedScreenHandoff( this, href ) ) {
					return;
				}
				adoptPageTitle( this );
				syncActiveTab( this, href );
			} catch {

			}
		} );
	}

	private _swapBuffer: HTMLIFrameElement | null = null;

	private _swapBufferTimer: number | null = null;

	private _discardSwapBuffer(): void {
		if ( this._swapBufferTimer !== null ) {
			window.clearTimeout( this._swapBufferTimer );
			this._swapBufferTimer = null;
		}
		if ( this._swapBuffer ) {
			this._swapBuffer.remove();
			this._swapBuffer = null;
			this.iframe?.classList.remove(
				'os-window__iframe--swap-front',
			);
		}
	}

	public swapReload( url?: string ): void {
		if ( this.config.native || ! this.iframe || this._isDestroyed ) {
			return;
		}
		if ( this._activeTabId !== 'primary' ) {
			this.reload();
			return;
		}
		const target = url ? withChromelessParam( url ) : this.getCurrentUrl();
		if ( ! target ) {
			return;
		}

		this._discardSwapBuffer();

		const current = this.iframe;

		current.classList.add( 'os-window__iframe--swap-front' );
		const buffer = document.createElement( 'iframe' );
		buffer.className =
			'os-window__iframe os-window__iframe--buffer';
		buffer.setAttribute( 'aria-hidden', 'true' );
		buffer.setAttribute( 'name', `os-frame-${ this.id }-buffer` );

		this._swapBuffer = buffer;
		this._swapBufferTimer = window.setTimeout( () => {
			if ( this._swapBuffer === buffer ) {
				this._discardSwapBuffer();
			}
		}, 20000 );

		buffer.addEventListener(
			'load',
			() => {
				if ( this._swapBuffer !== buffer || this._isDestroyed ) {
					return;
				}
				this._swapBuffer = null;
				if ( this._swapBufferTimer !== null ) {
					window.clearTimeout( this._swapBufferTimer );
					this._swapBufferTimer = null;
				}

				let scrollX = 0;
				let scrollY = 0;
				try {
					scrollX = current.contentWindow?.scrollX ?? 0;
					scrollY = current.contentWindow?.scrollY ?? 0;
				} catch {

				}
				if ( scrollX || scrollY ) {
					try {
						buffer.contentWindow?.scrollTo( {
							left: scrollX,
							top: scrollY,
							behavior: 'instant',
						} );
					} catch {

					}
				}

				buffer.classList.remove(
					'os-window__iframe--buffer',
				);
				buffer.removeAttribute( 'aria-hidden' );
				buffer.setAttribute(
					'name',
					`os-frame-${ this.id }`,
				);
				current.remove();
				this.iframe = buffer;

				markWindowContentReady( this.id );
				noteFrameLoaded( buffer );

				buffer.addEventListener( 'load', () => {
					markWindowContentReady( this.id );
					noteFrameLoaded( buffer );
				} );

				this._wireContentFocusForwarder( buffer );

				this._wireTabNavSync( buffer );
				syncActiveTab( this, target );

				doAction( HOOKS.WINDOW_RELOADED, {
					windowId: this.id,
					url: target,
					silent: true,
				} );
			},
			{ once: true },
		);

		buffer.src = target;
		current.insertAdjacentElement( 'afterend', buffer );
	}

	private _spinReloadButton(): void {
		const btn = this.element.querySelector(
			'.os-window__btn--reload',
		);
		if ( ! ( btn instanceof HTMLElement ) ) {
			return;
		}
		btn.classList.remove( 'os-window__btn--spinning' );
		void btn.offsetWidth;
		btn.classList.add( 'os-window__btn--spinning' );
		btn.addEventListener(
			'animationend',
			() => {
				btn.classList.remove( 'os-window__btn--spinning' );
			},
			{ once: true },
		);
	}

	public renderCustomTitleBarButtons(): void {
		const leftSlot = this.element.querySelector< HTMLElement >(
			'.os-window__custom-buttons--left',
		);
		const rightSlot = this.element.querySelector< HTMLElement >(
			'.os-window__custom-buttons--right',
		);
		if ( ! leftSlot || ! rightSlot ) {
			return;
		}
		leftSlot.innerHTML = '';
		rightSlot.innerHTML = '';

		const { left, right } = buttonsForWindow( this );
		const fill = ( slot: HTMLElement, defs: TitleBarButtonDef[] ): void => {
			for ( const def of defs ) {
				const host = document.createElement( 'os-window-button' );
				paintTitleBarButtonIcon( host, def.icon );
				host.setAttribute( 'aria-label', def.label );
				host.setAttribute( 'title', def.label );
				host.classList.add( 'os-window__btn' );
				host.classList.add( 'os-window__btn--custom' );
				host.dataset.buttonId = def.id;
				slot.appendChild( host );

				if ( typeof def.render === 'function' ) {
					try {
						def.render( host, this );
					} catch ( err ) {
						if ( typeof console !== 'undefined' ) {
							console.error(
								'[openstation] title-bar-button render threw:',
								def.id,
								err,
							);
						}
					}
				} else if ( typeof def.onClick === 'function' ) {
					host.addEventListener( 'os-button-activate', ( ev ) => {
						try {
							def.onClick!( this, ev as unknown as MouseEvent );
						} catch ( err ) {
							if ( typeof console !== 'undefined' ) {
								console.error(
									'[openstation] title-bar-button onClick threw:',
									def.id,
									err,
								);
							}
						}
					} );
				}
			}
		};
		fill( leftSlot, left );
		fill( rightSlot, right );
	}

	public send< T = unknown >( channel: string, payload?: T ): void {
		if ( typeof channel !== 'string' || channel === '' ) {
			return;
		}

		const target = this.iframe ?? getSyntheticIframe( this.id );
		if ( ! target ) {
			dispatchToNative( this.id, channel, payload );
			return;
		}
		const sendNow = (): void => {
			try {
				target.contentWindow?.postMessage(
					{
						type: 'os-window-send',
						channel,
						payload,
					},
					INITIAL_ORIGIN,
				);
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] Window.send: postMessage failed',
						err,
					);
				}
			}
		};

		if ( isWindowContentReady( this.id ) ) {
			sendNow();
			return;
		}
		enqueueWindowSend( this.id, channel, payload, sendNow );
	}

	public on< T = unknown >(
		channel: string,
		cb: ( payload: T, meta: { channel: string; windowId: string } ) => void,
	): () => void {
		if ( typeof channel !== 'string' || channel === '' || typeof cb !== 'function' ) {
			return () => undefined;
		}
		return addParentSubscriber(
			this.id,
			channel,
			cb as WindowChannelCb,
		);
	}

	public markContentLoading(): void {
		markWindowContentLoading( this.id );
	}

	public markContentLoaded(): void {
		markWindowContentReady( this.id );
	}

	public whenContentReady(): Promise< void > {
		if ( isWindowContentReady( this.id ) ) {
			return Promise.resolve();
		}
		return new Promise< void >( ( resolve ) => {
			const expectedId = this.id;
			const onLoaded = ( e: Event ): void => {
				const detail = ( e as CustomEvent< { windowId?: string } > )
					.detail;
				if ( ! detail || detail.windowId !== expectedId ) {
					return;
				}
				document.removeEventListener(
					'os-window-content-loaded',
					onLoaded,
				);
				resolve();
			};
			document.addEventListener(
				'os-window-content-loaded',
				onLoaded,
			);
		} );
	}

	public markActivity(
		phase: 'idle' | 'pending' | 'saving' | 'saved' | 'failed',
		opts: { error?: string } = {},
	): void {
		this._activityPhase = phase;
		this._activityError = opts.error ?? null;
		this._paintActivityIndicator();
	}

	public _resetActivity(): void {
		if ( this._activitySettleTimer !== null ) {
			window.clearTimeout( this._activitySettleTimer );
			this._activitySettleTimer = null;
		}
		if ( this._activityClearTimer !== null ) {
			window.clearTimeout( this._activityClearTimer );
			this._activityClearTimer = null;
		}
		this._activityCount = 0;
		this._activityPhase = 'idle';
		this._activityError = null;
		this._paintActivityIndicator();
	}

	public _deferNavigationCommit( commit: () => void, expiresMs: number ): void {
		this._clearDeferredNavigation();
		this._deferredNavigationCommit = commit;
		this._deferredNavigationTimer = window.setTimeout( () => {
			this._deferredNavigationTimer = null;
			this._deferredNavigationCommit = null;
		}, expiresMs ) as unknown as number;
	}

	public _commitDeferredNavigation(): void {
		const commit = this._deferredNavigationCommit;
		this._clearDeferredNavigation();
		if ( ! commit || this._isDestroyed ) {
			return;
		}
		commit();
	}

	public _clearDeferredNavigation(): void {
		if ( this._deferredNavigationTimer !== null ) {
			window.clearTimeout( this._deferredNavigationTimer );
			this._deferredNavigationTimer = null;
		}
		this._deferredNavigationCommit = null;
	}

	public static readonly NAVIGATION_ACTIVITY_TIMEOUT_MS = 30000;

	public _noteNavigationActivity(): void {
		this._navigationActivity = 'pending';
		if ( this._navigationActivityTimer !== null ) {
			window.clearTimeout( this._navigationActivityTimer );
		}
		this._navigationActivityTimer = window.setTimeout( () => {
			this._navigationActivityTimer = null;
			this._navigationActivity = 'none';
			this._resetActivity();
		}, Window.NAVIGATION_ACTIVITY_TIMEOUT_MS ) as unknown as number;
	}

	public _settleNavigationActivity( final = false ): boolean {
		const carrying = this._navigationActivity !== 'none';
		if ( this._navigationActivity === 'pending' ) {
			this._navigationActivity = 'settled';
			if ( this._navigationActivityTimer !== null ) {
				window.clearTimeout( this._navigationActivityTimer );
				this._navigationActivityTimer = null;
			}

			this._resetActivity();
			this._finalizeActivitySettle( true );
		}
		if ( final ) {
			this._navigationActivity = 'none';
		}
		return carrying;
	}

	public trackActivity< T >( promise: Promise< T > ): Promise< T > {
		this._markActivityStart();
		return promise.then(
			( value ) => {
				this._markActivitySettled( true );
				return value;
			},
			( err ) => {
				const message = err instanceof Error ? err.message : String( err );
				this._markActivitySettled( false, message );
				throw err;
			},
		);
	}

	public static readonly MIN_SAVING_DISPLAY_MS = 1200;

	public _markActivityStart(): void {
		this._activityCount++;

		if ( this._activitySettleTimer !== null ) {
			window.clearTimeout( this._activitySettleTimer );
			this._activitySettleTimer = null;
		}
		if ( this._activityCount === 1 ) {
			this._activityPhase = 'saving';
			this._activityError = null;
			this._activitySavingStartedAt = Date.now();
			this._paintActivityIndicator();
		}
	}

	public _markActivitySettled( ok: boolean, error?: string ): void {
		if ( this._activityCount > 0 ) {
			this._activityCount--;
		}
		if ( this._activityCount > 0 ) {
			if ( ! ok && error ) {
				this._activityError = error;
			}
			return;
		}

		const elapsed = Date.now() - this._activitySavingStartedAt;
		const remaining = Window.MIN_SAVING_DISPLAY_MS - elapsed;
		if ( remaining > 0 ) {
			if ( this._activitySettleTimer !== null ) {
				window.clearTimeout( this._activitySettleTimer );
			}
			this._activitySettleTimer = window.setTimeout( () => {
				this._activitySettleTimer = null;
				this._finalizeActivitySettle( ok, error );
			}, remaining ) as unknown as number;
			return;
		}

		this._finalizeActivitySettle( ok, error );
	}

	private _finalizeActivitySettle( ok: boolean, error?: string ): void {
		this._activityPhase = ok && ! this._activityError ? 'saved' : 'failed';
		if ( ! ok && error ) {
			this._activityError = error;
		}
		this._paintActivityIndicator();

		if ( this._activityClearTimer !== null ) {
			window.clearTimeout( this._activityClearTimer );
			this._activityClearTimer = null;
		}

		if ( this._activityPhase === 'saved' ) {
			this._activityClearTimer = window.setTimeout( () => {
				this._activityClearTimer = null;
				this._activityPhase = 'idle';
				this._activityError = null;
				this._paintActivityIndicator();
			}, 2200 ) as unknown as number;
		}
	}

	public _paintActivityIndicator(): void {
		if ( this._isDestroyed ) {
			return;
		}
		const phase = this._activityPhase;

		if ( 'idle' === phase ) {
			this._titleBar.removeAttribute( 'data-os-activity' );
		} else {
			this._titleBar.setAttribute( 'data-os-activity', phase );
		}

		const live = this._titleBar.querySelector< HTMLElement >(
			'.os-window__activity-status',
		);
		if ( live ) {
			const failed = 'failed' === phase;
			live.setAttribute( 'role', failed ? 'alert' : 'status' );
			live.setAttribute( 'aria-live', failed ? 'assertive' : 'polite' );
			live.textContent = this._activityStatusText();
		}

		const indicators = this._titleBar.querySelectorAll< HTMLElement >(
			'[data-os-activity-indicator]',
		);
		indicators.forEach( ( indicator ) => {
			indicator.setAttribute( 'phase', phase );
			if ( this._activityError ) {
				indicator.setAttribute( 'error', this._activityError );
			} else {
				indicator.removeAttribute( 'error' );
			}
		} );
	}

	private _activityStatusText(): string {
		switch ( this._activityPhase ) {
			case 'saved':
				return __( 'Saved' );
			case 'failed':
				if ( ! this._activityError ) {
					return __( 'Not saved.' );
				}

				return sprintf( __( 'Not saved. %s' ), this._activityError );
			default:
				return '';
		}
	}

	public requestAttention(
		mode: 'pulse' | 'shake' | 'bounce' | null,
		opts: WindowAttentionOptions = {},
	): void {
		const intent = activity.filter(
			'os/window-attention-requested',
			{
				windowId: this.id,
				mode,
				durationMs: opts.durationMs,
				intensity: opts.intensity,
			},
			opts,
		);
		if ( ! intent || intent.cancel === true ) {
			return;
		}
		const intentMode = ( intent.mode ?? mode ) as WindowAttentionMode;
		const intentOpts: WindowAttentionOptions = {
			...opts,
			durationMs:
				typeof intent.durationMs === 'number'
					? intent.durationMs
					: opts.durationMs,
			intensity:
				typeof intent.intensity === 'string'
					? ( intent.intensity as WindowAttentionOptions[ 'intensity' ] )
					: opts.intensity,
		};

		const filtered = applyFilters<
			WindowAttentionMode,
			[ { windowId: string; opts: WindowAttentionOptions } ]
		>(
			'os.window.attention',
			intentMode,
			{ windowId: this.id, opts: intentOpts },
		);

		const wp = ( window as unknown as {
			wp?: { os?: { dock?: unknown; taskbar?: unknown } };
		} ).wp;
		type SetAttentionFn = (
			id: string,
			m: WindowAttentionMode,
			o: WindowAttentionOptions,
		) => void;
		const dockApi = wp?.os?.dock as
			| { setAttention?: SetAttentionFn }
			| null
			| undefined;
		const taskbarApi = wp?.os?.taskbar as
			| { setAttention?: SetAttentionFn }
			| null
			| undefined;

		let routed = false;
		if ( typeof dockApi?.setAttention === 'function' ) {
			dockApi.setAttention( this.id, filtered, intentOpts );
			routed = true;
		}
		if ( typeof taskbarApi?.setAttention === 'function' ) {
			taskbarApi.setAttention( this.id, filtered, intentOpts );
			routed = true;
		}

		if ( ! routed && filtered !== null ) {
			this.setHighlight( 'persistent' );
			const duration = intentOpts.durationMs ?? 4000;
			if ( duration > 0 ) {
				window.setTimeout( () => {
					this.setHighlight( null );
				}, duration );
			}
		} else if ( ! routed && filtered === null ) {
			this.setHighlight( null );
		}
	}

	public shake(): void {
		const filtered = applyFilters< boolean, [ { windowId: string } ] >(
			'os.window.shake',
			true,
			{ windowId: this.id },
		);
		if ( filtered === false ) {
			return;
		}
		const el = this.element;
		el.classList.remove( 'os-window--shaking' );

		void el.offsetWidth;
		el.classList.add( 'os-window--shaking' );
		const onEnd = (): void => {
			el.classList.remove( 'os-window--shaking' );
			el.removeEventListener( 'animationend', onEnd );
		};
		el.addEventListener( 'animationend', onEnd );
	}

	public setHighlight(
		mode: 'preview' | 'persistent' | null,
		opts?: { color?: string },
	): void {
		const el = this.element;
		if ( ! el ) {
			return;
		}
		el.classList.remove(
			'wp-window--highlight-preview',
			'wp-window--highlight-persistent',
		);
		if ( mode === 'preview' ) {
			el.classList.add( 'wp-window--highlight-preview' );
		} else if ( mode === 'persistent' ) {
			el.classList.add( 'wp-window--highlight-persistent' );
		}
		if ( opts?.color ) {
			el.style.setProperty( '--wp-window-highlight-color', opts.color );
		} else if ( mode === null ) {
			el.style.removeProperty( '--wp-window-highlight-color' );
		}

		doAction( HOOKS.WINDOW_HIGHLIGHT_CHANGED, {
			windowId: this.id,
			mode,
			color: opts?.color,
		} );
	}

	public close(): void {
		if ( this._isDestroyed ) {
			return;
		}

		if ( this.config.native && ! this._suppressCloseFilter ) {
			const proceed = applyFilters< boolean, [ { windowId: string; config: WindowConfig } ] >(
				HOOKS.NATIVE_WINDOW_BEFORE_CLOSE,
				true,
				{ windowId: this.id, config: this.config },
			);
			if ( proceed === false ) {
				return;
			}
		} else if ( ! this.config.native && ! this._suppressCloseFilter && this._iframeBridgeReady && this.iframe ) {
			if ( this._closePending ) {
				return;
			}
			this._closePending = true;
			try {
				this.iframe.contentWindow?.postMessage(
					{ type: 'os-bridge-beforeunload-query' },
					location.origin,
				);

				this._iframeCloseTimeout = setTimeout( () => {
					if ( this._isDestroyed ) {
						return;
					}
					this._suppressCloseFilter = true;
					this._closePending = false;
					this.close();
				}, 500 );
				return;
			} catch {
				this._closePending = false;
			}
		}

		this._isDestroyed = true;

		this._discardSwapBuffer();

		this._clearDeferredNavigation();

		if ( this._activityClearTimer !== null ) {
			window.clearTimeout( this._activityClearTimer );
			this._activityClearTimer = null;
		}
		if ( this._activitySettleTimer !== null ) {
			window.clearTimeout( this._activitySettleTimer );
			this._activitySettleTimer = null;
		}
		if ( this._navigationActivityTimer !== null ) {
			window.clearTimeout( this._navigationActivityTimer );
			this._navigationActivityTimer = null;
		}

		if ( this._titleBarButtonsUnsubscribe ) {
			this._titleBarButtonsUnsubscribe();
			this._titleBarButtonsUnsubscribe = null;
		}

		if ( this._windowThemesUnsubscribe ) {
			this._windowThemesUnsubscribe();
			this._windowThemesUnsubscribe = null;
		}

		if ( this._windowControlsUnsubscribe ) {
			this._windowControlsUnsubscribe();
			this._windowControlsUnsubscribe = null;
		}
		if ( this._windowSlotsUnsubscribe ) {
			this._windowSlotsUnsubscribe();
			this._windowSlotsUnsubscribe = null;
		}
		if ( this._windowChromesUnsubscribe ) {
			this._windowChromesUnsubscribe();
			this._windowChromesUnsubscribe = null;
		}

		if ( this._nativeRenderCtxDispose ) {
			try {
				this._nativeRenderCtxDispose();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-ctx-dispose',
					id: this.id,
					error: err,
				} );
			}
			this._nativeRenderCtxDispose = null;
		}

		this._bodyResizeObserver?.disconnect();
		this._bodyResizeObserver = null;

		if ( this._tabSpeculateTimer ) {
			window.clearTimeout( this._tabSpeculateTimer );
			this._tabSpeculateTimer = null;
		}
		this._tabOverflowTeardown?.();
		this._tabOverflowTeardown = null;

		clearWindowChannels( this.id );

		try {
			this.config.onClose?.();
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'native-window-close',
				id: this.id,
				error: err,
			} );
		}

		this.onClose?.( this );

		this.element.classList.add( 'os-window--closing' );

		this._onCloseTransitionEnd = ( e: TransitionEvent ): void => {
			if ( e.propertyName === 'opacity' ) {
				this._finalizeClose();
			}
		};
		this.element.addEventListener( 'transitionend', this._onCloseTransitionEnd );

		this._closeSafetyNetTimer = setTimeout( () => this._finalizeClose(), 300 );
	}

	public destroy(): void {
		if ( this._isFinalized ) {
			return;
		}

		if ( ! this._isDestroyed ) {
			this._suppressCloseFilter = true;
			try {
				this.close();
			} finally {
				this._suppressCloseFilter = false;
			}
		}

		this._finalizeClose();
	}

	private _suppressCloseFilter: boolean = false;

	private _finalizeClose(): void {
		if ( this._isFinalized ) {
			return;
		}
		this._isFinalized = true;

		if ( this._closeSafetyNetTimer !== null ) {
			clearTimeout( this._closeSafetyNetTimer );
			this._closeSafetyNetTimer = null;
		}

		if ( this._iframeCloseTimeout !== null ) {
			clearTimeout( this._iframeCloseTimeout );
			this._iframeCloseTimeout = null;
		}

		if ( this._clearOpeningClassRemoval ) {
			this._clearOpeningClassRemoval();
		}
		if ( this._onCloseTransitionEnd ) {
			this.element.removeEventListener(
				'transitionend',
				this._onCloseTransitionEnd,
			);
			this._onCloseTransitionEnd = null;
		}
		this._cancelGenieAnimation( 'minimize' );
		this._cancelGenieAnimation( 'restore' );

		if ( this._windowControlsTeardown ) {
			try {
				this._windowControlsTeardown();
			} catch {

			}
			this._windowControlsTeardown = null;
		}
		if ( this._windowSlotsTeardown ) {
			try {
				this._windowSlotsTeardown();
			} catch {

			}
			this._windowSlotsTeardown = null;
		}
		if ( this._chromeHandle ) {
			try {
				this._chromeHandle.destroy();
			} catch {

			}
			this._chromeHandle = null;
		}

		clearWindowTheme( this );
		if ( this._nativeRenderTeardown ) {
			try {
				this._nativeRenderTeardown();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-teardown',
					id: this.id,
					error: err,
				} );
			}
			this._nativeRenderTeardown = null;
		}

		window.removeEventListener( 'message', this._boundOnMessage );
		if ( this._boundOnDocumentPointerDown ) {
			document.removeEventListener(
				'pointerdown',
				this._boundOnDocumentPointerDown,
				true,
			);
		}

		this._unsubscribeWindowActions?.();
		this._unsubscribeWindowActions = null;
		this.element.remove();

		updateFullscreenBodyClass();
	}

	private installBodyResizeObserver(): ResizeObserver | null {
		const body = this.element.querySelector(
			'.os-window__body',
		) as HTMLElement | null;
		if ( ! body ) {
			return null;
		}
		if ( typeof ResizeObserver === 'undefined' ) {
			return null;
		}
		const observer = new ResizeObserver( ( entries ) => {
			const entry = entries[ 0 ];
			if ( ! entry ) {
				return;
			}
			const cr = entry.contentRect;
			const width = Math.round( cr.width );
			const height = Math.round( cr.height );

			try {
				this.config.onResize?.( width, height );
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'native-window-resize',
					id: this.id,
					error: err,
				} );
			}
			doAction( HOOKS.WINDOW_BODY_RESIZED, {
				windowId: this.id,
				width,
				height,
			} );
		} );
		observer.observe( body );
		return observer;
	}

	public getSnapshot(): { id: string; x: number; y: number; width: number; height: number; state: WindowState } {
		const isHidden = this.element.offsetParent === null;
		if ( isHidden ) {
			const parse = ( raw: string ): number => {
				const n = parseFloat( raw );
				return Number.isFinite( n ) ? Math.round( n ) : 0;
			};
			return {
				id: this.id,
				x: parse( this.element.style.left ),
				y: parse( this.element.style.top ),
				width: parse( this.element.style.width ),
				height: parse( this.element.style.height ),
				state: this.state,
			};
		}
		return {
			id: this.id,
			x: this.element.offsetLeft,
			y: this.element.offsetTop,
			width: this.element.offsetWidth,
			height: this.element.offsetHeight,
			state: this.state,
		};
	}

	public getExternalTabCount(): number {
		return externalTabCount( this );
	}

	public getExternalTabsSnapshot(): { url: string; label: string }[] {
		return externalTabsSnapshot( this );
	}

	public toggleActionsMenu(): void {
		toggleActionsMenu( this );
	}

	public closeActionsMenu(): void {
		closeActionsMenu( this );
	}

	public openActionsMenu(): void {
		openActionsMenu( this );
	}
}
