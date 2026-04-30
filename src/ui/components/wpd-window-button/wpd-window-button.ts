/**
 * `<wpd-window-button>` — single chrome button used in window
 * title bars. Built-in icons cover the six control buttons
 * (minimize / maximize / fullscreen-toggle / detach / reload /
 * close) plus the `⋯` menu trigger.
 *
 * The `icon` attribute ONLY accepts the seven built-in keys
 * listed below — passing a Dashicons class or an inline SVG string
 * via `icon` will silently render nothing because the icon map
 * doesn't have an entry. To use a Dashicons class, append a
 * `<span class="dashicons dashicons-foo">` as a light-DOM child
 * (the global Dashicons stylesheet doesn't penetrate the shadow
 * boundary). To use an inline SVG, drop the `<svg>` element as a
 * light-DOM child the same way. The default slot picks both up.
 *
 * The title-bar registry's `paintTitleBarButtonIcon` helper does
 * this routing automatically for plugin-registered buttons — see
 * `src/window/index.ts` — so plugin authors using
 * `wp.desktop.registerTitleBarButton({ icon: 'dashicons-…', … })`
 * don't have to think about the difference.
 *
 * Focused / unfocused coloring is driven by outer CSS custom
 * properties (`--wpd-btn-color`, `--wpd-btn-bg-hover`, etc.) that
 * the window shell sets based on its own `--focused` class — see
 * `wpd-window-button.styles.ts` for the full set.
 *
 * Attributes:
 *   - `icon="minimize" | "maximize" | "fullscreen" | "fullscreen-exit"
 *          | "detach" | "reload" | "close" | "menu"` — picks a built-in SVG
 *   - `active` — boolean, applies the pressed-down look
 *   - `danger` — boolean, swaps hover to a red wash (used by the
 *     close button)
 *
 * Events:
 *   - `click` — native; bubbles out of the shadow root as usual.
 *     Reliable because the title-bar drag-handler excludes any
 *     element matching `.wp-desktop-window__btn` — static clicks
 *     (no mouse movement between down and up) land normally.
 *   - `wpd-button-activate` — CustomEvent fired exactly once per
 *     user activation. `bubbles: true; composed: true; cancelable:
 *     true`. Use this when you want a contract that's explicitly
 *     scoped to button activation, not entangled with raw pointer
 *     events. Plugin-registered title-bar buttons that pass an
 *     `onClick` callback are wired to this event automatically —
 *     the registry calls your callback exactly once per click,
 *     never doubles, never races with drag detection.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-window-button.styles';

/**
 * Inline SVG paths for the built-in icons. Each entry returns the
 * `<path>` / `<rect>` markup that sits inside a 12×12 viewBox,
 * rendered at 14×14 for crispness. Sourced directly from the old
 * `createControlButton()` helper in `window.ts` so visuals are
 * identical.
 */
const ICONS: Record<string, string> = {
	minimize:
		'<path d="M3 6h6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
	maximize:
		'<rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.25" fill="none"/>',
	fullscreen:
		'<path d="M4.5 2H2v2.5M10 4.5V2H7.5M4.5 10H2V7.5M10 7.5V10H7.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
	'fullscreen-exit':
		'<path d="M2 4.5H4.5V2M7.5 2V4.5H10M2 7.5H4.5V10M7.5 10V7.5H10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
	detach:
		'<path d="M5 2H2.5v7.5H10V7M6.5 2H10v3.5M10 2L5.5 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
	reload:
		// Filled icon scaled from a 512×512 source into the 12×12 viewBox
		// shared with the other title-bar glyphs. The wrapping `<g>` does
		// the math; the inner path is dropped in unmodified so its
		// authoring tool can be re-edited and copy-pasted again.
		// `scale(0.021)` ≈ 90% of full fit, with `translate(0.6)` to
		// keep the result centered inside the 12×12 viewBox so the
		// glyph reads slightly smaller than min/max/close — closer to
		// the visual weight of the other title-bar buttons.
		'<g transform="translate(0.6 0.6) scale(0.021)" fill="currentColor">' +
		'<path d="m504.554 233.704-76.447 91.467c-6.329 7.572-15.417 11.479-24.571 11.479a31.872 31.872 0 0 1-20.504-7.447l-91.467-76.447c-13.561-11.334-15.366-31.515-4.032-45.075s31.515-15.366 45.075-4.032l37.506 31.347c-10.274-74.891-74.668-132.774-152.337-132.774C132.984 102.223 64 171.207 64 256s68.984 153.777 153.777 153.777c17.673 0 32 14.327 32 32s-14.327 32-32 32c-58.17 0-112.859-22.653-153.991-63.785C22.653 368.859 0 314.17 0 256s22.653-112.859 63.786-153.992c41.132-41.132 95.821-63.785 153.991-63.785s112.859 22.653 153.992 63.785c32.517 32.516 53.471 73.508 60.829 117.991l22.849-27.339c11.334-13.56 31.515-15.364 45.075-4.032 13.56 11.335 15.365 31.516 4.032 45.076z"/>' +
		'</g>',
	close:
		'<path d="M3.25 3.25l5.5 5.5M3.25 8.75l5.5-5.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
	menu:
		'<circle cx="3" cy="6" r="1.2" fill="currentColor"/>' +
		'<circle cx="6" cy="6" r="1.2" fill="currentColor"/>' +
		'<circle cx="9" cy="6" r="1.2" fill="currentColor"/>',
};

