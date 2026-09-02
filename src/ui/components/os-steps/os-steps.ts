/**
 * `<os-steps>` + `<os-step>` — ordered / numbered-steps primitive.
 *
 * Replaces the `<os-cluster>` + `<os-display>` + custom number-chip
 * CSS pattern plugin authors were hand-rolling for onboarding / setup
 * flows. Numbers are auto-assigned via a CSS counter — inserting or
 * removing a step renumbers the rest for free.
 *
 * Usage:
 *
 *   <os-steps>
 *     <os-step title="Install the plugin">
 *       Search the plugin directory for “My Plugin” and click Install.
 *     </os-step>
 *     <os-step title="Open Settings">
 *       Navigate to <os-code>Settings → My Plugin</os-code>.
 *     </os-step>
 *     <os-step title="Enter your API key" done>
 *       Already done earlier in this flow.
 *     </os-step>
 *   </os-steps>
 *
 * Mark a step with `done` to render a ✓ instead of the number, and
 * `current` to mark where the reader is now.
 *
 * Add `horizontal` to the container for a wizard trail: the steps sit
 * on one line with a rule between them, rather than stacked. Add
 * `interactive` to a step to make it a way back — it emits
 * `os-step-click` and takes focus and Enter/Space like a button.
 */

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

	/**
	 * Mark the children as being on a trail.
	 *
	 * `horizontal` is a fact about the container, and a child cannot
	 * style on its parent's attributes. Stamping it down is the honest
	 * version of that, and it keeps the layout decision in one place
	 * rather than asking every caller to repeat it on every step.
	 *
	 * Runs on connect, on every re-render, and on `slotchange`. The last
	 * is for a caller that rebuilds its steps rather than mutating them:
	 * the Workspaces wizard replaces the whole trail on each step, and a
	 * step created after the container rendered had never been stamped,
	 * so its chip sat top-aligned beside a centred label from the moment
	 * the wizard moved off Start.
	 */
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
					'Makes the step a way back: focusable, activated by click or Enter/Space, and emits os-step-click.',
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
		// A control inside the step owns its own activation.
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
		// Space inside a real button is that button's, not ours.
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

	/**
	 * Keep the host's roles in step with its attributes.
	 *
	 * `aria-current` is the whole accessible story for a trail: without
	 * it a screen reader hears four labels and no indication of which
	 * one is now.
	 */
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
