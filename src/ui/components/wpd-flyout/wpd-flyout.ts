/**
 * `<wpd-flyout>` — window-scoped sliding card.
 *
 * Built against the spec the wpd-tumblr 0.1.x prototype validated
 * by hand: `position: absolute` inside a window body that is
 * `position: relative; overflow: hidden`, margins from every edge
 * so the title bar stays visible, all-four-corners rounded card
 * with a large drop shadow, slide-in from the inline-end (or
 * other configured) edge, no backdrop by default (additive, not
 * modal), `z-index: 10`, focused-element captured as the trigger
 * for restore-on-dismiss, focus trap while open, click-outside-
 * but-inside-window dismissal via `pointerdown` on the closest
 * window body, Escape, imperative `open`-removal, all firing one
 * unified `wpd-flyout-dismiss` event with a `reason` discriminator.
 *
 * The component bakes the gotchas:
 *   - `focus( { preventScroll: true } )` on the first focusable
 *     element so the off-screen-during-transition panel doesn't
 *     scroll the window jittering as it slides in.
 *   - `focus( { preventScroll: true } )` again when restoring focus
 *     to the trigger on close.
 *   - `inert` on the host while closed so screen readers + Tab
 *     navigation skip the off-screen content.
 *   - Listener cleanup in `disconnectedCallback` so a window close
 *     doesn't leak document-level Escape handlers.
 *
 * Usage:
 *
 * ```html
 * <wpd-flyout id="account" placement="end" aria-label="Account">
 *     <header>…</header>
 *     <main>…</main>
 *     <button data-flyout-close>Close</button>
 * </wpd-flyout>
 * <button id="trigger">Open account</button>
 * <script>
 *   document.getElementById('trigger').addEventListener('click', () => {
 *     document.getElementById('account').setAttribute('open', '');
 *   });
 *   document.getElementById('account').addEventListener('wpd-flyout-dismiss', (e) => {
 *     console.log( e.detail.reason );
 *   });
 * </script>
 * ```
 */

import { Component, defineComponent, html, type TemplateResult } from '../../core';
import { flyoutStyles } from './wpd-flyout.styles';

export type WpdFlyoutPlacement = 'end' | 'start' | 'top';
export type WpdFlyoutScope = 'window' | 'parent' | 'document';
export type WpdFlyoutDismissReason =
	| 'escape'
	| 'pointer'
	| 'close-button'
	| 'api';

/**
 * Selector for elements considered focusable inside the flyout.
 * Matches the canonical W3C-pattern set; `[tabindex="-1"]` is
 * explicitly excluded so panels containing programmatic-focus-only
 * targets don't trap into them.
 */
const FOCUSABLE_SELECTOR = [
	'a[href]',
	'area[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
	'[contenteditable="true"]',
].join( ',' );

/**
 * `data-flyout-close` on a button inside the flyout marks it as a
 * dismiss trigger — the component intercepts its click and emits
 * `wpd-flyout-dismiss` with reason `'close-button'`.
 */
const CLOSE_BUTTON_SELECTOR = '[data-flyout-close]';

export class WpdFlyout extends Component {
	static props = [
		'open',
		'placement',
		'scope',
		'aria-label',
		'aria-labelledby',
	] as const;
	static styles = [ flyoutStyles ];