export class WpdWindowButton extends Component {
	static props = [ 'icon', 'active', 'danger' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Window button',
		summary:
			'Chrome button used in native-window title bars. Built-in icons cover the standard controls (minimize, maximize, fullscreen, detach, close, menu). Focused/unfocused coloring is driven by --wpd-btn-* CSS custom properties the window shell owns.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'icon',
				type: "'minimize' | 'maximize' | 'fullscreen' | 'fullscreen-exit' | 'detach' | 'reload' | 'close' | 'menu'",
				description: 'Which built-in inline SVG to paint. Omit to supply your own via the slot.',
			},
			{
				name: 'active',
				type: 'boolean attribute',
				description: 'Applies the pressed-down look (used e.g. while a menu it triggers is open).',
			},
			{
				name: 'danger',
				type: 'boolean attribute',
				description: 'Swaps the hover wash to red — used by the close button.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Optional custom icon markup (inline SVG) when `icon` is omitted.' },
		],
		cssProps: [
			{ name: '--wpd-btn-color', description: 'Resting foreground.' },
			{ name: '--wpd-btn-color-hover', description: 'Hover foreground.' },
			{ name: '--wpd-btn-bg-hover', description: 'Hover background wash.' },
			{ name: '--wpd-btn-bg-active', description: 'Pressed background.' },
			{ name: '--wpd-btn-danger-hover', description: 'Hover background for danger variant.' },
			{ name: '--wpd-btn-outline', description: 'Focus outline colour.' },
		],
		example: html`
			<wpd-cluster gap="2">
				<wpd-window-button icon="minimize"></wpd-window-button>
				<wpd-window-button icon="maximize"></wpd-window-button>
				<wpd-window-button icon="menu"></wpd-window-button>
				<wpd-window-button icon="close" danger></wpd-window-button>
			</wpd-cluster>
		`,
	} as const;

	protected render() {
		const iconKey =
			( this as unknown as { icon: string | null } ).icon || '';
		// The built-in icon map returns a raw markup string. We feed
		// it into the template via an attribute-bound span with
		// `innerHTML` on connect — but the templater handles text
		// nodes only, so the idiomatic path is a slot fallback
		// plus a `<svg>` wrapper rendered on top when an icon key
		// is known. The wrapper has no dynamic content; the slot
		// shows what the consumer provides for custom icons.
		const svgInner = ICONS[ iconKey ] || '';
		return html`
			<button type="button">
				<svg
					width="14"
					height="14"
					viewBox="0 0 12 12"
					aria-hidden="true"
					focusable="false"
				></svg>
				<slot></slot>
			</button>
			<span data-svg-buffer style="display:none">${ svgInner }</span>
		`;
	}

	/**
	 * After each render, copy the raw SVG markup into the actual
	 * `<svg>` element. The templater only writes text into slots,
	 * so we stash the intended markup in a hidden buffer and
	 * `innerHTML = ` the svg once here — a one-shot post-render
	 * hook that keeps the declarative template honest.
	 *
	 * Also wires up the `wpd-button-activate` CustomEvent that
	 * fires exactly once per gesture — the canonical contract
	 * for plugin-registered title-bar buttons. Plugin authors who
	 * use `addEventListener( 'click', cb )` directly still get
	 * what they expect (the title bar's drag-handler now excludes
	 * chrome buttons by class so static clicks land normally),
	 * but `wpd-button-activate` is the documented surface that
	 * documents the once-per-gesture contract explicitly. See
	 * the class-level docblock for rationale.
	 */
	connectedCallback(): void {
		super.connectedCallback();
		queueMicrotask( () => this._paintSvg() );
		// Wire the activate event on the same microtask cadence as
		// the SVG paint — the shadow-DOM `<button>` doesn't exist
		// until `super.connectedCallback()` finishes its render
		// pass, which the Component base may defer.
		queueMicrotask( () => this._wireActivateEvent() );
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		super.attributeChangedCallback( name, oldValue, newValue );
		queueMicrotask( () => this._paintSvg() );
	}

	private _paintSvg(): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const svg = root.querySelector( 'svg' );
		const buffer = root.querySelector( '[data-svg-buffer]' );
		if ( svg && buffer ) {
			const markup = buffer.textContent || '';
			// Only rewrite when the content actually changed —
			// avoids thrashing the DOM on every unrelated attr
			// change.
			if ( svg.innerHTML !== markup ) {
				svg.innerHTML = markup;
			}
		}
	}

	/**
	 * Tracks whether we've already wired the activate listener to
	 * the shadow's `<button>`. `connectedCallback` runs once per
	 * insertion into the DOM, so the typical lifecycle hits this
	 * once — but a host moved between containers (uncommon, but
	 * spec-allowed) would re-enter; the guard keeps double-firing
	 * out of that edge case.
	 */
	private _activateWired = false;

	private _wireActivateEvent(): void {
		if ( this._activateWired ) {
			return;
		}
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const button = root.querySelector( 'button' );
		if ( ! button ) {
			return;
		}
		this._activateWired = true;

		// One CustomEvent per native click — bubbles + composed so
		// listeners on the host (or any ancestor) receive it.
		// `composed: true` is required for the event to cross the
		// shadow boundary; otherwise it dies inside the component.
		//
		// We dispatch unconditionally on every click. We deliberately
		// do NOT check `ev.defaultPrevented` because handler order
		// is observable: a caller's `preventDefault()` listener
		// might run before or after ours depending on registration
		// order, so gating on it produces inconsistent results.
		// Callers who want to suppress activation should not bind
		// a `wpd-button-activate` listener in the first place.
		button.addEventListener( 'click', () => {
			this.dispatchEvent(
				new CustomEvent( 'wpd-button-activate', {
					bubbles: true,
					composed: true,
					cancelable: true,
				} ),
			);
		} );
	}
}
defineComponent( 'wpd-window-button', WpdWindowButton );
