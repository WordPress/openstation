/**
 * `<wpd-tile>` — the canonical tile component used everywhere a
 * tile appears in the shell. Desktop wallpaper, folder windows,
 * My WordPress sections (Posts, Pages, Users, Media, drill-in
 * usage), and any plugin surface that wants the same chrome use
 * THIS component.
 *
 * Light-DOM by design — the visual chrome (`.desktop-mode-file-
 * tile*`) lives in the global stylesheet so per-surface modifier
 * classes (`__media-tile`, `__tile--user`, `__tile--usage`) can
 * keep working from external CSS. The host element itself IS the
 * tile: no inner button wrapper. That keeps the existing DOM
 * contract intact — `document.querySelector('.desktop-mode-file-
 * tile')` returns the tile; `data-placement-id` lives on it;
 * `style.left/top` applies to it.
 *
 * The component owns:
 *
 *   - Reactive props mirroring `TileSpec` (type, ref, label,
 *     icon, thumbnail, kind, status, selected, missing, …).
 *   - Drag-out wiring (when `drag-kind` is set, the component
 *     attaches the standard pointerdown → DragManager dance).
 *   - Status ribbon insertion via `<wpd-ribbon>` (no hand-rolled
 *     corner-banner CSS; honors the per-user
 *     `showPostStatusRibbons` OS-setting).
 *   - Lock badge when `access-gated`.
 *   - Keyboard activation — Enter / Space fire a `click` event.
 *
 * Consumers wire `click` / `dblclick` / `contextmenu` directly on
 * the `<wpd-tile>` element. No custom-event surface.
 */

import { Component, defineComponent, html } from '../../core';
import { renderIcon } from '../../../icon';
import { applyTileEntryStagger } from '../../../utils';
import { doAction } from '../../../hooks';
import type { DragManagerApi } from '../../../drag';
import type { ShortcutDragData } from '../../../desktop-files/drag-payloads';
import { styles } from './wpd-tile.styles';
import '../wpd-ribbon/wpd-ribbon';

/** CSS class on every tile — single source of truth. */
export const TILE_CLASS = 'desktop-mode-file-tile';

const STATUS_LABEL: Record< string, string > = {
	draft: 'Draft',
	pending: 'Pending',
	private: 'Private',
	future: 'Scheduled',
};

function statusRibbonsEnabled(): boolean {
	const get = (
		window.wp as
			| { desktop?: { getOsSettings?: () => { showPostStatusRibbons?: boolean } } }
			| undefined
	)?.desktop?.getOsSettings;
	if ( typeof get !== 'function' ) {
		return true;
	}
	try {
		return get()?.showPostStatusRibbons !== false;
	} catch {
		return true;
	}
}

/**
 * Resolve the shell-side drag manager off `window.wp.desktop`.
 * Exported so the desktop-files `attachTileDragOut` helper can
 * reuse the same accessor — single source of truth.
 *
 * @public
 */
export function getDragManager(): DragManagerApi | null {
	const api = (
		window as { wp?: { desktop?: { dragManager?: DragManagerApi } } }
	).wp?.desktop?.dragManager;
	return api ?? null;
}

const REACTIVE_PROPS = [
	'type',
	'ref',
	'label',
	'icon',
	'favicon',
	'thumbnail',
	'kind',
	'status',
	'selected',
	'missing',
	'access-gated',
	'drag-kind',
	'drag-title',
	'drag-icon',
] as const;

export class WpdTile extends Component {
	static shadow = false;
	static props = REACTIVE_PROPS;
	static styles = [ styles ];

	static help = {
		title: 'Tile',
		summary:
			'Canonical file/entity tile. Used across the wallpaper, folder windows, every My WordPress section, and plugin surfaces. Renders the standard `.desktop-mode-file-tile` chrome + optional status ribbon and wires the shared drag-out helper.',
		status: 'experimental',
		since: '0.8.6',
		props: [
			{ name: 'type', type: 'string' },
			{ name: 'ref', type: 'string' },
			{ name: 'label', type: 'string' },
			{ name: 'icon', type: 'string', description: 'Dashicon class / URL / data URI. Ignored when `thumbnail` is set.' },
			{ name: 'favicon', type: 'boolean', description: 'Frames a web icon at its intrinsic size inside a monitor silhouette.' },
			{ name: 'thumbnail', type: 'string', description: 'Preview image URL. Renders as `<img>` and wins over `icon`.' },
			{ name: 'kind', type: '`entry` | `folder`' },
			{ name: 'status', type: '`draft` | `pending` | `private` | `future` | `publish`' },
			{ name: 'selected', type: 'boolean' },
			{ name: 'missing', type: 'boolean' },
			{ name: 'access-gated', type: 'boolean' },
			{ name: 'drag-kind', type: 'string', description: 'When set, the component wires pointerdown → DragManager.' },
			{ name: 'drag-title', type: 'string' },
			{ name: 'drag-icon', type: 'string' },
		],
	} as const;

