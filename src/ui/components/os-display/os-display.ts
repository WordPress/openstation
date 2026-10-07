import { Component, defineComponent, html } from '../../core';
import { styles } from './os-display.styles';

const SIZE_PX: Record< string, string > = {
	sm: '16px',
	md: '20px',
	lg: '28px',
	xl: '40px',
};

export class OsDisplay extends Component {
	static props = [ 'value', 'size', 'align' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Display',
		summary:
			'Single-line numeric/text readout — right-aligned, tabular-nums, auto-ellipsized. The readout every calculator, stopwatch, ticker, counter, or meter reinvents. Host is aria-live="polite" so screen readers announce value changes without yanking focus.',
		status: 'stable',
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
			{ name: '--os-ui-display-size' },
			{ name: '--os-ui-display-align' },
			{ name: '--os-ui-display-bg' },
			{ name: '--os-ui-display-fg' },
			{ name: '--os-ui-display-border-radius' },
		],
		example: html`
			<os-stack gap="8">
				<os-display value="1,234.00" size="xl"></os-display>
				<os-display value="00:42.19" size="lg" align="center"></os-display>
			</os-stack>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback?.();

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

		this.style.setProperty( '--os-ui-display-size', SIZE_PX[ size ] || SIZE_PX.lg );
		this.style.setProperty( '--os-ui-display-align', align );

		return html`
			<output part="output" class="os-display__output">
				${ value !== null && value !== undefined
		? value
		: html`<slot></slot>` }
			</output>
		`;
	}
}
defineComponent( 'os-display', OsDisplay );
