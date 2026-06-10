/**
 * `<wpd-save-status>` — tiny, slottable indicator for "is the user's
 * change saved yet?" affordances.
 *
 * Three layouts via the `mode` attribute:
 *
 *   - `dot`  (default) — a 10×10 colored dot. Maximum density;
 *     drop next to a label, in a toolbar, inside an input row.
 *   - `icon`            — same dot, plus a check / cross glyph
 *     inside on the `saved` / `failed` phases.
 *   - `pill`            — the dot + an inline label ("Saving…",
 *     "Saved", error message). Use in panel headers.
 *
 * Five phases (driven by the `phase` attribute or, more typically,
 * an event the host auto-listens to):
 *
 *   - `idle`    — hidden (opacity 0, no pointer events).
 *   - `pending` — change registered, waiting for the debounced
 *                 sync. Pulsing primary-color dot.
 *   - `saving`  — REST request in flight. Same pulse.
 *   - `saved`   — change persisted. Green dot (briefly visible
 *                 before auto-clearing back to `idle`).
 *   - `failed`  — REST request errored. Red dot. Stays visible
 *                 for `auto-clear-failed-ms` (default 6s) before
 *                 fading back to `idle`; the error message is
 *                 exposed via the `error` attribute (mirrored to
 *                 the host `title` tooltip).
 *
 * # Auto-listen mode
 *
 * For the OS Settings flow, the indicator is most useful when it
 * just *works* — no manual `phase` plumbing per setting. Set the
 * `auto` attribute and the component subscribes to a CustomEvent
 * on `document` (default name:
 * `desktop-mode-os-settings-save-lifecycle`) and updates `phase` +
 * `error` from `event.detail`. Call sites just place the element
 * once near the panel and every save flow feeds it for free.
 *
 * Override the event name with the `event` attribute when wiring
 * the indicator to a different lifecycle (e.g. a custom REST sync
 * inside a plugin window): `<wpd-save-status auto event="my-plugin-save-lifecycle">`.
 *
 * ```html
 * <!-- Single global indicator at the top of the OS Settings panel. -->
 * <wpd-save-status auto mode="pill" idle-label="All changes saved"></wpd-save-status>
 *
 * <!-- Inline next to a custom input bound to a manual phase prop. -->
 * <label>API key
 *     <input @change="${ onChange }">
 *     <wpd-save-status phase="${ phase }"></wpd-save-status>
 * </label>
 * ```
 *
 * @public
 * @since 0.8.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-save-status.styles';

export type WpdSaveStatusPhase =
	| 'idle'
	| 'pending'
	| 'saving'
	| 'saved'
	| 'failed';

export type WpdSaveStatusMode = 'dot' | 'icon' | 'pill';

/** Detail shape of the auto-listen CustomEvent. */
export interface WpdSaveStatusLifecycleDetail {
	phase: WpdSaveStatusPhase;
	error?: string;
}

const DEFAULT_EVENT = 'desktop-mode-os-settings-save-lifecycle';
const DEFAULT_AUTO_CLEAR_SAVED_MS = 2200;
const DEFAULT_AUTO_CLEAR_FAILED_MS = 6000;

