/**
 * `<wpd-window-button>` — single chrome button used in window
 * title bars. Built-in icons cover the five control buttons
 * (minimize / maximize / fullscreen-toggle / detach / close) plus
 * the `⋯` menu trigger. A slot lets plugin authors ship custom
 * icons by dropping inline SVG inside the tag.
 *
 * Focused / unfocused coloring is driven by outer CSS custom
 * properties (`--wpd-btn-color`, `--wpd-btn-bg-hover`, etc.) that
 * the window shell sets based on its own `--focused` class — see
 * `wpd-window-button.styles.ts` for the full set.
 *
 * Attributes:
 *   - `icon="minimize" | "maximize" | "fullscreen" | "fullscreen-exit"
 *          | "detach" | "close" | "menu"` — picks a built-in SVG
 *   - `active` — boolean, applies the pressed-down look
 *   - `danger` — boolean, swaps hover to a red wash (used by the
 *     close button)
 *
 * Events: native `click` bubbles. No custom CustomEvent — the
 * consumer just attaches a click listener.
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
				type: "'minimize' | 'maximize' | 'fullscreen' | 'fullscreen-exit' | 'detach' | 'close' | 'menu'",
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
	 */
	connectedCallback(): void {
		super.connectedCallback();
		queueMicrotask( () => this._paintSvg() );
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
}
defineComponent( 'wpd-window-button', WpdWindowButton );