	static help = {
		title: 'Flyout',
		summary:
			'Window-scoped sliding card. Lives `position: absolute` inside a window body, slides in from the configured edge with margins on every side, captures the previously-focused element as the trigger for restore-on-close, traps focus while open, and dismisses on Escape / pointerdown-outside / `[data-flyout-close]` click / imperative `open`-removal — all firing one `wpd-flyout-dismiss` event with a `reason` discriminator.',
		status: 'experimental',
		since: '0.8.2',
		props: [
			{
				name: 'open',
				type: 'boolean attribute',
				description:
					'Mounts the flyout open. Removing the attribute (programmatically or via the component\'s own dismissal paths) slides it back out and fires `wpd-flyout-dismiss`.',
			},
			{
				name: 'placement',
				type: "'end' | 'start' | 'top'",
				default: 'end',
				description:
					"Which inside-window edge the card anchors to. `'end'` is the inline-end edge (right in LTR, left in RTL). All placements keep gutters on every edge — the panel reads as a floating card, not a drawer.",
			},
			{
				name: 'scope',
				type: "'window' | 'parent' | 'document'",
				default: 'window',
				description:
					"Which container the click-outside listener attaches to. `'window'` (default) walks up to the closest `.desktop-mode-window__body`; `'parent'` uses the immediate parent element; `'document'` listens on `document.body`. The first option is the right one for any flyout inside a desktop-mode window.",
			},
			{
				name: 'aria-label',
				type: 'string',
				description: 'Accessible name for the dialog landmark.',
			},
			{
				name: 'aria-labelledby',
				type: 'id reference',
				description:
					'Id of the element labelling the flyout — wins over `aria-label` when both are set.',
			},
		],
		events: [
			{
				name: 'wpd-flyout-dismiss',
				description:
					"Fires whenever the flyout closes. Detail: `{ reason: 'escape' | 'pointer' | 'close-button' | 'api' }`. The `'api'` reason fires when an external caller imperatively removes the `open` attribute.",
			},
		],
		cssProps: [
			{
				name: '--wpd-flyout-bg',
				description: 'Card background. Default: white surface.',
			},
			{
				name: '--wpd-flyout-fg',
				description: 'Card foreground. Default: `--desktop-mode-fg`.',
			},
			{
				name: '--wpd-flyout-shadow',
				description: 'Drop shadow. Default: a deep navy 16px/48px lift.',
			},
			{
				name: '--wpd-flyout-backdrop',
				description:
					'Backdrop layer dimming the window body while the flyout is open. Default `transparent` — flyout is additive, not modal. Set to e.g. `rgba(0,0,0,0.4)` for window-scoped modality.',
			},
		],
		slots: [
			{
				name: '(default)',
				description:
					'Card content. The component does not impose padding or a header — wrap in your own `<wpd-panel>` / header / scroll container as needed. Mark a button with `data-flyout-close` to wire it to the framework dismissal path.',
			},
		],
		example: html`
			<div
				style="position:relative;height:280px;border:1px solid var( --wpd-border, rgba( 0, 0, 0, 0.08 ) );border-radius:8px;background:var( --wpd-surface-elevated, #f6f7f7 );color:var( --wpd-fg, inherit );overflow:hidden;"
			>
				<div
					style="height:32px;background:var( --wpd-hover, rgba( 0, 0, 0, 0.04 ) );display:flex;align-items:center;padding:0 12px;font-size:12px;opacity:0.7;"
				>
					Mock window — title bar
				</div>
				<div style="padding:12px;">
					<wpd-button
						id="wpd-flyout-example-trigger"
						@click=${ ( e: MouseEvent ) => {
				const flyout = (
					( e.currentTarget as HTMLElement ).getRootNode() as Document
				).querySelector< HTMLElement >( '#wpd-flyout-example-flyout' );
				flyout?.setAttribute( 'open', '' );
			} }
						>Open flyout</wpd-button
					>
					<p style="opacity:0.7;font-size:13px;">
						Click the button. The card slides in from the right
						edge with margins from every window edge — title
						bar stays visible above. Press Escape, click outside
						the card, or hit Close to dismiss.
					</p>
				</div>
				<wpd-flyout
					id="wpd-flyout-example-flyout"
					placement="end"
					scope="parent"
					aria-label="Sample flyout"
				>
					<div style="padding:18px;">
						<h4 style="margin:0 0 8px;">Account</h4>
						<p style="margin:0 0 12px;font-size:13px;opacity:0.8;">
							Floating card inside the window. Margins from
							every edge so the chrome reads through.
						</p>
						<wpd-button data-flyout-close>Close</wpd-button>
					</div>
				</wpd-flyout>
			</div>
		`,
	} as const;

