/**
 * `<wpd-code>` — inline (or block) monospace code badge.
 *
 * Why a separate component from `<wpd-key>`: `<wpd-key>` reads like
 * inline code but installs a global `keydown` listener so the tile
 * flashes when the key is pressed — great for on-screen keyboards,
 * disastrous for rendering strings like `chrome://flags` (that would
 * silently intercept `c` / `h` / `r` / …). `<wpd-code>` has zero
 * listeners and zero visual chrome interaction — it's just a styled
 * `<code>` host.
 *
 * Usage:
 *
 *   <wpd-code>chrome://flags</wpd-code>
 *
 *   <!-- Multi-line snippet -->
 *   <wpd-code block>
 *     desktop_mode_register_settings_tab( array( …) );
 *   </wpd-code>
 *
 *   <!-- Snippet with a built-in copy button -->
 *   <wpd-code block copy>
 *     SELECT * FROM wp_posts WHERE post_status = 'publish';
 *   </wpd-code>
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-code.styles';

export class WpdCode extends Component {
	static props = [ 'block', 'copy' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Code',
		summary:
			'Inline monospace code badge — safe for URLs, flag names, and any string that would otherwise steal keypresses if rendered as <wpd-key>. Set `block` for a multi-line snippet box. Set `copy` for a built-in copy-to-clipboard affordance.',
		status: 'experimental',
		since: '0.5.1',
		props: [
			{
				name: 'block',
				type: 'boolean',
				description:
					'When present, renders as a multi-line `<pre>`-style box with horizontal scrolling on overflow.',
			},
			{
				name: 'copy',
				type: 'boolean',
				description:
					'When present, adds a copy-to-clipboard button. Always visible (dimmed) on inline variants; hover/focus-revealed in the top-right corner on `block`. Fires a `wpd-copy` event after a successful copy.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Code text content.' },
		],
		events: [
			{
				name: 'wpd-copy',
				description:
					'Fires after a successful clipboard write. `detail.text` is the copied string.',
			},
		],
		cssProps: [
			{ name: '--wpd-code-bg', default: 'rgba(0,0,0,0.06)' },
			{ name: '--wpd-code-fg', default: 'var(--wpd-fg)' },
			{ name: '--wpd-code-border', default: '1px solid rgba(0,0,0,0.08)' },
			{ name: '--wpd-code-padding', default: '0.1em 0.4em' },
			{ name: '--wpd-code-block-padding', default: '10px 12px' },
			{ name: '--wpd-code-border-radius', default: '4px' },
			{ name: '--wpd-code-font-family', default: 'ui-monospace, …' },
			{ name: '--wpd-code-font-size', default: '0.92em' },
			{
				name: '--wpd-code-white-space',
				default: 'nowrap',
				description:
					'Inline variant only — override to `normal` to let long tokens wrap.',
			},
		],
		example: html`
			Open <wpd-code>chrome://flags</wpd-code> and search for
			<wpd-code>experimental-web-platform-features</wpd-code>.
		`,
	} as const;

	private _copied = false;
	private _resetTimer: ReturnType< typeof setTimeout > | null = null;

	disconnectedCallback?(): void;

	private _onCopy = ( e: Event ): void => {
		e.stopPropagation();
		const text = this._readSlotText();
		if ( text === '' ) {
			return;
		}
		const finalize = ( ok: boolean ): void => {
			if ( ! ok ) {
				return;
			}
			this._copied = true;
			this.requestUpdate();
			this.emit( 'wpd-copy', { text } );
			if ( this._resetTimer ) {
				clearTimeout( this._resetTimer );
			}
			// 1.5 s holds the visual confirmation long enough to
			// register without lingering. Tuned to match other
			// micro-interactions in the shell (toast, undo banners).
			this._resetTimer = setTimeout( () => {
				this._copied = false;
				this._resetTimer = null;
				this.requestUpdate();
			}, 1500 );
		};
		const cb = ( navigator as unknown as {
			clipboard?: { writeText: ( s: string ) => Promise< void > };
		} ).clipboard;
		if ( cb && typeof cb.writeText === 'function' ) {
			cb.writeText( text ).then(
				() => finalize( true ),
				() => finalize( this._fallbackCopy( text ) ),
			);
		} else {
			finalize( this._fallbackCopy( text ) );
		}
	};

	/**
	 * Read every text node in the default slot. Walking the slot's
	 * `assignedNodes({ flatten: true })` rather than `this.textContent`
	 * keeps composed slot content (`<wpd-code>...nested<wpd-code>`)
	 * out of the copied string — only top-level text matters for a
	 * snippet copy.
	 */
	private _readSlotText(): string {
		const slot = this.shadowRoot?.querySelector( 'slot' ) as HTMLSlotElement | null;
		if ( ! slot ) {
			return ( this.textContent || '' ).trim();
		}
		const nodes = slot.assignedNodes( { flatten: true } );
		const out = nodes.map( ( n ) => n.textContent ?? '' ).join( '' );
		return out.trim();
	}

	/**
	 * Pre-Clipboard-API fallback: stage a hidden textarea, select,
	 * `document.execCommand( 'copy' )`. Kept around so the component
	 * works under permission-locked iframes where the modern API
	 * silently rejects.
	 */
	private _fallbackCopy( text: string ): boolean {
		try {
			const ta = document.createElement( 'textarea' );
			ta.value = text;
			ta.setAttribute( 'readonly', '' );
			ta.style.position = 'absolute';
			ta.style.left = '-9999px';
			document.body.appendChild( ta );
			ta.select();
			const ok = document.execCommand( 'copy' );
			document.body.removeChild( ta );
			return ok;
		} catch {
			return false;
		}
	}

	protected render() {
		const showCopy = this.getAttribute( 'copy' ) !== null;
		return html`<code><slot></slot></code>${
			showCopy
				? html`<button
						type="button"
						class="copy"
						part="copy"
						aria-label="${ this._copied ? 'Copied' : 'Copy code to clipboard' }"
						@click=${ this._onCopy }
				  >
						${ this._copied ? '✓' : '⧉' }
				  </button>`
				: ''
		}`;
	}
}
defineComponent( 'wpd-code', WpdCode );
