/**
 * `<os-card>` — generic, hover-aware container card.
 *
 * Same role `<article>` would play, plus:
 *
 *   - `interactive` makes the host focusable + click-emitting (cursor,
 *     tabindex=0, `role="button"`, Enter / Space keyboard fire the
 *     same `os-card-click` event as the mouse). Non-interactive
 *     cards stay inert — read-only digest tiles don't want a hover
 *     lift or a button role.
 *   - `selected` paints the accent ring (current item in a picker).
 *   - `disabled` fades the host and ignores pointer / key events.
 *   - Hover lift, shadow, smooth transition. `prefers-reduced-motion`
 *     disables every transform.
 *   - Three slot rhythms via `::slotted` rules so consumers can
 *     drop a plain `<header>` / `<footer>` and get the standard
 *     header-row / footer-pinned-to-bottom layout for free.
 *
 * The shape stays small — anything richer than "container with the
 * standard look" belongs to a feature-specific layer that wraps
 * `<os-card>` (e.g. the Plugins gallery card factory).
 *
 * Usage:
 *
 *   <os-card interactive @os-card-click="${ ... }">
 *     <header><img/><h3>Title</h3></header>
 *     <p>Description</p>
 *     <footer><span>meta</span><os-button>Action</os-button></footer>
 *   </os-card>
 *
 * Attributes:
 *   - `interactive` — boolean, surfaces hover lift + emits
 *                     `os-card-click`.
 *   - `selected`    — boolean, paints the accent ring.
 *   - `compact`     — boolean, smaller padding + radius.
 *   - `disabled`    — boolean, fades + blocks input.
 *   - `aria-label`  — used by screen readers as the card's name when
 *                     interactive (no inferred label).
 *
 * Events:
 *   - `os-card-click` — `{ originalEvent: MouseEvent | KeyboardEvent }`.
 *     Fired when an interactive card is clicked or Enter / Space is
 *     pressed. Skips clicks on `data-noclick` descendants so action
 *     buttons inside the card don't double-fire (matches
 *     `<os-table>`'s row-click semantics).
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-card.styles';

const NOCLICK_SELECTOR = '[data-noclick]';

interface CardClickDetail {
	originalEvent: MouseEvent | KeyboardEvent;
}

export class OsCard extends Component {
	static props = [
		'interactive',
		'selected',
		'compact',
		'disabled',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Card',
		summary:
			'Generic hover-aware container. Becomes click-emitting + focusable when `interactive`. Slots for header / default body / footer have built-in layout rhythm so consumers don\'t need bespoke wrapper components.',
		status: 'stable',
		props: [
			{
				name: 'interactive',
				type: 'boolean',
				default: 'false',
				description:
					'Surfaces hover lift + cursor + role="button" + emits `os-card-click` on click / Enter / Space.',
			},
			{
				name: 'selected',
				type: 'boolean',
				default: 'false',
				description:
					'Paints the accent ring — pickers / single-selection lists turn this on for the active card.',
			},
			{
				name: 'compact',
				type: 'boolean',
				default: 'false',
				description: 'Tighter padding + smaller radius for dense lists.',
			},
			{
				name: 'disabled',
				type: 'boolean',
				default: 'false',
				description:
					'Fades the card and blocks pointer / key input. No `os-card-click` while disabled.',
			},
		],
		events: [
			{
				name: 'os-card-click',
				detail: '{ originalEvent: MouseEvent | KeyboardEvent }',
				description:
					'Fires when an interactive card is activated. Skips events whose target is inside a `[data-noclick]` descendant so inline action buttons don\'t double-fire.',
			},
		],
		slots: [
			{
				name: '(default)',
				description: 'Card body. Free-form content.',
			},
			{
				name: 'header',
				description:
					'Top slot — laid out as a flex row with 12px gap. Drop an `<img>` / icon plus a title block.',
			},
			{
				name: 'footer',
				description:
					'Bottom slot — pinned via `margin-top: auto`. Standard pattern: meta on the left, primary CTA on the right.',
			},
		],
		cssProps: [
			{ name: '--os-ui-card-bg', default: '#fff' },
			{ name: '--os-ui-card-fg', default: 'inherit' },
			{ name: '--os-ui-card-padding', default: '16px' },
			{ name: '--os-ui-card-padding-compact', default: '10px' },
			{ name: '--os-ui-card-gap', default: '12px' },
			{ name: '--os-ui-card-gap-compact', default: '6px' },
			{ name: '--os-ui-card-radius', default: '12px' },
			{ name: '--os-ui-card-radius-compact', default: '8px' },
			{ name: '--os-ui-card-border', default: 'var(--os-ui-border, rgba(0,0,0,0.08))' },
			{ name: '--os-ui-card-border-hover', default: 'var(--os-ui-border-strong, rgba(0,0,0,0.16))' },
			{ name: '--os-ui-card-border-selected', default: 'var(--wp-admin-theme-color, #2271b1)' },
			{ name: '--os-ui-card-shadow-hover', default: '0 4px 16px rgba(0,0,0,0.08)' },
		],
		example: html`
			<os-card interactive>
				<header>
					<os-icon name="dashicons-admin-plugins" size="40"></os-icon>
					<div>
						<h3>Akismet</h3>
						<p>by Automattic</p>
					</div>
				</header>
				<p>The anti-spam service for WordPress sites.</p>
				<footer>
					<span>1M+ active</span>
					<os-button variant="primary" data-noclick>Install</os-button>
				</footer>
			</os-card>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		this._syncRoles();
		this.addEventListener( 'click', this._onClick );
		this.addEventListener( 'keydown', this._onKeyDown );
	}

	disconnectedCallback(): void {
		this.removeEventListener( 'click', this._onClick );
		this.removeEventListener( 'keydown', this._onKeyDown );
	}

	protected render() {
		// Re-sync the ARIA + tabindex set whenever a prop changes.
		// `connectedCallback` runs once on first mount; this picks up
		// `interactive`/`disabled` flips after that.
		this._syncRoles();
		// The glint is stamped unconditionally and gated in CSS to
		// [interactive]: a read-only digest tile that caught the light
		// on hover would be advertising a click it does not take.
		return html`<span class="os-holo-glint" aria-hidden="true"></span
			><slot name="header"></slot><slot></slot><slot name="footer"></slot>`;
	}

	private _syncRoles(): void {
		const interactive = this.hasAttribute( 'interactive' );
		const disabled = this.hasAttribute( 'disabled' );
		if ( interactive ) {
			if ( ! this.hasAttribute( 'role' ) ) {
				this.setAttribute( 'role', 'button' );
			}
			// Disabled cards are NOT focusable — Tab order skips them.
			this.setAttribute( 'tabindex', disabled ? '-1' : '0' );
			this.setAttribute( 'aria-disabled', disabled ? 'true' : 'false' );
		} else {
			this.removeAttribute( 'role' );
			this.removeAttribute( 'tabindex' );
			this.removeAttribute( 'aria-disabled' );
		}
	}

	private _onClick = ( ev: MouseEvent ): void => {
		if ( ! this.hasAttribute( 'interactive' ) || this.hasAttribute( 'disabled' ) ) {
			return;
		}
		const target = ev.target as HTMLElement | null;
		if ( target?.closest( NOCLICK_SELECTOR ) ) {
			return;
		}
		this._emitCardClick( ev );
	};

	private _onKeyDown = ( ev: KeyboardEvent ): void => {
		if ( ! this.hasAttribute( 'interactive' ) || this.hasAttribute( 'disabled' ) ) {
			return;
		}
		if ( ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar' ) {
			return;
		}
		const target = ev.target as HTMLElement | null;
		if ( target && target !== this && target.closest( NOCLICK_SELECTOR ) ) {
			return;
		}
		// Don't double-fire when the user pressed Space INSIDE a button —
		// the button's own click handler already runs.
		if (
			target instanceof HTMLElement &&
			target !== this &&
			( target.tagName === 'BUTTON' ||
				target.tagName === 'A' ||
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' )
		) {
			return;
		}
		ev.preventDefault();
		this._emitCardClick( ev );
	};

	private _emitCardClick( originalEvent: MouseEvent | KeyboardEvent ): void {
		this.dispatchEvent(
			new CustomEvent< CardClickDetail >( 'os-card-click', {
				detail: { originalEvent },
				bubbles: true,
				composed: true,
			} ),
		);
	}
}

defineComponent( 'os-card', OsCard );
