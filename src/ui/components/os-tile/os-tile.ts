/**
 * `<os-tile>` — the canonical tile component used everywhere a
 * tile appears in the shell. Desktop wallpaper, folder windows,
 * My WordPress sections (Posts, Pages, Users, Media, drill-in
 * usage), and any plugin surface that wants the same chrome use
 * THIS component.
 *
 * Light-DOM by design — the visual chrome (`.os-file-
 * tile*`) lives in the global stylesheet so per-surface modifier
 * classes (`__media-tile`, `__tile--user`, `__tile--usage`) can
 * keep working from external CSS. The host element itself IS the
 * tile: no inner button wrapper. That keeps the existing DOM
 * contract intact — `document.querySelector('.os-file-
 * tile')` returns the tile; `data-placement-id` lives on it;
 * `style.left/top` applies to it.
 *
 * The component owns:
 *
 *   - Reactive props mirroring `TileSpec` (type, ref, label,
 *     icon, thumbnail, kind, status, selected, missing, …).
 *   - Drag-out wiring (when `drag-kind` is set, the component
 *     attaches the standard pointerdown → DragManager dance).
 *   - Status ribbon insertion via `<os-ribbon>` (no hand-rolled
 *     corner-banner CSS; honors the per-user
 *     `showPostStatusRibbons` OS-setting).
 *   - Lock badge when `access-gated`.
 *   - Keyboard activation — Enter / Space fire a `click` event.
 *
 * Consumers wire `click` / `dblclick` / `contextmenu` directly on
 * the `<os-tile>` element. No custom-event surface.
 */

import { Component, defineComponent, html } from '../../core';
import { renderIcon } from '../../../icon';
import { applyTileEntryStagger } from '../../../utils';
import { doAction } from '../../../hooks';
import type { DragManagerApi } from '../../../drag';
import type { ShortcutDragData } from '../../../desktop-files/drag-payloads';
import { styles } from './os-tile.styles';
import '../os-ribbon/os-ribbon';

/** CSS class on every tile — single source of truth. */
export const TILE_CLASS = 'os-file-tile';

const STATUS_LABEL: Record< string, string > = {
	draft: 'Draft',
	pending: 'Pending',
	private: 'Private',
	future: 'Scheduled',
};

