/**
 * `<wpd-tabs>` + `<wpd-tab>` + `<wpd-tabpanel>` — underline-accent
 * tab strip with an optional auto-swap panel layer.
 *
 * The parent `<wpd-tabs>` owns the `value` prop; `<wpd-tab>` children
 * reflect selection via `aria-selected`. Callers declare panes as
 * sibling `<wpd-tabpanel for="…">` elements — the tab strip toggles
 * `hidden` on each panel based on its own `value`, so plugin authors
 * no longer have to hand-wire a `wpd-tab-change` listener and a
 * `panel.hidden = …` ladder for every tabbed native window.
 *
 * ```html
 * <wpd-tabs value="calc">
 *     <wpd-tab value="calc">Calc</wpd-tab>
 *     <wpd-tab value="convert">Convert</wpd-tab>
 * </wpd-tabs>
 * <wpd-tabpanel for="calc">…calc UI…</wpd-tabpanel>
 * <wpd-tabpanel for="convert">…convert UI…</wpd-tabpanel>
 * ```
 *
 * Callers still receive `wpd-tab-change` on the tab strip if they
 * need custom behaviour — the auto-swap is opt-in per panel, not a
 * replacement for the event.
 */

import { Component, defineComponent, html } from '../../core';
import {
	tabPanelStyles,
	tabStyles,
	tabsStyles,
} from './wpd-tabs.styles';

export class WpdTab extends Component {
	static props = [ 'value' ] as const;
	static styles = [ tabStyles ];

