import { Component, defineComponent, html } from '../../core';
import { renderIcon } from '../../../icon';
import { applyTileEntryStagger } from '../../../utils';
import { doAction } from '../../../hooks';
import type { DragManagerApi } from '../../../drag';
import type { ShortcutDragData } from '../../../desktop-files/drag-payloads';
import { styles } from './os-tile.styles';
import '../os-ribbon/os-ribbon';

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

	private _onSettingsSave = ( e: Event ): void => {
		const detail = ( e as CustomEvent ).detail as { phase?: string } | undefined;
		if ( detail?.phase === 'saved' ) {
			this._paint();
		}
	};

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
		document.addEventListener( 'os-settings-save-lifecycle', this._onSettingsSave );

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
		document.removeEventListener( 'os-settings-save-lifecycle', this._onSettingsSave );
	}

	protected requestUpdate(): void {
		if ( ! this.isConnected ) {
			return;
		}
		this._paint();
	}

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

	private _paintSelection(): void {
		const selected = this.hasAttribute( 'selected' );
		const selectable = this.hasAttribute( 'selectable' );
		this.classList.toggle( `${ TILE_CLASS }--selected`, selected );
		this.setAttribute( 'role', selectable ? 'option' : 'listitem' );
		if ( selectable ) {
			const next = selected ? 'true' : 'false';
			if ( this.getAttribute( 'aria-selected' ) !== next ) {
				this.setAttribute( 'aria-selected', next );
			}
		} else {
			this.removeAttribute( 'aria-selected' );
		}
	}

	protected render() {
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

		this.dataset.fileType = type;
		this.dataset.fileRef = ref;
		if ( kind ) {
			this.dataset.role = kind;
		}

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
