/**
 * `<os-menu>` + `<os-menu-item>` — popover menu used in the
 * window title bar's ⋯ dropdown. Presentation-only: the consumer
 * (Window) owns the open/close state via the `hidden` attribute
 * and its own outside-click dismissal — the component doesn't
 * try to manage that itself, because the trigger button is OUTSIDE
 * the menu and every consumer wires it differently.
 *
 * Menu-items take one of three looks:
 *
 *   - Plain           — just a label.
 *   - With icon       — `icon="dashicons-…"` dashicon class on the
 *                       left (used by "Open another X").
 *   - Checkbox        — `role="menuitemcheckbox" ?checked=${…}`
 *                       renders a 16 px check indicator (used by
 *                       "Open on startup").
 *
 * Click on an item emits `os-menu-item-click` bubbling, with the
 * item's `value` attribute in `detail.value`.
 */

import { Component, defineComponent, html } from '../../core';
import { menuItemStyles, menuStyles } from './os-menu.styles';

export class OsMenu extends Component {
	static styles = [ menuStyles ];

	static help = {
		title: 'Menu',
		summary:
			'Popover menu used in window title bars and other overflow triggers. Presentation-only: the consumer owns open/close state via the `hidden` attribute and any outside-click dismissal.',
		status: 'stable',
		slots: [
			{ name: '(default)', description: '<os-menu-item> children.' },
		],
		cssProps: [
			{ name: '--os-window-bg', description: 'Menu background.' },
			{ name: '--os-window-border', description: 'Menu border.' },
			{ name: '--os-ui-fg', description: 'Item text colour.' },
		],
		example: html`
			<os-menu>
				<os-menu-item value="new" icon="dashicons-plus">Open another window</os-menu-item>
				<os-menu-item value="startup" role="menuitemcheckbox" checked>Open on startup</os-menu-item>
				<os-menu-item value="close">Close window</os-menu-item>
			</os-menu>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute( 'role', 'menu' );
	}

	protected render() {
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-menu', OsMenu );

export class OsMenuItem extends Component {
	static props = [ 'icon', 'value', 'checked' ] as const;
	static styles = [ menuItemStyles ];

	static help = {
		title: 'Menu item',
		summary:
			'Single row inside a <os-menu>. Supports three looks: plain label, left-aligned dashicon (icon="dashicons-…"), or a checkbox indicator (role="menuitemcheckbox" + checked).',
		status: 'stable',
		props: [
			{
				name: 'icon',
				type: 'string (dashicons class)',
				description: 'Dashicons class rendered on the left. Ignored when role="menuitemcheckbox".',
			},
			{
				name: 'value',
				type: 'string',
				description: 'Identifier emitted in os-menu-item-click.detail.value.',
			},
			{
				name: 'checked',
				type: 'boolean attribute',
				description: 'Visible check indicator. Only honoured when role="menuitemcheckbox".',
			},
		],
		slots: [
			{ name: '(default)', description: 'Menu item label.' },
		],
		events: [
			{
				name: 'os-menu-item-click',
				description: 'Fires when the item is clicked; bubbles so the <os-menu> parent can delegate.',
				detail: '{ value: string | null }',
			},
		],
		/*
		 * An item has no shape outside a menu — it takes its padding,
		 * width and surface from the parent — so the example is the
		 * parent in miniature, showing each modifier the item has.
		 */
		example: html`
			<os-menu>
				<os-menu-item value="plain">Plain item</os-menu-item>
				<os-menu-item value="icon" icon="dashicons-external">
					With an icon
				</os-menu-item>
				<os-menu-item value="startup" role="menuitemcheckbox" checked>
					Checked (menuitemcheckbox)
				</os-menu-item>
			</os-menu>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		// Default to `menuitem` role; consumer can override to
		// `menuitemcheckbox` via the role attribute.
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'menuitem' );
		}
	}

	protected render() {
		const icon = ( this as unknown as { icon: string | null } ).icon || '';
		const isCheckbox = this.getAttribute( 'role' ) === 'menuitemcheckbox';
		const checked =
			( this as unknown as { checked: string | null } ).checked !== null;
		// Sync aria-checked for checkbox variants — screen readers
		// need the live value, not just the `checked` attribute.
		if ( isCheckbox ) {
			this.setAttribute( 'aria-checked', checked ? 'true' : 'false' );
		}
		return html`
			<button type="button" @click=${ ( e: Event ) => this._onPick( e ) }>
				<span
					class="os-menu-item__check"
					?hidden=${ ! isCheckbox }
				></span>
				<span
					class="os-menu-item__icon dashicons ${ icon }"
					aria-hidden="true"
					?hidden=${ isCheckbox || ! icon }
				></span>
				<span class="os-menu-item__label">
					<slot></slot>
				</span>
			</button>
		`;
	}

	private _onPick( e: Event ): void {
		e.preventDefault();
		this.emit( 'os-menu-item-click', {
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'os-menu-item', OsMenuItem );