function statusRibbonsEnabled(): boolean {
	const get = (
		window.wp as
			| { os?: { getOsSettings?: () => { showPostStatusRibbons?: boolean } } }
			| undefined
	)?.os?.getOsSettings;
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
 * Resolve the shell-side drag manager off `window.wp.os`.
 * Exported so the desktop-files `attachTileDragOut` helper can
 * reuse the same accessor — single source of truth.
 *
 * @public
 */
export function getDragManager(): DragManagerApi | null {
	const api = (
		window as { wp?: { os?: { dragManager?: DragManagerApi } } }
	).wp?.os?.dragManager;
	return api ?? null;
}

const REACTIVE_PROPS = [
	'type',
	'ref',
	'label',
	'icon',
	'thumbnail',
	'kind',
	'status',
	'selected',
	'selectable',
	'missing',
	'access-gated',
	'drag-kind',
	'drag-title',
	'drag-icon',
] as const;

export class OsTile extends Component {
	static shadow = false;
	static props = REACTIVE_PROPS;
	static styles = [ styles ];

	static help = {
		title: 'Tile',
		summary:
			'Canonical file/entity tile. Used across the wallpaper, folder windows, every My WordPress section, and plugin surfaces. Renders the standard `.os-file-tile` chrome + optional status ribbon and wires the shared drag-out helper.',
		status: 'stable',
		props: [
			{ name: 'type', type: 'string' },
			{ name: 'ref', type: 'string' },
			{ name: 'label', type: 'string' },
			{ name: 'icon', type: 'string', description: 'Dashicon class / URL / data URI. Ignored when `thumbnail` is set.' },
			{ name: 'thumbnail', type: 'string', description: 'Preview image URL. Renders as `<img>` and wins over `icon`.' },
			{ name: 'kind', type: '`entry` | `folder`' },
			{ name: 'status', type: '`draft` | `pending` | `private` | `future` | `publish`' },
			{ name: 'selected', type: 'boolean' },
			{ name: 'selectable', type: 'boolean', description: 'Set by the selection controller on a multi-select canvas. Switches the tile from `listitem` to `option` so it can carry `aria-selected`.' },
			{ name: 'missing', type: 'boolean' },
			{ name: 'access-gated', type: 'boolean' },
			{ name: 'drag-kind', type: 'string', description: 'When set, the component wires pointerdown → DragManager.' },
			{ name: 'drag-title', type: 'string' },
			{ name: 'drag-icon', type: 'string' },
		],
		/*
		 * The tile is the one LIGHT-DOM component in the kit
		 * (`static shadow = false`), so its chrome comes from
		 * `assets/css/desktop-files.css` rather than from a shadow
		 * stylesheet — which means it only looks like a tile where
		 * that file is loaded. It is, in the shell.
		 *
		 * Shown on a dark strip because tiles live on the wallpaper,
		 * and their label is Starlight with a text shadow — on the
		 * settings panel's own light surface the labels would be
		 * white-on-white and the example would look empty.
		 */
		example: html`
			<div
				style="display:flex;gap:18px;flex-wrap:wrap;padding:16px;border-radius:8px;background:var( --os-ui-surface-sunken, #101018 );"
			>
				<os-tile
					type="post"
					ref="1"
					label="Hello world"
					icon="dashicons-admin-post"
					kind="entry"
					status="publish"
				></os-tile>
				<os-tile
					type="post"
					ref="2"
					label="A draft"
					icon="dashicons-admin-post"
					kind="entry"
					status="draft"
				></os-tile>
				<os-tile
					type="folder"
					ref="3"
					label="Screenshots"
					icon="dashicons-portfolio"
					kind="folder"
				></os-tile>
				<os-tile
					type="post"
					ref="4"
					label="Selected"
					icon="dashicons-media-document"
					kind="entry"
					selected
				></os-tile>
				<os-tile
					type="post"
					ref="5"
					label="Locked"
					icon="dashicons-lock"
					kind="entry"
					access-gated
				></os-tile>
			</div>
		`,
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

	/**
	 * Selection state is repainted WITHOUT touching the tile's
	 * children.
	 *
	 * `_paint()` replaces the visual, the label and the ribbon on
	 * every call. That is fine for a content change and catastrophic
	 * for a selection change, because selection changes land in the
	 * middle of pointer gestures: destroy the node a `mousedown`
	 * landed on and the browser will not synthesize the `click` when
	 * the `mouseup` arrives on its replacement — so no `click`, no
	 * `dblclick`, and a tile that can no longer be opened. (The same
	 * hazard is documented for keyed lists in
	 * `docs/javascript-reference.md`.)
	 *
	 * So the three selection attributes take a cheap path: classes
	 * and ARIA only, children untouched. It is also what makes
	 * Ctrl+A over a folder of two hundred icons cost two hundred
	 * class toggles instead of two hundred subtree rebuilds.
	 */
	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		if ( oldValue === newValue ) {
			return;
		}
		if (
			name === 'selected' ||
			name === 'selectable' ||
			name === 'aria-selected'
		) {
			this._paintSelection();
			return;
		}
		super.attributeChangedCallback( name, oldValue, newValue );
	}

	/** Class + ARIA half of `_paint()`. Never touches children. */
	private _paintSelection(): void {
		const selected = this.hasAttribute( 'selected' );
		const selectable = this.hasAttribute( 'selectable' );
		this.classList.toggle( `${ TILE_CLASS }--selected`, selected );
		this.setAttribute( 'role', selectable ? 'option' : 'listitem' );
		if ( selectable ) {
			// Guarded: writing `aria-selected` re-enters this callback,
			// and an unguarded write would recurse once per paint.
			const next = selected ? 'true' : 'false';
			if ( this.getAttribute( 'aria-selected' ) !== next ) {
				this.setAttribute( 'aria-selected', next );
			}
		} else {
			this.removeAttribute( 'aria-selected' );
		}
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
		const thumbnail = this.getAttribute( 'thumbnail' ) ?? '';
		const kind = this.getAttribute( 'kind' ) ?? 'entry';
		const status = this.getAttribute( 'status' ) ?? '';
		const selected = this.hasAttribute( 'selected' );
		const selectable = this.hasAttribute( 'selectable' );
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

		// Accessibility — the host acts as a button. On a canvas that
		// supports selection the tile becomes an `option` instead: a
		// `listitem` may not carry `aria-selected`, so a multi-select
		// grid of listitems announces nothing about what is picked.
		// The selection controller sets `selectable` when it registers
		// the tile, which is why this can't just key off `selected`.
		this.setAttribute( 'role', selectable ? 'option' : 'listitem' );
		if ( selectable ) {
			this.setAttribute( 'aria-selected', selected ? 'true' : 'false' );
		} else {
			this.removeAttribute( 'aria-selected' );
		}
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
		this.querySelectorAll( ':scope > os-ribbon' ).forEach( ( n ) =>
			n.remove(),
		);

		const visual = document.createElement( 'span' );
		visual.className = `${ TILE_CLASS }__visual`;
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

		// Status ribbon via `<os-ribbon>`.
		if (
			status &&
			status !== 'publish' &&
			STATUS_LABEL[ status ] &&
			statusRibbonsEnabled()
		) {
			const ribbon = document.createElement( 'os-ribbon' );
			ribbon.setAttribute( 'placement', 'top-end' );
			ribbon.setAttribute( 'tone', ribbonToneFor( status ) );
			ribbon.textContent = STATUS_LABEL[ status ];
			this.appendChild( ribbon );
		}

		applyTileEntryStagger( this );

		doAction( 'os.tile.rendered', { tile: this } );

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

defineComponent( 'os-tile', OsTile );
