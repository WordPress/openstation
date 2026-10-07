import { Component, defineComponent, html } from '../../core';
import { stepStyles, stepsStyles } from './os-steps.styles';

export class OsSteps extends Component {
	static props = [ 'horizontal' ] as const;
	static styles = [ stepsStyles ];

	static help = {
		title: 'Steps',
		summary:
			'Ordered/numbered-steps container. Children are <os-step> elements; numbers are assigned via a CSS counter so insertions renumber automatically. Use for onboarding, setup flows, migration guides.',
		status: 'stable',
		slots: [
			{
				name: '(default)',
				description:
					'One or more <os-step> elements. Anything else is rendered but not numbered.',
			},
		],
		props: [
			{
				name: 'horizontal',
				type: 'boolean',
				description:
					'Lay the steps out on one line with a connector between them, the shape a wizard header takes. Vertical is the default.',
			},
		],
		cssProps: [
			{
				name: '--os-ui-steps-gap',
				default: '16px',
				description:
					'Space between steps: vertical by default, horizontal when the container is.',
			},
			{
				name: '--os-ui-step-connector-width',
				default: '0 (20px when horizontal)',
				description:
					'Length of the rule drawn between two steps on a trail.',
			},
		],
		example: html`
			<os-steps>
				<os-step title="Install">Click Install in the plugin directory.</os-step>
				<os-step title="Activate">Click Activate on the Plugins page.</os-step>
			</os-steps>
		`,
	} as const;

	private syncTrail = (): void => {
		const trail = this.hasAttribute( 'horizontal' );
		for ( const step of Array.from( this.children ) ) {
			if ( 'OS-STEP' !== step.tagName ) {
				continue;
			}
			step.toggleAttribute( 'trail', trail );
		}
	};

	connectedCallback(): void {
		super.connectedCallback();
		this.syncTrail();
	}

	protected render() {
		this.syncTrail();
		return html`<ol class="os-steps__list"><slot @slotchange=${ this.syncTrail }></slot></ol>`;
	}
}
defineComponent( 'os-steps', OsSteps );

export class OsStep extends Component {
	static props = [ 'title', 'done', 'current', 'interactive' ] as const;
	static styles = [ stepStyles ];

	static help = {
		title: 'Step',
		summary:
			'A single numbered step inside <os-steps>. Renders an auto-numbered chip and an optional bold title above the slotted body.',
		status: 'stable',
		props: [
			{
				name: 'title',
				type: 'string',
				description: 'Optional bold title rendered above the body.',
			},
			{
				name: 'done',
				type: 'boolean',
				description:
					'When present, the chip shows a ✓ in a muted colour instead of the number.',
			},
			{
				name: 'current',
				type: 'boolean',
				description:
					'Marks the step the reader is on. Mirrors aria-current="step" onto the host.',
			},
			{
				name: 'interactive',
				type: 'boolean',
				description:
					'Makes the step a jump target: focusable, activated by click or Enter/Space, and emits os-step-click. Lifts the title to full contrast on hover.',
			},
		],
		events: [
			{
				name: 'os-step-click',
				detail: 'none',
				description:
					'Fired when an interactive step is activated by pointer or keyboard.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Step body content.' },
		],
		cssProps: [
			{ name: '--os-ui-step-gap', default: '12px' },
			{ name: '--os-ui-step-chip-size', default: '28px' },
			{
				name: '--os-ui-step-chip-bg',
				default: 'var(--wp-admin-theme-color)',
			},
			{ name: '--os-ui-step-chip-fg', default: '#fff' },
			{
				name: '--os-ui-step-chip-done-bg',
				default: 'var(--os-ui-fg-muted)',
			},
			{ name: '--os-ui-step-chip-font-size', default: '13px' },
			{
				name: '--os-ui-step-title-hover-color',
				default: 'var(--os-ui-fg)',
				description:
					'Ink an interactive step takes on hover, on its title and on an outlined chip.',
			},
		],
		example: html`
			<os-steps>
				<os-step title="Configure">Open OpenStation Preferences → AI.</os-step>
				<os-step title="Connect" done>Key confirmed.</os-step>
			</os-steps>
		`,
	} as const;

	private onClick = ( event: Event ): void => {
		if ( ! this.isInteractive() ) {
			return;
		}

		const path = event.composedPath();
		for ( const node of path ) {
			if ( node === this ) {
				break;
			}
			if (
				node instanceof HTMLElement &&
				node.hasAttribute( 'data-noclick' )
			) {
				return;
			}
		}
		this.dispatchEvent(
			new CustomEvent( 'os-step-click', { bubbles: true, composed: true } ),
		);
	};

	private onKeyDown = ( event: KeyboardEvent ): void => {
		if ( ! this.isInteractive() ) {
			return;
		}
		if ( 'Enter' !== event.key && ' ' !== event.key ) {
			return;
		}

		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target !== this &&
			target.closest( 'button, a, input, select, textarea' )
		) {
			return;
		}
		event.preventDefault();
		this.onClick( event );
	};

	private isInteractive(): boolean {
		return this.hasAttribute( 'interactive' );
	}

	private syncRoles(): void {
		if ( this.hasAttribute( 'current' ) ) {
			this.setAttribute( 'aria-current', 'step' );
		} else {
			this.removeAttribute( 'aria-current' );
		}
		if ( this.isInteractive() ) {
			this.setAttribute( 'role', 'button' );
			if ( ! this.hasAttribute( 'tabindex' ) ) {
				this.setAttribute( 'tabindex', '0' );
			}
		} else {
			this.removeAttribute( 'role' );
			this.removeAttribute( 'tabindex' );
		}
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.syncRoles();
		this.addEventListener( 'click', this.onClick );
		this.addEventListener( 'keydown', this.onKeyDown );
	}

	disconnectedCallback(): void {
		this.removeEventListener( 'click', this.onClick );
		this.removeEventListener( 'keydown', this.onKeyDown );
	}

	protected render() {
		const title = ( this as unknown as { title: string | null } ).title || '';
		this.syncRoles();
		return html`
			<div class="os-step__body">
				<div class="os-step__title">${ title }</div>
				<slot></slot>
			</div>
		`;
	}
}
defineComponent( 'os-step', OsStep );