	private _pointerdownHandler: ( ( e: PointerEvent ) => void ) | null = null;
	private _keydownHandler: ( ( e: KeyboardEvent ) => void ) | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this._keydownHandler ) {
			this._keydownHandler = ( e: KeyboardEvent ): void => {
				if ( e.key === 'Enter' || e.key === ' ' ) {
					e.preventDefault();
					this.click();
				}
			};
			this.addEventListener( 'keydown', this._keydownHandler as EventListener );
		}
		// Paint immediately on first connect so callers can query
		// the rendered DOM synchronously.
		this._paint();
	}

	disconnectedCallback(): void {
		if ( this._pointerdownHandler ) {
			this.removeEventListener(
				'pointerdown',
				this._pointerdownHandler as EventListener,
			);
			this._pointerdownHandler = null;
		}
		if ( this._keydownHandler ) {
			this.removeEventListener(
				'keydown',
				this._keydownHandler as EventListener,
			);
			this._keydownHandler = null;
		}
	}

	/**
	 * Bypass the templated render loop. Lit-html's `render(template,
	 * root)` would wipe the host's light-DOM children every tick —
	 * including the visual / label / ribbon `_paint()` just
	 * inserted. We override `requestUpdate` directly so attribute
	 * changes call `_paint` (idempotent) without lit-html getting
	 * involved.
	 */
	protected requestUpdate(): void {
		if ( ! this.isConnected ) {
			return;
		}
		this._paint();
	}

	protected render() {
		// Unreachable — `requestUpdate` is the only caller and we
		// overrode it above. The Component base contract requires a
		// `render()` method, so this stub satisfies the type.
		return html``;
	}

	private _paint(): void {
		const type = this.getAttribute( 'type' ) ?? '';
		const ref = this.getAttribute( 'ref' ) ?? '';
		const label = this.getAttribute( 'label' ) ?? '';
		const icon = this.getAttribute( 'icon' ) ?? '';
		const favicon = this.hasAttribute( 'favicon' );
		const thumbnail = this.getAttribute( 'thumbnail' ) ?? '';
		const kind = this.getAttribute( 'kind' ) ?? 'entry';
		const status = this.getAttribute( 'status' ) ?? '';
		const selected = this.hasAttribute( 'selected' );
		const missing = this.hasAttribute( 'missing' );
		const accessGated = this.hasAttribute( 'access-gated' );

		// Idempotent class management — the host element carries
		// the canonical chrome class + state modifiers, and we
		// preserve any additional classes added by consumers (e.g.
		// the My WordPress modifier classes like `__media-tile`).
		// We track ours so a flip of `selected` / `kind` doesn't
		// accumulate stale classes.
		const ownedClasses = [
			TILE_CLASS,
			`${ TILE_CLASS }--folder`,
			`${ TILE_CLASS }--missing`,
			`${ TILE_CLASS }--access-gated`,
			`${ TILE_CLASS }--selected`,
		];
		for ( const c of ownedClasses ) {
			this.classList.remove( c );
		}
		this.classList.add( TILE_CLASS );
		if ( kind === 'folder' ) {
			this.classList.add( `${ TILE_CLASS }--folder` );
		}
		if ( missing ) {
			this.classList.add( `${ TILE_CLASS }--missing` );
		}
		if ( accessGated ) {
			this.classList.add( `${ TILE_CLASS }--access-gated` );
		}
		if ( selected ) {
			this.classList.add( `${ TILE_CLASS }--selected` );
		}

		// Identity data-* attrs.
		this.dataset.fileType = type;
		this.dataset.fileRef = ref;
		if ( kind ) {
			this.dataset.role = kind;
		}

		// Accessibility — the host acts as a button.
		this.setAttribute( 'role', 'listitem' );
		this.setAttribute( 'aria-label', label );
		if ( ! this.hasAttribute( 'tabindex' ) ) {
			this.setAttribute( 'tabindex', '0' );
		}
		// Sentinel used to detect our own previously-set title so we
		// don't clobber a title set by some other code path. Kept as
		// a constant so the set + the compare can never drift on
		// curly-vs-straight quotes.
		const accessGatedTitle =
			'You don’t have permission to open this — ask the folder owner for access.';
		if ( accessGated ) {
			this.title = accessGatedTitle;
			this.setAttribute( 'aria-disabled', 'true' );
		} else {
			this.removeAttribute( 'aria-disabled' );
			if ( this.title === accessGatedTitle ) {
				this.removeAttribute( 'title' );
			}
		}

		// Paint inner DOM. We replace existing visual/label/lock/
		// ribbon children but preserve anything else consumers
		// appended (e.g. the shared-folder badge from
		// `share-menu-items.ts`).
		const SLOTS = [
			`${ TILE_CLASS }__visual`,
			`${ TILE_CLASS }__label`,
			`${ TILE_CLASS }__lock`,
		];
		for ( const cls of SLOTS ) {
			this.querySelectorAll( `:scope > .${ cls }` ).forEach( ( n ) =>
				n.remove(),
			);
		}
		this.querySelectorAll( ':scope > wpd-ribbon' ).forEach( ( n ) =>
			n.remove(),
		);

		const visual = document.createElement( 'span' );
		visual.className = `${ TILE_CLASS }__visual`;
		if ( favicon && icon && ! thumbnail ) {
			visual.classList.add( `${ TILE_CLASS }__visual--favicon` );
		}
		if ( thumbnail ) {
			const img = document.createElement( 'img' );
			img.src = thumbnail;
			img.alt = '';
			img.loading = 'lazy';
			img.decoding = 'async';
			img.className = `${ TILE_CLASS }__preview`;
			img.draggable = false;
			visual.appendChild( img );
		} else if ( icon ) {
			const iconNode = renderIcon( icon, {
				title: label,
				className: `${ TILE_CLASS }__icon`,
			} );
			visual.appendChild( iconNode );
		}
		this.appendChild( visual );

		const labelNode = document.createElement( 'span' );
		labelNode.className = `${ TILE_CLASS }__label`;
		labelNode.textContent = label;
		this.appendChild( labelNode );

		if ( accessGated ) {
			const lock = document.createElement( 'span' );
			lock.className = `${ TILE_CLASS }__lock dashicons dashicons-lock`;
			lock.setAttribute( 'aria-hidden', 'true' );
			this.appendChild( lock );
		}

		// Status ribbon via `<wpd-ribbon>`.
		if (
			status &&
			status !== 'publish' &&
			STATUS_LABEL[ status ] &&
			statusRibbonsEnabled()
		) {
			const ribbon = document.createElement( 'wpd-ribbon' );
			ribbon.setAttribute( 'placement', 'top-end' );
			ribbon.setAttribute( 'tone', ribbonToneFor( status ) );
			ribbon.textContent = STATUS_LABEL[ status ];
			this.appendChild( ribbon );
		}

		applyTileEntryStagger( this );

		doAction( 'desktop-mode.tile.rendered', { tile: this } );

		this._wireDragOut();
	}

	private _wireDragOut(): void {
		if ( this._pointerdownHandler ) {
			this.removeEventListener(
				'pointerdown',
				this._pointerdownHandler as EventListener,
			);
			this._pointerdownHandler = null;
		}
		const dragKind = this.getAttribute( 'drag-kind' );
		if ( ! dragKind ) {
			return;
		}
		const handler = ( e: PointerEvent ): void => {
			if ( e.button !== 0 ) {
				return;
			}
			const dragManager = getDragManager();
			if ( ! dragManager ) {
				return;
			}
			const ref = this.getAttribute( 'ref' ) ?? '';
			const title =
				this.getAttribute( 'drag-title' ) ??
				this.getAttribute( 'label' ) ??
				undefined;
			const icon =
				this.getAttribute( 'drag-icon' ) ??
				this.getAttribute( 'icon' ) ??
				undefined;
			const rect = this.getBoundingClientRect();
			dragManager.start( {
				payload: {
					type: 'shortcut',
					source: this,
					data: {
						kind: dragKind,
						ref,
						title,
						icon,
					} satisfies ShortcutDragData,
					ghost: {
						offsetX: e.clientX - rect.left,
						offsetY: e.clientY - rect.top,
					},
				},
				origin: e,
			} );
		};
		this._pointerdownHandler = handler;
		this.addEventListener( 'pointerdown', handler as EventListener );
	}
}

function ribbonToneFor( status: string ): string {
	switch ( status ) {
		case 'draft':
			return 'warning';
		case 'pending':
			return 'info';
		case 'private':
			return 'danger';
		case 'future':
			return 'primary';
		default:
			return 'primary';
	}
}

defineComponent( 'wpd-tile', WpdTile );
