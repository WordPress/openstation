/**
 * `<os-context-menu>` + `<os-context-menu-option>` — reusable
 * floating menu primitives.
 *
 * Two scenarios drive these in-tree today:
 *
 *   1. The wallpaper context menu (right-click / click on the
 *      empty desktop) with submenu support.
 *   2. The file-tile context menu (right-click on a tile).
 *
 * Both previously hand-built the same DOM (`.os-wallpaper-menu`,
 * `.os-wallpaper-menu__item`, …) — converging onto
 * Web Components removes the duplication and gives plugin authors
 * a stable, declarative way to build their own context menus
 * without copying CSS.
 *
 * ```html
 * <os-context-menu open style="left: 50px; top: 60px;">
 *     <os-context-menu-option icon="dashicons-portfolio">New folder</os-context-menu-option>
 *     <os-context-menu-option heading>Sort by</os-context-menu-option>
 *     <os-context-menu-option>Name (A → Z)</os-context-menu-option>
 *     <os-context-menu-option danger>Remove</os-context-menu-option>
 * </os-context-menu>
 * ```
 *
 * Options dispatch a bubbling `os-context-menu-pick` CustomEvent
 * with `{ id, value? }` when activated. Headings ignore clicks.
 *
 * Submenus are consumer-driven: set the `has-children` attribute
 * to render the trailing chevron, then open and position your own
 * flyout `<os-context-menu>` on hover / activate (see
 * src/desktop-files/wallpaper-menu.ts and src/icon-canvas/menu.ts
 * for the canonical rigs).
 */

import {
	Component,
	defineComponent,
	html,
} from '../../core';
import { menuStyles, optionStyles } from './os-context-menu.styles';

/** `<os-context-menu>`. */
export class OsContextMenu extends Component {
	static props = [ 'open' ] as const;
	static styles = [ menuStyles ];

	static help = {
		title: 'Context menu',
		summary:
			'Floating popup menu primitive. Pair with <os-context-menu-option> children. Toggle via the `open` boolean attribute. Listen for `os-context-menu-pick` to handle activation.',
		status: 'stable',
		props: [
			{
				name: 'open',
				type: 'boolean attribute',
				description: 'Mounts the menu in its open / visible state.',
			},
		],
		slots: [
			{ name: '(default)', description: 'List of <os-context-menu-option> items.' },
		],
		events: [
			{
				name: 'os-context-menu-pick',
				description: 'Bubbled from a non-disabled, non-heading option on activation. Detail: `{ id, value }`.',
			},
		],
		/*
		 * Shown open and pinned back into normal flow.
		 *
		 * In use the menu is `position: fixed` and placed at the
		 * pointer, which in a documentation pane means it would either
		 * be invisible (closed) or floating over the settings window
		 * at coordinates nothing set (open). The inline
		 * `position: relative` beats the `:host` rule and puts it in
		 * the page where it can actually be looked at — the one thing
		 * the example is for.
		 */
		example: html`
			<os-context-menu open style="position: relative; z-index: 0">
				<os-context-menu-option heading>Window</os-context-menu-option>
				<os-context-menu-option value="open" icon="dashicons-external">
					Open in a new window
				</os-context-menu-option>
				<os-context-menu-option value="rename" icon="dashicons-edit">
					Rename…
				</os-context-menu-option>
				<os-context-menu-option value="more" icon="dashicons-portfolio" has-children>
					Move to
				</os-context-menu-option>
				<os-context-menu-option value="locked" icon="dashicons-lock" disabled>
					Permissions
				</os-context-menu-option>
				<os-context-menu-option value="trash" icon="dashicons-trash" danger>
					Move to Recycle Bin
				</os-context-menu-option>
			</os-context-menu>
		`,
	} as const;

	protected render() {
		return html`
			<slot></slot>
		`;
	}

	connectedCallback() {
		super.connectedCallback();
		this.setAttribute( 'role', 'menu' );
	}
}
defineComponent( 'os-context-menu', OsContextMenu );

/** `<os-context-menu-option>`. */
export class OsContextMenuOption extends Component {
	static props = [
		'value',
		'icon',
		'disabled',
		'danger',
		'heading',
		'has-children',
		'checked',
	] as const;
	static styles = [ optionStyles ];

