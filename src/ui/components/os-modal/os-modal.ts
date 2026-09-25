/**
 * `<os-modal>` — overlay container for rich modal UIs that need
 * more shape than `<os-confirm-dialog>`. Three slots:
 *
 *   - **(default)** — body content.
 *   - **footer** — button row (right-aligned).
 *   - **header-actions** — extra actions next to the close button.
 *
 * The component handles ESC, click-outside, and focus trap; the
 * consumer renders the body + footer however they like.
 *
 * Attributes:
 *
 *   - `open` — mounts the dialog visible.
 *   - `title` — heading text.
 *   - `size` — `sm` | `md` (default) | `lg`.
 *   - `mandatory` — disables ESC, click-outside, and hides the
 *     close button. Use sparingly (terms / blocker dialogs).
 *
 * Events:
 *
 *   - `os-modal-cancel` — ESC, click-outside, close button.
 */

import { Component, defineComponent, html } from '../../core';
import { modalStyles } from './os-modal.styles';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The genuinely focused element, walking through any shadow roots on
 * the way down.
 */
function deepActiveElement( doc: Document | null ): HTMLElement | null {
	let el = ( doc?.activeElement ?? null ) as HTMLElement | null;
	while ( el?.shadowRoot?.activeElement ) {
		el = el.shadowRoot.activeElement as HTMLElement;
	}
	return el && el !== doc?.body ? el : null;
}

/**
 * The element a keyboard event actually started on.
 */
function eventSource( e: Event ): HTMLElement | null {
	const path = e.composedPath();
	const deepest = path.length > 0 ? path[ 0 ] : e.target;
	return deepest instanceof HTMLElement ? deepest : null;
}

/**
 * Recursively collect all focusable elements in DOM tree order,
 * flattening slots and piercing child shadow roots.
 *
 * Subtree traversal stops only at elements explicitly hidden from the
 * accessibility tree (`hidden` attribute or `aria-hidden="true"`).
 * No `offsetParent` or layout check is applied — the modal guarantees
 * its own slotted content is rendered, and the `offsetParent` trick is
 * unreliable inside shadow roots and unavailable in jsdom.
 */
function collectFocusables( node: Node, result: HTMLElement[] ): void {
	if ( node instanceof HTMLSlotElement ) {
		const assigned = typeof node.assignedElements === 'function'
			? node.assignedElements( { flatten: true } )
			: [];
		const children = assigned.length > 0 ? assigned : Array.from( node.children );
		for ( const el of children ) {
			collectFocusables( el, result );
		}
		return;
	}

	if ( ! ( node instanceof HTMLElement || node instanceof DocumentFragment ) ) {
		return;
	}

	if ( node instanceof HTMLElement ) {
		// Prune entire subtrees that are hidden from the accessibility tree.
		if ( node.hidden || node.getAttribute( 'aria-hidden' ) === 'true' ) {
			return;
		}

		// Pierces the shadow boundary. If the shadow contributes no
		// focusables but the host itself matches (e.g. a custom element
		// with tabindex on the host), add the host as the entry point.
		if ( node.shadowRoot ) {
			const countBefore = result.length;
			collectFocusables( node.shadowRoot, result );
			if ( result.length === countBefore && node.matches( FOCUSABLE ) ) {
				result.push( node );
			}
			return;
		}

		if ( node.matches( FOCUSABLE ) ) {
			result.push( node );
		}
		// Non-focusable HTMLElements fall through to child iteration below.
	}

	// Both HTMLElement (light children) and DocumentFragment (shadow root)
	// share the same child-iteration path.
	for ( const child of Array.from( node.children ) ) {
		collectFocusables( child, result );
	}
}

export class OsModal extends Component {
	static props = [ 'open', 'title', 'size', 'mandatory' ] as const;
	static styles = [ modalStyles ];

	static help = {
		title: 'Modal overlay',
		summary:
			'Overlay container with title, body, and footer slots. Handles ESC, click-outside, focus trap. Use for rich modal flows that go beyond a yes/no confirm. The dialog surface is dark and re-points the shared surface tokens (--os-ui-fg/-muted/-border/-window-bg, --os-ui-button-bg-hover) so os-* controls slotted into it resolve readable dark-surface colors automatically.',
		status: 'stable',
		props: [
			{ name: 'open', type: 'boolean attribute', description: 'Mounts the dialog visible.' },
			{ name: 'title', type: 'string', description: 'Heading shown at the top of the dialog.' },
			{ name: 'size', type: "'sm' | 'md' | 'lg'", default: 'md', description: 'Width preset.' },
			{
				name: 'mandatory',
				type: 'boolean attribute',
				description: 'Disables ESC, click-outside and the close button.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Body content.' },
			{ name: 'footer', description: 'Footer button row, right-aligned.' },
			{ name: 'header-actions', description: 'Extra actions next to the close button.' },
		],
		events: [
			{
				name: 'os-modal-cancel',
				description:
					'Fires when the user dismisses the modal (ESC, click-outside, close button). Cancelable; calling `preventDefault()` keeps the modal open.',
			},
		],
		parts: [
			{
				name: 'dialog',
				description:
					'The dialog box itself, inside the scrim. Reach for it when a consumer needs the scrim and the box to behave differently — e.g. a live-preview panel that makes the scrim transparent and click-through (`pointer-events: none` on the host) while keeping the box interactive (`::part(dialog) { pointer-events: auto }`).',
			},
		],
		/*
		 * Hidden until `[open]`, so a bare mount renders nothing at
		 * all. The trigger is the example.
		 */
		example: html`
			<os-button data-demo="open">Open a modal</os-button>
			<os-modal size="md" title="Window settings">
				<p style="margin:0 0 12px">
					A modal traps focus, closes on Escape or a backdrop click,
					and returns focus to whatever opened it.
				</p>
				<os-cluster gap="8">
					<os-button variant="primary" data-demo="close">Done</os-button>
					<os-button data-demo="close">Cancel</os-button>
				</os-cluster>
			</os-modal>
		`,
		exampleInit: ( root: HTMLElement ) => {
			const modal = root.querySelector( 'os-modal' );
			if ( ! modal ) {
				return;
			}
			const open = root.querySelector< HTMLElement >( '[data-demo="open"]' );
			if ( open ) {
				// Assignment rather than addEventListener: the help
				// panel re-runs this on every keystroke in its filter
				// box, and adding would stack a listener per repaint.
				open.onclick = () => modal.setAttribute( 'open', '' );
			}
			for ( const btn of Array.from(
				root.querySelectorAll< HTMLElement >( '[data-demo="close"]' ),
			) ) {
				btn.onclick = () => modal.removeAttribute( 'open' );
			}
		},
	} as const;