	static help = {
		title: 'Tab',
		summary:
			'Single tab inside a <wpd-tabs> strip. Carries its identifier via `value`; aria-selected + tabindex are mirrored by the parent.',
		status: 'stable',
		since: '0.7.0',
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
				name: 'wpd-tab-pick',
				description: 'Internal event bubbled to the parent <wpd-tabs>. Consumers should listen for wpd-tab-change on the strip instead.',
				detail: '{ value: string | null }',
			},
		],
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
		this.emit( 'wpd-tab-pick', {
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'wpd-tab', WpdTab );

export class WpdTabs extends Component {
	static props = [ 'value', 'label' ] as const;
	static styles = [ tabsStyles ];

	static help = {
		title: 'Tabs',
		summary:
			'Underline-accent tab strip. Pair with sibling <wpd-tabpanel for="…"> elements and the strip auto-toggles their hidden attribute on selection.',
		status: 'stable',
		since: '0.7.0',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Currently active tab value. Mirrored to child <wpd-tab> aria-selected.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'aria-label for the tablist — describe the tab group for assistive tech.',
			},
		],
		slots: [
			{
				name: '(default)',
				description: '<wpd-tab value="…"> children forming the strip.',
			},
		],
		events: [
			{
				name: 'wpd-tab-change',
				description: 'Fires when the active tab changes.',
				detail: '{ value: string }',
			},
		],
		example: html`
			<wpd-tabs value="one" label="Demo tabs">
				<wpd-tab value="one">One</wpd-tab>
				<wpd-tab value="two">Two</wpd-tab>
				<wpd-tab value="three">Three</wpd-tab>
			</wpd-tabs>
			<wpd-tabpanel for="one">First panel.</wpd-tabpanel>
			<wpd-tabpanel for="two">Second panel.</wpd-tabpanel>
			<wpd-tabpanel for="three">Third panel.</wpd-tabpanel>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener( 'wpd-tab-pick', ( e: Event ) => {
			const detail = ( e as CustomEvent ).detail as { value: string };
			e.stopPropagation();
			( this as unknown as { value: string } ).value = detail.value;
			this.emit( 'wpd-tab-change', { value: detail.value } );
		} );
	}

	/**
	 * Declarative item-list setter. Replaces the existing `<wpd-tab>`
	 * children with a fresh set built from a `{ value, label }`
	 * array. The `value` prop is preserved if it still matches a new
	 * entry; otherwise it falls back to the first item.
	 *
	 * Lets plugins that populate tabs dynamically (route-driven
	 * admin screens, filtered lists) replace the declarative
	 * markup with a one-liner:
	 *
	 * ```js
	 * tabs.items = [
	 *   { value: 'calc',    label: 'Calc' },
	 *   { value: 'convert', label: 'Convert' },
	 * ];
	 * ```
	 */
	set items( list: ReadonlyArray<{ value: string; label: string }> ) {
		replaceChildren( this, 'wpd-tab', list );
		// Preserve existing `value` if it still resolves to an
		// entry — otherwise default to the first item. Setting the
		// property triggers a re-render (which runs the aria mirror
		// + the panel swap below).
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
		// Mirror the current `value` onto each child tab via
		// aria-selected. Children live in LIGHT DOM; deferred one
		// microtask so newly-added children have a chance to upgrade
		// before we read them.
		const current = ( this as unknown as { value: string | null } ).value;
		queueMicrotask( () => {
			const tabs = this.querySelectorAll( 'wpd-tab' );
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
defineComponent( 'wpd-tabs', WpdTabs );

/**
 * `<wpd-tabpanel>` — auto-managed panel container that pairs with a
 * sibling `<wpd-tabs>`. Each panel declares which tab it belongs to
 * via `for="<tab-value>"`, and the parent tab strip toggles `hidden`
 * on every panel whenever the active `value` changes.
 *
 * Panels are expected to be siblings of the `<wpd-tabs>` element
 * under a common parent — the usual native-window layout:
 *
 * ```html
 * <wpd-stack>
 *   <wpd-tabs value="calc">...</wpd-tabs>
 *   <wpd-tabpanel for="calc">...</wpd-tabpanel>
 *   <wpd-tabpanel for="convert">...</wpd-tabpanel>
 * </wpd-stack>
 * ```
 *
 * Accessibility: `role="tabpanel"` + `tabindex="0"` are set
 * automatically so keyboard users can tab into an active panel.
 */
export class WpdTabPanel extends Component {
	static props = [ 'for' ] as const;
	static styles = [ tabPanelStyles ];

	static help = {
		title: 'Tab panel',
		summary:
			'Auto-managed panel paired with a sibling <wpd-tabs>. Declares which tab it belongs to via `for="<tab-value>"`; the parent strip toggles `hidden` whenever the active tab changes. role="tabpanel" and tabindex="0" are set automatically.',
		status: 'stable',
		since: '0.5.0',
		props: [
			{
				name: 'for',
				type: 'string',
				description: 'Matches the `value` of the owning <wpd-tab>. Panel is shown when its parent tabs strip is on that value.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Panel body content.' },
		],
	} as const;
	// Shadow DOM — the render target for this component is its
	// own shadow root, which holds a single `<slot>` that projects
	// whatever the caller placed between the `<wpd-tabpanel>` open
	// and close tags. Slotted children remain light-DOM descendants
	// of the panel element (the slot rendering mechanism doesn't
	// move them), so `panel.querySelector(...)` from plugin render
	// callbacks keeps working.
	//
	// Earlier 0.5.0 builds of this component used light DOM with
	// a `<slot>` render, which wiped the panel's server-rendered
	// template content on first mount — every `render()` writes
	// into `_renderRoot`, and with light DOM that's the panel
	// itself. Shadow DOM isolates the render surface.

	connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute( 'role', 'tabpanel' );
		if ( ! this.hasAttribute( 'tabindex' ) ) {
			this.setAttribute( 'tabindex', '0' );
		}
		// If our sibling tab strip already has a value, honour it on
		// first paint. Covers the "panel added after mount" path.
		const owner = findOwningTabs( this );
		if ( owner ) {
			syncTabpanels( owner, owner.getAttribute( 'value' ) );
		}
	}

	protected render() {
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-tabpanel', WpdTabPanel );

/**
 * Replace every child of `host` whose tag matches `tag` with a
 * freshly-created element per entry in `items`. Shared between the
 * `.items` setters on tabs, segmented, and select — the dance is
 * the same shape in every component.
 *
 * Kept private-ish (not exported) because the semantics are
 * component-specific (remove only the matching tag, preserve other
 * siblings like icons or editor chrome). Callers that need
 * different behaviour (e.g. preserving ordering of unrelated
 * siblings) should not use this helper.
 *
 * @internal
 */
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

/**
 * Find the `<wpd-tabs>` element a panel belongs to. Looks for a
 * sibling with `role="tablist"` under the same parent; falls back
 * to the nearest `<wpd-tabs>` ancestor if panels are wrapped inside
 * the tab strip itself.
 *
 * @internal
 */
function findOwningTabs( panel: HTMLElement ): WpdTabs | null {
	const parent = panel.parentElement;
	if ( ! parent ) {
		return null;
	}
	const sibling = parent.querySelector( ':scope > wpd-tabs' );
	if ( sibling ) {
		return sibling as WpdTabs;
	}
	return panel.closest( 'wpd-tabs' ) as WpdTabs | null;
}

/**
 * Toggle `hidden` on each `<wpd-tabpanel>` based on whether its
 * `for` attribute matches `value`. Called from `<wpd-tabs>`'s render
 * + from each `<wpd-tabpanel>`'s connect hook so late-added panels
 * pick up the current active tab immediately.
 *
 * Two layouts are supported:
 *   1. **Siblings** (the documented canonical shape) — panels live
 *      under the same parent as the tabs strip.
 *   2. **Nested** — panels live INSIDE the `<wpd-tabs>` element. This
 *      reads more naturally for plugin authors used to other tab
 *      libraries (Material, Bootstrap) where panels group with the
 *      strip; honouring it avoids "all panels visible at once" bugs
 *      when a caller follows their muscle memory.
 *
 * Both shapes are walked; a `Set` de-duplicates the rare case where
 * a panel matches both selectors.
 *
 * @internal
 */
function syncTabpanels( tabs: HTMLElement, value: string | null ): void {
	const panels = new Set< Element >();
	const parent = tabs.parentElement;
	if ( parent ) {
		for ( const p of Array.from(
			parent.querySelectorAll( ':scope > wpd-tabpanel' ),
		) ) {
			panels.add( p );
		}
	}
	for ( const p of Array.from(
		tabs.querySelectorAll( ':scope > wpd-tabpanel' ),
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
