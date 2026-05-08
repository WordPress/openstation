/**
 * `<wpd-context-menu>` + `<wpd-context-menu-option>` — reusable
 * floating menu primitives.
 *
 * Two scenarios drive these in-tree today:
 *
 *   1. The wallpaper context menu (right-click / click on the
 *      empty desktop) with submenu support.
 *   2. The file-tile context menu (right-click on a tile).
 *
 * Both previously hand-built the same DOM (`.desktop-mode-wallpaper-menu`,
 * `.desktop-mode-wallpaper-menu__item`, …) — converging onto
 * Web Components removes the duplication and gives plugin authors
 * a stable, declarative way to build their own context menus
 * without copying CSS.
 *
 * ```html
 * <wpd-context-menu open style="left: 50px; top: 60px;">
 *     <wpd-context-menu-option icon="dashicons-portfolio">New folder</wpd-context-menu-option>
 *     <wpd-context-menu-option heading>Sort by</wpd-context-menu-option>
 *     <wpd-context-menu-option>Name (A → Z)</wpd-context-menu-option>
 *     <wpd-context-menu-option danger>Remove</wpd-context-menu-option>
 * </wpd-context-menu>
 * ```
 *
 * Options dispatch a bubbling `wpd-context-menu-pick` CustomEvent
 * with `{ id, value? }` when activated. Headings ignore clicks.
 *
 * Submenus: an option with a `<wpd-context-menu>` slotted as its
 * child renders a chevron and shows the nested menu on hover /
 * activate. The framework positions the submenu to the right
 * (or left when it'd spill).
 *
 * @since 0.9.0
 */

import {
	Component,
	defineComponent,
	html,
} from '../../core';
import { menuStyles, optionStyles } from './wpd-context-menu.styles';

/** `<wpd-context-menu>`. */
export class WpdContextMenu extends Component {
	static props = [ 'open' ] as const;
	static styles = [ menuStyles ];

	static help = {
		title: 'Context menu',
		summary:
			'Floating popup menu primitive. Pair with <wpd-context-menu-option> children. Toggle via the `open` boolean attribute. Listen for `wpd-context-menu-pick` to handle activation.',
		status: 'experimental',
		since: '0.9.0',
		props: [
			{
				name: 'open',
				type: 'boolean attribute',
				description: 'Mounts the menu in its open / visible state.',
			},
		],
		slots: [
			{ name: '(default)', description: 'List of <wpd-context-menu-option> items.' },
		],
		events: [
			{
				name: 'wpd-context-menu-pick',
				description: 'Bubbled from a non-disabled, non-heading option on activation. Detail: `{ id, value }`.',
			},
		],
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
defineComponent( 'wpd-context-menu', WpdContextMenu );

/** `<wpd-context-menu-option>`. */
export class WpdContextMenuOption extends Component {
	static props = [
		'value',
		'icon',
		'disabled',
		'danger',
		'heading',
		'has-children',
	] as const;
	static styles = [ optionStyles ];

	static help = {
		title: 'Context menu option',
		summary:
			'Single row inside <wpd-context-menu>. Use `icon` for a leading dashicon, `danger` for destructive items, `heading` for a non-interactive section header, `has-children` to render a trailing chevron.',
		status: 'experimental',
		since: '0.9.0',
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
		],
		slots: [
			{ name: '(default)', description: 'Visible label + optional nested <wpd-context-menu>.' },
		],
		events: [
			{
				name: 'wpd-context-menu-pick',
				description: 'Bubbled on click / Enter for non-heading non-disabled options. Detail: `{ id, value }`.',
			},
		],
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
			target.closest( 'wpd-context-menu-option' ) !== this
		) {
			return;
		}
		this.emit( 'wpd-context-menu-pick', {
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
		return html`
			${ icon
				? html`<span class="icon dashicons ${ icon }" aria-hidden="true"></span>`
				: html`` }
			<span class="label"><slot></slot></span>
			${ hasChildren
				? html`<span class="chevron dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>`
				: html`` }
		`;
	}
}
defineComponent( 'wpd-context-menu-option', WpdContextMenuOption );
