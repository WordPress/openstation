/**
 * `<os-code>` — inline (or block) monospace code badge.
 *
 * Why a separate component from `<os-key>`: `<os-key>` reads like
 * inline code but installs a global `keydown` listener so the tile
 * flashes when the key is pressed — great for on-screen keyboards,
 * disastrous for rendering strings like `chrome://flags` (that would
 * silently intercept `c` / `h` / `r` / …). `<os-code>` has zero
 * listeners and zero visual chrome interaction — it's just a styled
 * `<code>` host.
 *
 * Usage:
 *
 *   <os-code>chrome://flags</os-code>
 *
 *   <!-- Multi-line snippet -->
 *   <os-code block>
 *     openstation_register_settings_tab( array( …) );
 *   </os-code>
 *
 *   <!-- Snippet with a built-in copy button -->
 *   <os-code block copy>
 *     SELECT * FROM wp_posts WHERE post_status = 'publish';
 *   </os-code>
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-code.styles';

export class OsCode extends Component {
	static props = [ 'block', 'copy' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Code',
		summary:
			'Inline monospace code badge — safe for URLs, flag names, and any string that would otherwise steal keypresses if rendered as <os-key>. Set `block` for a multi-line snippet box. Set `copy` for a built-in copy-to-clipboard affordance.',
		status: 'stable',
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
					'When present, adds a copy-to-clipboard button. Always visible (dimmed) on inline variants; hover/focus-revealed in the top-right corner on `block`. Fires a `os-copy` event after a successful copy.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Code text content.' },
		],
		events: [
			{
				name: 'os-copy',
				description:
					'Fires after a successful clipboard write. `detail.text` is the copied string.',
			},
		],
		cssProps: [
			{ name: '--os-ui-code-bg', default: 'rgba(0,0,0,0.06)' },
			{ name: '--os-ui-code-fg', default: 'var(--os-ui-fg)' },
			{ name: '--os-ui-code-border', default: '1px solid rgba(0,0,0,0.08)' },
			{ name: '--os-ui-code-padding', default: '0.1em 0.4em' },
			{ name: '--os-ui-code-block-padding', default: '10px 12px' },
			{ name: '--os-ui-code-border-radius', default: '4px' },
			{ name: '--os-ui-code-font-family', default: 'ui-monospace, …' },
			{ name: '--os-ui-code-font-size', default: '0.92em' },
			{
				name: '--os-ui-code-white-space',
				default: 'nowrap',
				description:
					'Inline variant only — override to `normal` to let long tokens wrap.',
			},
		],
		example: html`
			Open <os-code>chrome://flags</os-code> and search for
			<os-code>experimental-web-platform-features</os-code>.
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
			this.emit( 'os-copy', { text } );
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
	 * keeps composed slot content (`<os-code>...nested<os-code>`)
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
defineComponent( 'os-code', OsCode );
