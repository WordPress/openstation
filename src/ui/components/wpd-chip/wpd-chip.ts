/**
 * `<wpd-chip>` — small dismissible pill primitive.
 *
 * Renders a labelled pill with an optional leading icon slot and an
 * optional trailing close (×) button. Use it directly for read-only
 * chip lists (categories, statuses, badges with text) or compose
 * inside `<wpd-tag-input>` for full add/remove ergonomics.
 *
 * ```html
 * <!-- Read-only chip -->
 * <wpd-chip label="Drafts" tone="warning"></wpd-chip>
 *
 * <!-- Dismissible chip with leading icon -->
 * <wpd-chip label="WordPress" dismissible>
 *     <span slot="icon" class="dashicons dashicons-wordpress"></span>
 * </wpd-chip>
 * ```
 *
 * Emits `wpd-chip-dismiss` `{ label }` when the close button is
 * clicked or activated via the keyboard. Consumers handle the
 * actual removal — the component does NOT remove itself from the
 * DOM, leaving lifecycle to the parent (so REST roll-back, undo
 * affordances, animations are all consumer-driven).
 *
 * @public
 * @since 0.8.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-chip.styles';

export type WpdChipTone =
	| 'neutral'
	| 'accent'
	| 'positive'
	| 'warning'
	| 'danger';

export type WpdChipSize = 'default' | 'compact';

export class WpdChip extends Component {
	static props = [
		'label',
		'tone',
		'size',
		'dismissible',
		'disabled',
		'pending',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Chip',
		summary:
			'Labelled pill primitive with optional leading icon and trailing dismiss button. Tones mirror <wpd-badge>; pair with <wpd-tag-input> for full add/remove ergonomics.',
		status: 'experimental',
		since: '0.8.0',
		props: [
			{
				name: 'label',
				type: 'string',
				description:
					'Visible text. Falls back to the default slot when omitted.',
			},
			{
				name: 'tone',
				type: "'neutral' | 'accent' | 'positive' | 'warning' | 'danger'",
				default: 'neutral',
				description: 'Color variant. Mirrors <wpd-badge> tones.',
			},
			{
				name: 'size',
				type: "'default' | 'compact'",
				default: 'default',
				description:
					'Vertical density. Compact halves horizontal padding for dense lists.',
			},
			{
				name: 'dismissible',
				type: 'boolean attribute',
				description:
					'Renders a trailing × button. Click / Enter / Space emits wpd-chip-dismiss.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description:
					'Visually mutes the chip and blocks the dismiss button. Useful while a parent is mid-update.',
			},
			{
				name: 'pending',
				type: 'boolean attribute',
				description:
					'Renders a subtle pulse animation while a REST mutation is in flight. Auto-applied by <wpd-tag-input>; safe to set by hand.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Fallback label when `label` is unset.' },
			{
				name: 'icon',
				description: 'Leading icon (Dashicon, SVG, image). Inherits text color.',
			},
		],
		parts: [
			{ name: 'chip', description: 'The pill container.' },
			{
				name: 'dismiss',
				description: 'The trailing × button (when `dismissible`).',
			},
		],
		events: [
			{
				name: 'wpd-chip-dismiss',
				description:
					"Fires when the dismiss button is activated. Detail carries the chip's label so a delegated listener can act without DOM walking.",
				detail: '{ label: string }',
			},
		],
		cssProps: [
			{ name: '--wpd-chip-bg', description: 'Background color.' },
			{ name: '--wpd-chip-fg', description: 'Text color.' },
			{ name: '--wpd-chip-border', description: 'Border shorthand.' },
			{
				name: '--wpd-chip-padding',
				description: 'Padding shorthand.',
				default: '2px 8px',
			},
			{
				name: '--wpd-chip-radius',
				description: 'Corner radius.',
				default: '999px',
			},
			{
				name: '--wpd-chip-label-max',
				description: 'Max width of the inner label before ellipsis.',
				default: '220px',
			},
		],
		example: html`
			<wpd-cluster gap="6">
				<wpd-chip label="Neutral"></wpd-chip>
				<wpd-chip label="Accent" tone="accent"></wpd-chip>
				<wpd-chip label="Positive" tone="positive"></wpd-chip>
				<wpd-chip label="Warning" tone="warning"></wpd-chip>
				<wpd-chip label="Danger" tone="danger"></wpd-chip>
				<wpd-chip label="Dismissible" dismissible></wpd-chip>
			</wpd-cluster>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		// Activate dismiss with the keyboard too — listening on the
		// host (not just the inner button) so chips remain accessible
		// from outside the shadow boundary.
		this.addEventListener( 'keydown', this._onHostKeyDown );
	}

	disconnectedCallback(): void {
		this.removeEventListener( 'keydown', this._onHostKeyDown );
	}

	protected render() {
		const label =
			( this as unknown as { label: string | null } ).label ?? '';
		const dismissible =
			( this as unknown as { dismissible: string | null } ).dismissible !==
			null;
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;

		return html`
			<span part="chip" class="wpd-chip">
				<span class="wpd-chip__icon">
					<slot name="icon"></slot>
				</span>
				<span class="wpd-chip__label">
					${ label === '' ? html`<slot></slot>` : label }
				</span>
				${ dismissible
					? html`
							<button
								part="dismiss"
								class="wpd-chip__dismiss"
								type="button"
								aria-label=${ `Remove ${ label || 'chip' }` }
								?disabled=${ disabled }
								@click=${ ( e: MouseEvent ) => this._onDismiss( e ) }
							>
								${ _iconCross() }
							</button>
					  `
					: html`` }
			</span>
		`;
	}

	private _onDismiss( e: Event ): void {
		e.stopPropagation();
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		if ( disabled ) {
			return;
		}
		const label =
			( this as unknown as { label: string | null } ).label ?? '';
		this.emit( 'wpd-chip-dismiss', { label } );
	}

	private _onHostKeyDown = ( e: KeyboardEvent ): void => {
		const dismissible =
			( this as unknown as { dismissible: string | null } ).dismissible !==
			null;
		if ( ! dismissible ) {
			return;
		}
		// Activate the dismiss action when focus is on the host (or
		// inside the shadow boundary) and the user presses Backspace
		// or Delete — matches the OS-level "remove this token"
		// muscle memory.
		if ( e.key === 'Backspace' || e.key === 'Delete' ) {
			e.preventDefault();
			const disabled =
				( this as unknown as { disabled: string | null } ).disabled !== null;
			if ( disabled ) {
				return;
			}
			const label =
				( this as unknown as { label: string | null } ).label ?? '';
			this.emit( 'wpd-chip-dismiss', { label } );
		}
	};
}
defineComponent( 'wpd-chip', WpdChip );

function _iconCross() {
	return html`
		<svg
			viewBox="0 0 12 12"
			width="10"
			height="10"
			aria-hidden="true"
			focusable="false"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
		>
			<path d="M3 3 L9 9 M9 3 L3 9" />
		</svg>
	`;
}