	/** Element that had focus the moment `open` flipped on; restored on dismiss. */
	private _trigger: HTMLElement | null = null;
	/** Document-level Escape listener — bound while open. */
	private _onDocKey: ( ( e: KeyboardEvent ) => void ) | null = null;
	/** `pointerdown` listener on the scope root — bound while open. */
	private _onScopePointerDown: ( ( e: PointerEvent ) => void ) | null = null;
	/** Click capture on the host for `data-flyout-close`. */
	private _onHostClick: ( ( e: MouseEvent ) => void ) | null = null;
	/** Tab-trap listener on the host. */
	private _onHostKeyDown: ( ( e: KeyboardEvent ) => void ) | null = null;
	/** Suppresses the `'api'`-reason emit when our own dismissal path strips `open`. */
	private _pendingReason: WpdFlyoutDismissReason | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'dialog' );
		}
		// Closed by default — `inert` keeps Tab + screen-readers
		// out of the off-screen panel until `open` flips on.
		if ( ! this.hasAttribute( 'open' ) ) {
			this.setAttribute( 'inert', '' );
		}
	}

	disconnectedCallback(): void {
		// Detach every listener — a window-close that removes the
		// host element should not leak document-level handlers.
		this._detachOpenListeners();
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		super.attributeChangedCallback( name, oldValue, newValue );
		if ( name === 'open' ) {
			if ( newValue !== null && oldValue === null ) {
				this._handleOpen();
			} else if ( newValue === null && oldValue !== null ) {
				this._handleClose();
			}
		}
	}

	private _handleOpen(): void {
		this.removeAttribute( 'inert' );
		// Capture the previously-focused element as the trigger so
		// dismissal can restore focus (per spec point 11). Skip the
		// no-focus fallbacks (`<body>` / `<html>`) — treating those
		// as the trigger would make the click-outside check look
		// like every pointer event lands "on the trigger" and never
		// dismiss.
		const doc = this.ownerDocument;
		const active = doc?.activeElement ?? null;
		this._trigger =
			active instanceof HTMLElement &&
			active !== this &&
			active !== doc?.body &&
			active !== doc?.documentElement
				? active
				: null;

		// Move focus to the first focusable element inside the slot
		// content with `{ preventScroll: true }`. Without preventScroll,
		// the off-screen-during-transition target gets scrolled into
		// view and the whole window jitters.
		queueMicrotask( () => {
			if ( ! this.hasAttribute( 'open' ) ) {
				return;
			}
			const focusable = this._firstFocusable();
			( focusable ?? this ).focus?.( { preventScroll: true } );
		} );

		this._attachOpenListeners();
	}

	private _handleClose(): void {
		const reason: WpdFlyoutDismissReason = this._pendingReason ?? 'api';
		this._pendingReason = null;

		this.setAttribute( 'inert', '' );
		this._detachOpenListeners();

		this.emit( 'wpd-flyout-dismiss', { reason } );

		// Restore focus to the captured trigger — also with
		// `preventScroll` to avoid a layout jump on close.
		const trigger = this._trigger;
		this._trigger = null;
		if ( trigger && trigger.isConnected ) {
			trigger.focus?.( { preventScroll: true } );
		}
	}

	/** Internal dismissal — flags the reason then removes `open`. */
	private _dismiss( reason: WpdFlyoutDismissReason ): void {
		if ( ! this.hasAttribute( 'open' ) ) {
			return;
		}
		this._pendingReason = reason;
		this.removeAttribute( 'open' );
	}

	private _attachOpenListeners(): void {
		const scopeRoot = this._resolveScopeRoot();

		this._onScopePointerDown = ( e: PointerEvent ): void => {
			if ( ! this.hasAttribute( 'open' ) ) {
				return;
			}
			const path = e.composedPath();
			if ( path.includes( this ) ) {
				return; // click inside the panel — ignore.
			}
			if ( this._trigger && path.includes( this._trigger ) ) {
				return; // click on the trigger — let the trigger handler decide.
			}
			this._dismiss( 'pointer' );
		};
		scopeRoot.addEventListener( 'pointerdown', this._onScopePointerDown );

		this._onDocKey = ( e: KeyboardEvent ): void => {
			if ( e.key === 'Escape' && this.hasAttribute( 'open' ) ) {
				e.preventDefault();
				this._dismiss( 'escape' );
			}
		};
		document.addEventListener( 'keydown', this._onDocKey );

		this._onHostKeyDown = ( e: KeyboardEvent ): void => {
			if ( e.key !== 'Tab' ) {
				return;
			}
			const focusables = this._allFocusable();
			if ( focusables.length === 0 ) {
				e.preventDefault();
				return;
			}
			const first = focusables[ 0 ];
			const last = focusables[ focusables.length - 1 ];
			const active = this.ownerDocument?.activeElement ?? null;
			if ( e.shiftKey && ( active === first || active === this ) ) {
				e.preventDefault();
				last.focus( { preventScroll: true } );
			} else if ( ! e.shiftKey && active === last ) {
				e.preventDefault();
				first.focus( { preventScroll: true } );
			}
		};
		this.addEventListener( 'keydown', this._onHostKeyDown );

		this._onHostClick = ( e: MouseEvent ): void => {
			const target = e.target as Element | null;
			const closeBtn = target?.closest?.( CLOSE_BUTTON_SELECTOR );
			if ( closeBtn && this.contains( closeBtn ) ) {
				this._dismiss( 'close-button' );
			}
		};
		this.addEventListener( 'click', this._onHostClick );
	}

	private _detachOpenListeners(): void {
		if ( this._onDocKey ) {
			document.removeEventListener( 'keydown', this._onDocKey );
			this._onDocKey = null;
		}
		if ( this._onScopePointerDown ) {
			const scopeRoot = this._resolveScopeRoot();
			scopeRoot.removeEventListener( 'pointerdown', this._onScopePointerDown );
			this._onScopePointerDown = null;
		}
		if ( this._onHostKeyDown ) {
			this.removeEventListener( 'keydown', this._onHostKeyDown );
			this._onHostKeyDown = null;
		}
		if ( this._onHostClick ) {
			this.removeEventListener( 'click', this._onHostClick );
			this._onHostClick = null;
		}
	}

	private _resolveScopeRoot(): HTMLElement {
		const scope = ( this.getAttribute( 'scope' ) ?? 'window' ) as WpdFlyoutScope;
		if ( scope === 'document' ) {
			return document.body;
		}
		if ( scope === 'parent' ) {
			return this.parentElement ?? document.body;
		}
		// 'window' — the canonical desktop-mode case.
		const windowBody = this.closest< HTMLElement >( '.desktop-mode-window__body' );
		return windowBody ?? this.parentElement ?? document.body;
	}

	private _firstFocusable(): HTMLElement | null {
		// Look in light DOM (slot content) first — that's what users
		// will see and tab into.
		const slotMatch = this.querySelector< HTMLElement >( FOCUSABLE_SELECTOR );
		return slotMatch ?? null;
	}

	private _allFocusable(): HTMLElement[] {
		return Array.from(
			this.querySelectorAll< HTMLElement >( FOCUSABLE_SELECTOR ),
		).filter( ( el ) => ! ( el as HTMLElement & { disabled?: boolean } ).disabled );
	}

	protected render(): TemplateResult {
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-flyout', WpdFlyout );