	private _prevFocus: HTMLElement | null = null;
	private _focusTries = 0;

	connectedCallback() {
		super.connectedCallback();
		this.setAttribute( 'role', 'dialog' );
		this.setAttribute( 'aria-modal', 'true' );
		this.addEventListener( 'keydown', this._onKey );
		this.addEventListener( 'click', this._onBackdrop );
	}

	disconnectedCallback() {
		this.removeEventListener( 'keydown', this._onKey );
		this.removeEventListener( 'click', this._onBackdrop );
	}

	attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void {
		super.attributeChangedCallback?.( name, oldValue, newValue );
		if ( name === 'open' ) {
			if ( newValue !== null ) {
				this._prevFocus = deepActiveElement( this.ownerDocument );
				this._focusTries = 0;
				queueMicrotask( () => this._focusFirst() );
			} else if ( this._prevFocus ) {
				try {
					this._prevFocus.focus();
				} catch ( e ) {
					// Element may have unmounted while modal was open.
				}
				this._prevFocus = null;
			}
		}
	}

	showModal(): void {
		this.setAttribute( 'open', '' );
	}

	hideModal(): void {
		this.removeAttribute( 'open' );
	}

	private _focusables(): HTMLElement[] {
		const root = this.shadowRoot;
		if ( ! root ) {
			return [];
		}
		const result: HTMLElement[] = [];
		collectFocusables( root, result );
		return result;
	}

	private _focusFirst(): void {
		if ( ! this.hasAttribute( 'open' ) ) {
			return;
		}
		const f = this._focusables();
		if ( f.length > 0 ) {
			const auto = f.find( ( el ) => el.hasAttribute( 'autofocus' ) );
			const closeBtn = this.shadowRoot?.querySelector( 'button.close' );
			const firstNonClose = f.find( ( el ) => el !== closeBtn );
			( auto || firstNonClose || f[ 0 ] ).focus();
			return;
		}
		if ( this._focusTries++ < 5 ) {
			queueMicrotask( () => this._focusFirst() );
			return;
		}
		const inner = this.shadowRoot?.querySelector< HTMLElement >( '.dialog' );
		inner?.focus?.();
	}

	private _onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' && ! this.hasAttribute( 'mandatory' ) ) {
			e.preventDefault();
			this._cancel();
			return;
		}
		if ( e.key === 'Tab' ) {
			const f = this._focusables();
			if ( f.length === 0 ) {
				e.preventDefault();
				return;
			}
			const first = f[ 0 ];
			const last = f[ f.length - 1 ];
			const active = eventSource( e ) || deepActiveElement( this.ownerDocument );
			const loose = ! active || ! f.includes( active );

			if ( e.shiftKey && ( loose || active === first ) ) {
				e.preventDefault();
				last.focus();
			} else if ( ! e.shiftKey && ( loose || active === last ) ) {
				e.preventDefault();
				first.focus();
			}
		}
	};

	private _onBackdrop = ( e: MouseEvent ): void => {
		if ( this.hasAttribute( 'mandatory' ) ) {
			return;
		}
		if ( eventSource( e ) === this ) {
			this._cancel();
		}
	};

	private _cancel(): void {
		const ev = new CustomEvent( 'os-modal-cancel', {
			bubbles: true,
			cancelable: true,
			composed: true,
		} );
		const allowed = this.dispatchEvent( ev );
		if ( allowed ) {
			this.hideModal();
		}
	}

	protected render() {
		// `title` is reflected on every HTMLElement via the IDL — read
		// it through `getAttribute` so the source-of-truth is explicit
		// and we don't trip readers who'd otherwise think the cast in
		// the old line meant the property could be null (it can't —
		// HTMLElement.title is always a string).
		const title = this.getAttribute( 'title' ) ?? '';
		const mandatory = this.hasAttribute( 'mandatory' );
		return html`
			<div part="dialog" class="dialog" tabindex="-1">
				${ title
					? html`
						<div class="header">
							<h2 class="title">${ title }</h2>
							<div class="header-actions">
								<slot name="header-actions"></slot>
								${ mandatory
									? html``
									: html`<button
										type="button"
										class="close"
										aria-label="Close"
										@click=${ () => this._cancel() }
									>×</button>` }
							</div>
						</div>
					`
					: html`` }
				<div class="body">
					<slot></slot>
				</div>
				<div class="footer">
					<slot name="footer"></slot>
				</div>
			</div>
		`;
	}
}
defineComponent( 'os-modal', OsModal );
