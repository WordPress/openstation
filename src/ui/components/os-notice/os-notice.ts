/**
 * `<os-notice>` — full-width banner.
 *
 * The canonical place to surface a non-blocking, contextual message
 * inside a window — release notes, a setup nudge, a deprecation
 * warning, a "your trial expires in 3 days" reminder, etc. Five
 * built-in tones map to common UI semantics (`info`, `success`,
 * `warning`, `error`, `neutral`) and a close button is rendered by
 * default. Slotted content is HTML so plugins can include links and
 * basic formatting.
 *
 * Usage:
 *
 *   <os-notice tone="info" notice-id="my-plugin/welcome">
 *     Welcome to the plugin! <a href="…">Read the docs</a>.
 *   </os-notice>
 *
 *   <os-notice tone="warning" not-dismissible>
 *     Maintenance window in 10 minutes.
 *   </os-notice>
 *
 * Persistence: when `notice-id` is set, the dismissed state is stored
 * in `localStorage` under the key
 * `os-notice-dismissed:<userId>` (a JSON map of
 * `{ noticeId: true }`). On connection the component reads the map
 * and self-hides if already dismissed. Clearing the dismissal is the
 * `<os-notice>.undismiss()` instance method, or
 * `wp.os.undismissWindowNotice( id )` for code-registered notices.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-notice.styles';
import { __ } from '../../../i18n';
import {
	isNoticeDismissed,
	markNoticeDismissed,
	clearNoticeDismissed,
} from './storage';

export type OsNoticeTone =
	| 'info'
	| 'success'
	| 'warning'
	| 'error'
	| 'danger'
	| 'neutral';

export class OsNotice extends Component {
	static props = [ 'tone', 'notDismissible', 'icon', 'noticeId' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Notice',
		summary:
			'Full-width banner placed inside a window (typically the after-titlebar slot). Tone-coded background + accent stripe, optional close button, optional dashicons leading glyph. Slotted content is HTML — links and basic formatting are supported.',
		status: 'experimental',
		since: '0.8.6',
		props: [
			{
				name: 'tone',
				type: '"info" | "success" | "warning" | "error" | "danger" | "neutral"',
				description:
					'Color palette. Defaults to `info`. `error` and `danger` are aliases.',
			},
			{
				name: 'not-dismissible',
				type: 'boolean',
				description:
					'Suppress the trailing close button. Defaults to dismissible.',
			},
			{
				name: 'icon',
				type: 'string',
				description:
					'Optional Dashicons class for a leading glyph (e.g. `dashicons-info`).',
			},
			{
				name: 'notice-id',
				type: 'string',
				description:
					'Persistence key. When set, the notice records its dismissed state in localStorage so it stays closed across reloads for the same user.',
			},
		],
		slots: [
			{
				name: '(default)',
				description:
					'Message HTML. Links, `<strong>`, `<em>`, and other inline formatting are allowed.',
			},
		],
		events: [
			{
				name: 'os-notice-dismiss',
				description: 'Fires after the user clicks the close button.',
				detail: '{ noticeId?: string }',
			},
		],
		cssProps: [
			{ name: '--os-ui-notice-bg', description: 'Background color.' },
			{ name: '--os-ui-notice-accent', description: 'Left-edge stripe + icon color.' },
			{ name: '--os-ui-notice-color', description: 'Text color.' },
			{ name: '--os-ui-notice-border', description: 'Bottom border color.' },
			{ name: '--os-ui-notice-link', description: 'Color for slotted <a> elements.' },
		],
		example: html`
			<os-notice tone="warning" notice-id="docs/example">
				Heads up — this is a demo notice.
				<a href="#">Learn more</a>.
			</os-notice>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'status' );
		}
		if ( ! this.hasAttribute( 'tone' ) ) {
			this.setAttribute( 'tone', 'info' );
		}
		const id = this.getAttribute( 'notice-id' );
		if ( id && isNoticeDismissed( id ) ) {
			this.hidden = true;
		}
	}

	/**
	 * Imperatively dismiss the notice — hides the host and records
	 * the dismissal in localStorage when `notice-id` is set.
	 */
	dismiss(): void {
		this.hidden = true;
		const id = this.getAttribute( 'notice-id' );
		if ( id ) {
			markNoticeDismissed( id );
		}
		this.emit( 'os-notice-dismiss', { noticeId: id ?? undefined } );
	}

	/**
	 * Clear a previously recorded dismissal and re-show the notice.
	 * Useful in tests and for "Show again" affordances.
	 */
	undismiss(): void {
		const id = this.getAttribute( 'notice-id' );
		if ( id ) {
			clearNoticeDismissed( id );
		}
		this.hidden = false;
	}

	protected render() {
		const icon = this.getAttribute( 'icon' );
		const dismissible = ! this.hasAttribute( 'not-dismissible' );

		return html`
			<span
				class="os-notice__icon dashicons ${ icon ?? '' }"
				?hidden=${ ! icon }
				aria-hidden="true"
			></span>
			<span class="os-notice__label"><slot></slot></span>
			<button
				type="button"
				class="os-notice__close"
				?hidden=${ ! dismissible }
				aria-label=${ __( 'Dismiss notice' ) }
				@click=${ ( e: Event ) => this._onDismiss( e ) }
			>
				<svg viewBox="0 0 14 14" aria-hidden="true">
					<path
						d="M3 3 L11 11 M11 3 L3 11"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						fill="none"
					></path>
				</svg>
			</button>
		`;
	}

	private _onDismiss( e: Event ): void {
		e.preventDefault();
		e.stopPropagation();
		this.dismiss();
	}
}
defineComponent( 'os-notice', OsNotice );