	static help = {
		title: 'Context menu option',
		summary:
			'Single row inside <os-context-menu>. Use `icon` for a leading dashicon, `danger` for destructive items, `heading` for a non-interactive section header, `has-children` to render a trailing chevron.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Forwarded as `detail.value` on activation.',
			},
			{
				name: 'icon',
				type: 'string',
				description: 'Dashicon class (e.g. `dashicons-trash`).',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Renders the option dimmed; clicks are ignored.',
			},
			{
				name: 'danger',
				type: 'boolean attribute',
				description: 'Destructive styling — red text, red hover.',
			},
			{
				name: 'heading',
				type: 'boolean attribute',
				description: 'Non-interactive section header. Ignores clicks.',
			},
			{
				name: 'has-children',
				type: 'boolean attribute',
				description: 'Renders a trailing chevron to suggest a submenu.',
			},
			{
				name: 'checked',
				type: 'boolean attribute',
				description: 'Renders a leading check mark — for radio-style picks inside a submenu (e.g. the active Sort By order).',
			},
		],
		slots: [
			{ name: '(default)', description: 'Visible label.' },
		],
		events: [
			{
				name: 'os-context-menu-pick',
				description: 'Bubbled on click / Enter for non-heading non-disabled options. Detail: `{ id, value }`.',
			},
		],
		/*
		 * An option only has a shape inside a menu — on its own it is
		 * an unpadded row on the panel background. So the example is
		 * the parent in miniature, showing every modifier this
		 * component actually has.
		 */
		example: html`
			<os-context-menu open style="position: relative; z-index: 0">
				<os-context-menu-option heading>Every variant</os-context-menu-option>
				<os-context-menu-option value="plain">Plain</os-context-menu-option>
				<os-context-menu-option value="icon" icon="dashicons-admin-page">
					With an icon
				</os-context-menu-option>
				<os-context-menu-option value="checked" checked>
					Checked
				</os-context-menu-option>
				<os-context-menu-option value="children" has-children>
					With a submenu
				</os-context-menu-option>
				<os-context-menu-option value="off" disabled>Disabled</os-context-menu-option>
				<os-context-menu-option value="del" danger icon="dashicons-trash">
					Danger
				</os-context-menu-option>
			</os-context-menu>
		`,
	} as const;

	connectedCallback() {
		super.connectedCallback();
		const isHeading = this.hasAttribute( 'heading' );
		this.setAttribute( 'role', isHeading ? 'presentation' : 'menuitem' );
		if ( ! isHeading ) {
			this.setAttribute( 'tabindex', '0' );
		}
		this.addEventListener( 'click', this._onActivate );
		this.addEventListener( 'keydown', this._onKey );
	}

	disconnectedCallback() {
		this.removeEventListener( 'click', this._onActivate );
		this.removeEventListener( 'keydown', this._onKey );
	}

	private _onActivate = ( e: Event ): void => {
		if ( this.hasAttribute( 'disabled' ) || this.hasAttribute( 'heading' ) ) {
			return;
		}
		// Don't fire for clicks that came from a nested submenu —
		// those bubble through this option on their way up. Use
		// `currentTarget` (the option this listener is on) as the
		// reference; `composedPath()` can be empty in some
		// environments mid-dispatch.
		const target = e.target as Element | null;
		if (
			target &&
			target !== this &&
			target.closest( 'os-context-menu-option' ) !== this
		) {
			return;
		}
		this.emit( 'os-context-menu-pick', {
			id: ( this.dataset.menuItemId as string | undefined ) ?? this.id ?? '',
			value: this.getAttribute( 'value' ) ?? '',
		} );
	};

	private _onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Enter' || e.key === ' ' ) {
			e.preventDefault();
			this._onActivate( e );
		}
	};

	protected render() {
		const icon = this.getAttribute( 'icon' );
		const hasChildren = this.hasAttribute( 'has-children' );
		const checked = this.hasAttribute( 'checked' );
		// Chevron + check are rendered as plain unicode glyphs rather
		// than dashicons because the dashicons font's `:before` content
		// rules live in the parent document and don't pierce the
		// component's shadow root — so a `class="dashicons …"` span
		// renders empty in this context.
		return html`
			${ checked
				? html`<span class="check" aria-hidden="true">✓</span>`
				: html`` }
			${ icon
				? html`<span class="icon dashicons ${ icon }" aria-hidden="true"></span>`
				: html`` }
			<span class="label"><slot></slot></span>
			${ hasChildren
				? html`<span class="chevron" aria-hidden="true">›</span>`
				: html`` }
		`;
	}
}
defineComponent( 'os-context-menu-option', OsContextMenuOption );