export class WpdSaveStatus extends Component {
	static props = [
		'phase',
		'mode',
		'animation',
		'auto',
		'event',
		'error',
		'saving-label',
		'saved-label',
		'idle-label',
		'auto-clear-saved-ms',
		'auto-clear-failed-ms',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Save status',
		summary:
			'Tiny status indicator for "is this change saved yet?" affordances. Three layouts (dot / icon / pill), five phases, optional auto-listen to a save-lifecycle CustomEvent so every input in the panel inherits feedback for free.',
		status: 'experimental',
		since: '0.8.0',
		props: [
			{
				name: 'phase',
				type: "'idle' | 'pending' | 'saving' | 'saved' | 'failed'",
				default: 'idle',
				description:
					'Current lifecycle phase. Set manually for one-off integrations, or rely on `auto` to populate it from a CustomEvent.',
			},
			{
				name: 'mode',
				type: "'dot' | 'icon' | 'pill'",
				default: 'dot',
				description:
					'Layout. `dot` is the smallest (10×10 colored dot); `icon` adds a glyph inside on saved/failed; `pill` adds an inline label.',
			},
			{
				name: 'animation',
				type: "'pulse' | 'modem'",
				default: 'pulse',
				description:
					"Animation cadence during the saving phase. `pulse` (default) is a smooth ease-in-out; `modem` is an irregular activity-LED blink with a soft glow — suits a 'data-flowing' affordance in window title bars.",
			},
			{
				name: 'auto',
				type: 'boolean attribute',
				description:
					'Subscribe to a CustomEvent on `document` and populate phase + error from its detail. Default event name is `desktop-mode-os-settings-save-lifecycle`; override with `event="…"`.',
			},
			{
				name: 'event',
				type: 'string',
				default: 'desktop-mode-os-settings-save-lifecycle',
				description: 'CustomEvent name to listen on when `auto` is set.',
			},
			{
				name: 'error',
				type: 'string',
				description:
					'Error message shown in `pill` mode and exposed as the host title attribute (so dot/icon modes still surface the message via tooltip).',
			},
			{
				name: 'saving-label',
				type: 'string',
				default: 'Saving…',
				description: 'Pill-mode label shown during `pending` / `saving`.',
			},
			{
				name: 'saved-label',
				type: 'string',
				default: 'Saved',
				description: 'Pill-mode label shown during `saved`.',
			},
			{
				name: 'idle-label',
				type: 'string',
				description:
					'Optional pill-mode label shown during `idle` (e.g. "All changes saved"). When unset, the pill collapses to invisible while idle.',
			},
			{
				name: 'auto-clear-saved-ms',
				type: 'integer',
				default: '2200',
				description:
					'How long the `saved` phase stays visible before auto-fading back to `idle`.',
			},
			{
				name: 'auto-clear-failed-ms',
				type: 'integer',
				default: '6000',
				description:
					'How long the `failed` phase stays visible before auto-fading back to `idle`.',
			},
		],
		events: [
			{
				name: 'wpd-save-status-change',
				description:
					'Fires when the phase changes (manually or via auto-listen).',
				detail: '{ phase, error }',
			},
		],
		cssProps: [
			{
				name: '--wpd-save-status-bg',
				description: 'Indicator background color (saving/pending phase).',
			},
			{
				name: '--wpd-save-status-saved-bg',
				description: 'Indicator background on saved.',
			},
			{
				name: '--wpd-save-status-failed-bg',
				description: 'Indicator background on failed.',
			},
			{
				name: '--wpd-save-status-pill-bg',
				description: 'Pill background (mode=pill).',
			},
			{
				name: '--wpd-save-status-pill-fg',
				description: 'Pill foreground (mode=pill).',
			},
		],
		example: html`
			<wpd-cluster gap="12">
				<wpd-save-status phase="pending"></wpd-save-status>
				<wpd-save-status phase="saving"></wpd-save-status>
				<wpd-save-status phase="saved"></wpd-save-status>
				<wpd-save-status phase="failed"></wpd-save-status>
				<wpd-save-status mode="pill" phase="saving"></wpd-save-status>
				<wpd-save-status mode="pill" phase="saved"></wpd-save-status>
				<wpd-save-status mode="pill" phase="failed" error="Network error."></wpd-save-status>
			</wpd-cluster>
		`,
	} as const;

