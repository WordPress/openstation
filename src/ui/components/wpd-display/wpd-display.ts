/**
 * `<wpd-display>` — single-line numeric / text readout. The
 * right-aligned, `tabular-nums`, auto-ellipsized readout every
 * calculator, stopwatch, ticker, counter, or meter reinvents.
 *
 * Usage:
 *
 *   <wpd-display value="1,234.00"></wpd-display>
 *
 *   // or with slotted content
 *   <wpd-display aria-label="Current total">
 *     <span slot="label">Total</span>
 *     <strong>$ 12.50</strong>
 *   </wpd-display>
 *
 * Attributes:
 *   - `value`  — convenience: renders this string as the readout.
 *                Ignored when the caller slots their own content.
 *   - `size`   — `sm` | `md` | `lg` | `xl`. Default `lg` — calculator-
 *                sized. Affects the host's font-size custom property.
 *   - `align`  — `start` | `end` | `center`. Default `end` (right-aligned
 *                like a calculator or ledger).
 *
 * The host is a **live region** (`aria-live="polite"`) so screen
 * readers announce value changes without yanking focus.
 *
 * @since 0.5.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-display.styles';

const SIZE_PX: Record< string, string > = {
	sm: '16px',
	md: '20px',
	lg: '28px',
	xl: '40px',
};

export class WpdDisplay extends Component {
	static props = [ 'value', 'size', 'align' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Display',
		summary:
			'Single-line numeric/text readout — right-aligned, tabular-nums, auto-ellipsized. The readout every calculator, stopwatch, ticker, counter, or meter reinvents. Host is aria-live="polite" so screen readers announce value changes without yanking focus.',
		status: 'stable',
		since: '0.5.0',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Convenience readout. Ignored when the caller slots their own content.',
			},
			{
				name: 'size',
				type: "'sm' | 'md' | 'lg' | 'xl'",
				default: 'lg',
				description: 'Typography scale. lg is calculator-sized.',
			},
			{
				name: 'align',
				type: "'start' | 'center' | 'end'",
				default: 'end',
				description: 'Text alignment. `end` matches ledger/calculator right-alignment.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Custom readout markup (currency prefix, unit suffix, etc.). Only rendered when `value` is not set.' },
			{ name: 'label', description: 'Optional leading label.' },
		],
		parts: [
			{ name: 'output', description: 'Inner <output> element holding the readout.' },
		],
		cssProps: [
			{ name: '--wpd-display-size' },
			{ name: '--wpd-display-align' },
			{ name: '--wpd-display-bg' },
			{ name: '--wpd-display-fg' },
			{ name: '--wpd-display-border-radius' },
		],
		example: html`
			<wpd-stack gap="8">
				<wpd-display value="1,234.00" size="xl"></wpd-display>
				<wpd-display value="00:42.19" size="lg" align="center"></wpd-display>
			</wpd-stack>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback?.();
		// Live-region semantics so screen readers announce
		// value changes without yanking focus.
		if ( ! this.hasAttribute( 'aria-live' ) ) {
			this.setAttribute( 'aria-live', 'polite' );
		}
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'status' );
		}
	}

	protected render() {
		const value = ( this as unknown as { value: string | null } ).value;
		const size = ( this as unknown as { size: string | null } ).size || 'lg';
		const align =
			( this as unknown as { align: string | null } ).align || 'end';

		this.style.setProperty( '--wpd-display-size', SIZE_PX[ size ] || SIZE_PX.lg );
		this.style.setProperty( '--wpd-display-align', align );

		// Value attribute wins over slotted content when present —
		// common case for numeric readouts that drive purely via
		// setAttribute. The slot still renders for callers that need
		// richer markup (a currency prefix span, a unit suffix, etc.).
		return html`
			<output part="output" class="wpd-display__output">
				${ value !== null && value !== undefined
		? value
		: html`<slot></slot>` }
			</output>
		`;
	}
}
defineComponent( 'wpd-display', WpdDisplay );
