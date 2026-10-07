import { Component, defineComponent, html } from '../../core';
import { styles } from './os-disclosure.styles';

let uid = 0;

export class OsDisclosure extends Component {
	static props = [ 'heading', 'hint', 'open' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Disclosure',
		summary:
			'Titled section that folds away. Same shape as <os-section> plus an open state, for content worth keeping but not worth its vertical space on every visit. Closed by default.',
		status: 'stable',
		props: [
			{
				name: 'heading',
				type: 'string',
				description:
					'Summary text, rendered inside the toggle button as an <h3>. The button is what carries the accessible name, so a disclosure without a heading has none — always pass one.',
			},
			{
				name: 'hint',
				type: 'string',
				description:
					'Optional secondary text on the summary row, muted and after the heading. For a count, a status, or a short "why you might open this".',
			},
			{
				name: 'open',
				type: 'boolean',
				description:
					'Reflects + controls the expanded state; updated on user toggle. Absent (closed) by default.',
			},
		],
		slots: [
			{
				name: '(default)',
				description:
					'The collapsible body. Genuinely `hidden` while closed, so its contents are out of the tab order and out of the accessibility tree.',
			},
		],
		parts: [
			{ name: 'heading', description: 'The heading text; adjust its typography for compact surfaces.' },
			{
				name: 'summary',
				description:
					'The toggle button. Style the summary row from the call site without reaching into the shadow tree.',
			},
			{
				name: 'body',
				description: 'The wrapper around the default slot.',
			},
		],
		events: [
			{
				name: 'os-disclosure-toggle',
				description:
					'Fires when the USER opens or closes it, with `{ open }`. Setting the property from code stays silent, so a listener that persists the state cannot loop.',
			},
		],
		cssProps: [
			{ name: '--os-ui-fg', description: 'Heading colour.' },
			{ name: '--os-ui-fg-muted', description: 'Hint colour.' },
			{ name: '--os-ui-accent', description: 'Focus-ring colour.' },
		],
		example: html`
			<os-disclosure heading="Advanced" hint="3 settings">
				<p>Anything that does not need to be on screen every time.</p>
			</os-disclosure>
		`,
	} as const;

	private bodyId = `os-disclosure-body-${ ++uid }`;

	private onToggle = (): void => {
		const next = ! this.isOpen();
		if ( next ) {
			this.setAttribute( 'open', '' );
		} else {
			this.removeAttribute( 'open' );
		}
		this.emit( 'os-disclosure-toggle', { open: next } );
	};

	private isOpen(): boolean {
		return this.hasAttribute( 'open' );
	}

	protected render() {
		const heading =
			( this as unknown as { heading: string | null } ).heading || '';
		const hint = ( this as unknown as { hint: string | null } ).hint || '';
		const open = this.isOpen();

		return html`
			<button
				type="button"
				class="os-disclosure__summary"
				part="summary"
				aria-expanded=${ open ? 'true' : 'false' }
				aria-controls=${ this.bodyId }
				@click=${ this.onToggle }
			>
				<span class="os-disclosure__marker" aria-hidden="true"></span>
				<h3 part="heading" class="os-disclosure__heading">${ heading }</h3>
				${ hint
					? html`<span class="os-disclosure__hint">${ hint }</span>`
					: '' }
			</button>
			<div
				id=${ this.bodyId }
				class="os-disclosure__body"
				part="body"
				?hidden=${ ! open }
			>
				<slot></slot>
			</div>
		`;
	}
}
defineComponent( 'os-disclosure', OsDisclosure );