	private _autoTimer: number | null = null;
	private _docListener: ( ( e: Event ) => void ) | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ( this as unknown as { auto: string | null } ).auto !== null ) {
			this._installAutoListener();
		}
	}

	disconnectedCallback(): void {
		this._removeAutoListener();
		if ( this._autoTimer !== null ) {
			window.clearTimeout( this._autoTimer );
			this._autoTimer = null;
		}
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		super.attributeChangedCallback( name, oldValue, newValue );
		// `auto` and `event` toggle the document subscription. Re-bind
		// from scratch on either change so a runtime swap (e.g. a
		// plugin enabling auto-listen after first paint) takes effect.
		if ( name === 'auto' || name === 'event' ) {
			this._removeAutoListener();
			if ( ( this as unknown as { auto: string | null } ).auto !== null ) {
				this._installAutoListener();
			}
		}
		if ( name === 'phase' ) {
			this._scheduleAutoClear();
			const detail = {
				phase:
					( ( this as unknown as { phase: string | null } ).phase ??
						'idle' ) as WpdSaveStatusPhase,
				error:
					( this as unknown as { error: string | null } ).error ??
					undefined,
			};
			this.emit( 'wpd-save-status-change', detail );
		}
	}

	protected render() {
		const phase =
			( ( this as unknown as { phase: string | null } ).phase ??
				'idle' ) as WpdSaveStatusPhase;
		const mode =
			( ( this as unknown as { mode: string | null } ).mode ??
				'dot' ) as WpdSaveStatusMode;
		const error =
			( this as unknown as { error: string | null } ).error ?? '';

		// `title` on the host so dot/icon modes surface the error
		// message as a native tooltip without growing the layout.
		const title = error || this._labelForPhase( phase );
		if ( title ) {
			this.setAttribute( 'title', title );
		} else {
			this.removeAttribute( 'title' );
		}
		this.setAttribute( 'aria-live', phase === 'failed' ? 'assertive' : 'polite' );
		this.setAttribute( 'role', phase === 'failed' ? 'alert' : 'status' );

		return html`
			<span class="wpd-save-status">
				<span class="wpd-save-status__indicator" aria-hidden="true">
					<span class="wpd-save-status__glyph">${ this._renderGlyph( phase ) }</span>
				</span>
				${ mode === 'pill'
					? html`<span class="wpd-save-status__label"
							>${ this._labelForPhase( phase ) }</span
					  >`
					: html`` }
			</span>
		`;
	}

	private _renderGlyph( phase: WpdSaveStatusPhase ) {
		if ( phase === 'saved' ) {
			return _iconCheck();
		}
		if ( phase === 'failed' ) {
			return _iconBang();
		}
		return '';
	}

	private _labelForPhase( phase: WpdSaveStatusPhase ): string {
		switch ( phase ) {
			case 'pending':
			case 'saving':
				return (
					( this as unknown as { 'saving-label': string | null } )[
						'saving-label'
					] ?? 'Saving…'
				);
			case 'saved':
				return (
					( this as unknown as { 'saved-label': string | null } )[
						'saved-label'
					] ?? 'Saved'
				);
			case 'failed': {
				const err =
					( this as unknown as { error: string | null } ).error ?? '';
				return err || 'Couldn’t save';
			}
			default:
				return (
					( this as unknown as { 'idle-label': string | null } )[
						'idle-label'
					] ?? ''
				);
		}
	}

	private _installAutoListener(): void {
		const eventName =
			( this as unknown as { event: string | null } ).event ||
			DEFAULT_EVENT;
		this._docListener = ( e: Event ) => {
			const detail = ( e as CustomEvent< WpdSaveStatusLifecycleDetail > )
				.detail;
			if ( ! detail || typeof detail.phase !== 'string' ) {
				return;
			}
			( this as unknown as { phase: string } ).phase = detail.phase;
			if ( detail.error ) {
				( this as unknown as { error: string } ).error = detail.error;
			} else if (
				detail.phase !== 'failed' &&
				( this as unknown as { error: string | null } ).error
			) {
				this.removeAttribute( 'error' );
			}
		};
		document.addEventListener( eventName, this._docListener );
	}

	private _removeAutoListener(): void {
		if ( ! this._docListener ) {
			return;
		}
		const eventName =
			( this as unknown as { event: string | null } ).event ||
			DEFAULT_EVENT;
		document.removeEventListener( eventName, this._docListener );
		this._docListener = null;
	}

	private _scheduleAutoClear(): void {
		if ( this._autoTimer !== null ) {
			window.clearTimeout( this._autoTimer );
			this._autoTimer = null;
		}
		const phase =
			( ( this as unknown as { phase: string | null } ).phase ??
				'idle' ) as WpdSaveStatusPhase;
		const ms = this._autoClearMsFor( phase );
		if ( ms <= 0 ) {
			return;
		}
		this._autoTimer = window.setTimeout( () => {
			this._autoTimer = null;
			( this as unknown as { phase: string } ).phase = 'idle';
		}, ms ) as unknown as number;
	}

	private _autoClearMsFor( phase: WpdSaveStatusPhase ): number {
		if ( phase === 'saved' ) {
			const raw = ( this as unknown as {
				'auto-clear-saved-ms': string | null;
			} )[ 'auto-clear-saved-ms' ];
			return parseInt( raw || '', 10 ) || DEFAULT_AUTO_CLEAR_SAVED_MS;
		}
		if ( phase === 'failed' ) {
			const raw = ( this as unknown as {
				'auto-clear-failed-ms': string | null;
			} )[ 'auto-clear-failed-ms' ];
			return parseInt( raw || '', 10 ) || DEFAULT_AUTO_CLEAR_FAILED_MS;
		}
		return 0;
	}
}
defineComponent( 'wpd-save-status', WpdSaveStatus );

function _iconCheck() {
	return html`
		<svg
			viewBox="0 0 12 12"
			aria-hidden="true"
			focusable="false"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M2.5 6 L5 8.5 L9.5 4" />
		</svg>
	`;
}

function _iconBang() {
	return html`
		<svg
			viewBox="0 0 12 12"
			aria-hidden="true"
			focusable="false"
			fill="currentColor"
		>
			<path
				d="M5 2 H7 V7 H5 z M5 8.5 H7 V10.5 H5 z"
			/>
		</svg>
	`;
}
