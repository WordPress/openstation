/**
 * `<os-chip>` — small dismissible pill primitive.
 *
 * Renders a labelled pill with an optional leading icon slot and an
 * optional trailing close (×) button. Use it directly for read-only
 * chip lists (categories, statuses, badges with text) or compose
 * inside `<os-tag-input>` for full add/remove ergonomics.
 *
 * ```html
 * <!-- Read-only chip -->
 * <os-chip label="Drafts" tone="warning"></os-chip>
 *
 * <!-- Dismissible chip with leading icon -->
 * <os-chip label="WordPress" dismissible>
 *     <span slot="icon" class="dashicons dashicons-wordpress"></span>
 * </os-chip>
 * ```
 *
 * Emits `os-chip-dismiss` `{ label }` when the close button is
 * clicked or activated via the keyboard. Consumers handle the
 * actual removal — the component does NOT remove itself from the
 * DOM, leaving lifecycle to the parent (so REST roll-back, undo
 * affordances, animations are all consumer-driven).
 *
 * @public
 */

import { Component, defineComponent, html } from '../../core';
import { osIcon } from '../../icons';
import { styles } from './os-chip.styles';

export type OsChipTone =
	| 'neutral'
	| 'accent'
	| 'positive'
	| 'warning'
	| 'danger';

export type OsChipSize = 'default' | 'compact';

export class OsChip extends Component {
	static props = [
		'label',
		'tone',
		'size',
		'dismissible',
		'disabled',
		'pending',
		'selected',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Chip',
		summary:
			'Labelled pill primitive with optional leading icon and trailing dismiss button. Tones mirror <os-badge>; pair with <os-tag-input> for full add/remove ergonomics.',
		status: 'stable',
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
				description: 'Color variant. Mirrors <os-badge> tones.',
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
					'Renders a trailing × button. Click / Enter / Space emits os-chip-dismiss.',
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
					'Renders a subtle pulse animation while a REST mutation is in flight. Auto-applied by <os-tag-input>; safe to set by hand.',
			},
			{
				name: 'selected',
				type: 'boolean attribute',
				description:
					'Marks the chip as chosen: an accent wash plus the kit’s iridescent hairline. Deliberately the only state that gets the hairline — chips arrive in rows of a dozen, and an edge on all of them is noise.',
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
				name: 'os-chip-dismiss',
				description:
					"Fires when the dismiss button is activated. Detail carries the chip's label so a delegated listener can act without DOM walking.",
				detail: '{ label: string }',
			},
		],
		cssProps: [
			{ name: '--os-ui-chip-bg', description: 'Background color.' },
			{ name: '--os-ui-chip-fg', description: 'Text color.' },
			{ name: '--os-ui-chip-border', description: 'Border shorthand.' },
			{
				name: '--os-ui-chip-padding',
				description: 'Padding shorthand.',
				default: '2px 8px',
			},
			{
				name: '--os-ui-chip-radius',
				description: 'Corner radius.',
				default: '999px',
			},
			{
				name: '--os-ui-chip-label-max',
				description: 'Max width of the inner label before ellipsis.',
				default: '220px',
			},
		],
		example: html`
			<os-cluster gap="6">
				<os-chip label="Neutral"></os-chip>
				<os-chip label="Accent" tone="accent"></os-chip>
				<os-chip label="Positive" tone="positive"></os-chip>
				<os-chip label="Warning" tone="warning"></os-chip>
				<os-chip label="Danger" tone="danger"></os-chip>
				<os-chip label="Dismissible" dismissible></os-chip>
			</os-cluster>
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
			<span part="chip" class="os-chip">
				<span class="os-chip__icon">
					<slot name="icon"></slot>
				</span>
				<span class="os-chip__label">
					${ label === '' ? html`<slot></slot>` : label }
				</span>
				${ dismissible
					? html`
							<button
								part="dismiss"
								class="os-chip__dismiss"
								type="button"
								aria-label=${ `Remove ${ label || 'chip' }` }
								?disabled=${ disabled }
								@click=${ ( e: MouseEvent ) => this._onDismiss( e ) }
							>
								${ osIcon( 'close', { size: null } ) }
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
		this.emit( 'os-chip-dismiss', { label } );
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
			this.emit( 'os-chip-dismiss', { label } );
		}
	};
}
defineComponent( 'os-chip', OsChip );
