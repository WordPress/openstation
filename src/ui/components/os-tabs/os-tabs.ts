import { Component, defineComponent, html } from '../../core';
import {
	tabPanelStyles,
	tabStyles,
	tabsStyles,
} from './os-tabs.styles';

export class OsTab extends Component {
	static props = [ 'value' ] as const;
	static styles = [ tabStyles ];

	static help = {
		title: 'Tab',
		summary:
			'Single tab inside a <os-tabs> strip. Carries its identifier via `value`; aria-selected + tabindex are mirrored by the parent.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Identifier the tab contributes to the parent strip selection.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Visible tab label.' },
		],
		events: [
			{
				name: 'os-tab-pick',
				description: 'Internal event bubbled to the parent <os-tabs>. Consumers should listen for os-tab-change on the strip instead.',
				detail: '{ value: string | null }',
			},
		],

		example: html`
			<os-tabs value="one" label="Demo tabs">
				<os-tab value="one">One</os-tab>
				<os-tab value="two">Two</os-tab>
				<os-tab value="three">Three</os-tab>
			</os-tabs>
			<os-tabpanel for="one">The first panel.</os-tabpanel>
			<os-tabpanel for="two">The second panel.</os-tabpanel>
			<os-tabpanel for="three">The third panel.</os-tabpanel>
		`,
	} as const;

	protected render() {
		this.setAttribute( 'role', 'tab' );
		return html`
			<button type="button" @click=${ () => this._onPick() }>
				<slot></slot>
			</button>
		`;
	}

	private _onPick(): void {
		this.emit( 'os-tab-pick', {
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'os-tab', OsTab );

export class OsTabs extends Component {
	static props = [ 'value', 'label', 'orientation' ] as const;
	static styles = [ tabsStyles ];

	static help = {
		title: 'Tabs',
		summary:
			'Underline-accent tab strip. Pair with sibling <os-tabpanel for="…"> elements and the strip auto-toggles their hidden attribute on selection. Set orientation="vertical" for a sidebar instead of a strip.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Currently active tab value. Mirrored to child <os-tab> aria-selected.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'aria-label for the tablist — describe the tab group for assistive tech.',
			},
			{
				name: 'orientation',
				type: "'horizontal' | 'vertical'",
				description:
					'Lay the tabs across the top (default) or down the side. Vertical also sets aria-orientation and moves each tab\'s accent from an underline to a leading edge.',
			},
		],
		slots: [
			{
				name: '(default)',
				description: '<os-tab value="…"> children forming the strip.',
			},
		],
		events: [
			{
				name: 'os-tab-change',
				description: 'Fires when the active tab changes.',
				detail: '{ value: string }',
			},
		],
		example: html`
			<os-tabs value="one" label="Demo tabs">
				<os-tab value="one">One</os-tab>
				<os-tab value="two">Two</os-tab>
				<os-tab value="three">Three</os-tab>
			</os-tabs>
			<os-tabpanel for="one">First panel.</os-tabpanel>
			<os-tabpanel for="two">Second panel.</os-tabpanel>
			<os-tabpanel for="three">Third panel.</os-tabpanel>
		`,
	} as const;

	private _tabObserver: MutationObserver | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener( 'os-tab-pick', ( e: Event ) => {
			const detail = ( e as CustomEvent ).detail as { value: string };
			e.stopPropagation();
			( this as unknown as { value: string } ).value = detail.value;
			this.emit( 'os-tab-change', { value: detail.value } );
		} );
		this.addEventListener( 'keydown', this._onKeyDown );

		this._tabObserver = new MutationObserver( () => this.requestUpdate() );
		this._tabObserver.observe( this, { childList: true } );
	}

	disconnectedCallback(): void {
		this._tabObserver?.disconnect();
		this._tabObserver = null;
		this.removeEventListener( 'keydown', this._onKeyDown );
	}

	private _onKeyDown = ( e: KeyboardEvent ): void => {
		const vertical =
			( this as unknown as { orientation: string | null } ).orientation ===
			'vertical';
		const next = vertical ? 'ArrowDown' : 'ArrowRight';
		const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
		if (
			e.key !== next &&
			e.key !== prev &&
			e.key !== 'Home' &&
			e.key !== 'End'
		) {
			return;
		}

		const tabs = Array.from(
			this.querySelectorAll< HTMLElement >( 'os-tab' ),
		).filter( ( tab ) => ! tab.hasAttribute( 'data-search-hidden' ) );
		if ( tabs.length === 0 ) {
			return;
		}
		const current = ( this as unknown as { value: string | null } ).value;
		const at = tabs.findIndex(
			( tab ) => tab.getAttribute( 'value' ) === current,
		);
		let target = 0;
		if ( e.key === 'End' ) {
			target = tabs.length - 1;
		} else if ( e.key !== 'Home' ) {
			const step = e.key === next ? 1 : -1;

			target = ( at + step + tabs.length ) % tabs.length;
		}
		const value = tabs[ target ]?.getAttribute( 'value' );
		if ( ! value || value === current ) {
			return;
		}
		e.preventDefault();
		( this as unknown as { value: string } ).value = value;
		this.emit( 'os-tab-change', { value } );

		queueMicrotask( () => {
			tabs[ target ]?.focus();
		} );
	};

	set items( list: ReadonlyArray<{ value: string; label: string }> ) {
		replaceChildren( this, 'os-tab', list );

		const current =
			( this as unknown as { value: string | null } ).value;
		const stillValid =
			current !== null && list.some( ( i ) => i.value === current );
		if ( ! stillValid && list.length > 0 ) {
			( this as unknown as { value: string } ).value = list[ 0 ].value;
		} else {
			this.requestUpdate();
		}
	}

	protected render() {
		this.setAttribute( 'role', 'tablist' );
		const label = ( this as unknown as { label: string | null } ).label || '';
		if ( label ) {
			this.setAttribute( 'aria-label', label );
		}

		const vertical =
			( this as unknown as { orientation: string | null } ).orientation ===
			'vertical';
		this.setAttribute(
			'aria-orientation',
			vertical ? 'vertical' : 'horizontal',
		);

		for ( const tab of Array.from( this.querySelectorAll( 'os-tab' ) ) ) {
			if ( vertical ) {
				tab.setAttribute( 'data-orientation', 'vertical' );
			} else {
				tab.removeAttribute( 'data-orientation' );
			}
		}
		const current = ( this as unknown as { value: string | null } ).value;
		queueMicrotask( () => {
			const tabs = this.querySelectorAll( 'os-tab' );
			for ( const tab of Array.from( tabs ) ) {
				const v = tab.getAttribute( 'value' );
				tab.setAttribute(
					'aria-selected',
					v === current ? 'true' : 'false',
				);
				tab.setAttribute( 'tabindex', v === current ? '0' : '-1' );
			}
			syncTabpanels( this, current );
		} );
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-tabs', OsTabs );

export class OsTabPanel extends Component {
	static props = [ 'for' ] as const;
	static styles = [ tabPanelStyles ];

	static help = {
		title: 'Tab panel',
		summary:
			'Auto-managed panel paired with a sibling <os-tabs>. Declares which tab it belongs to via `for="<tab-value>"`; the parent strip toggles `hidden` whenever the active tab changes. role="tabpanel" and tabindex="0" are set automatically.',
		status: 'stable',
		props: [
			{
				name: 'for',
				type: 'string',
				description: 'Matches the `value` of the owning <os-tab>. Panel is shown when its parent tabs strip is on that value.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Panel body content.' },
		],

		example: html`
			<os-tabs value="two" label="Demo tabs">
				<os-tab value="one">One</os-tab>
				<os-tab value="two">Two</os-tab>
			</os-tabs>
			<os-tabpanel for="one">
				Hidden — the strip is on "two".
			</os-tabpanel>
			<os-tabpanel for="two">
				Visible, because this panel's <code>for</code> matches the
				strip's <code>value</code>.
			</os-tabpanel>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute( 'role', 'tabpanel' );
		if ( ! this.hasAttribute( 'tabindex' ) ) {
			this.setAttribute( 'tabindex', '0' );
		}

		const owner = findOwningTabs( this );
		if ( owner ) {
			syncTabpanels( owner, owner.getAttribute( 'value' ) );
		}
	}

	protected render() {
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-tabpanel', OsTabPanel );

function replaceChildren(
	host: HTMLElement,
	tag: string,
	items: ReadonlyArray<{ value: string; label: string }>,
): void {
	const existing = host.querySelectorAll( `:scope > ${ tag }` );
	for ( const el of Array.from( existing ) ) {
		el.remove();
	}
	for ( const item of items ) {
		const el = document.createElement( tag );
		el.setAttribute( 'value', item.value );
		el.textContent = item.label;
		host.appendChild( el );
	}
}

function findOwningTabs( panel: HTMLElement ): OsTabs | null {
	const parent = panel.parentElement;
	if ( ! parent ) {
		return null;
	}
	const sibling = parent.querySelector( ':scope > os-tabs' );
	if ( sibling ) {
		return sibling as OsTabs;
	}
	return panel.closest( 'os-tabs' ) as OsTabs | null;
}

function syncTabpanels( tabs: HTMLElement, value: string | null ): void {
	const panels = new Set< Element >();
	const parent = tabs.parentElement;
	if ( parent ) {
		for ( const p of Array.from(
			parent.querySelectorAll( ':scope > os-tabpanel' ),
		) ) {
			panels.add( p );
		}
	}
	for ( const p of Array.from(
		tabs.querySelectorAll( ':scope > os-tabpanel' ),
	) ) {
		panels.add( p );
	}
	for ( const panel of panels ) {
		const pfor = panel.getAttribute( 'for' );
		const active = pfor !== null && pfor === value;
		if ( active ) {
			panel.removeAttribute( 'hidden' );
		} else {
			panel.setAttribute( 'hidden', '' );
		}
		panel.setAttribute( 'aria-hidden', active ? 'false' : 'true' );
	}
}
