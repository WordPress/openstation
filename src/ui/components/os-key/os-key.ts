/**
 * `<os-key>` — semantic key cap. A press-sensitive tile that
 * fires a `os-key` CustomEvent both on click AND when the
 * matching `event.key` / `event.code` is pressed anywhere on
 * the owning document. Intended for calculators, keyboards,
 * synths, keybinding demos — anything that needs a "real key"
 * with a live press animation plus a clear physical-key contract.
 *
 * Usage:
 *
 *   <os-key key="7"        label="7"></os-key>
 *   <os-key key="Enter"    label="="></os-key>
 *   <os-key key="Escape"   label="AC"></os-key>
 *   <os-key code="NumpadAdd" key="+" label="+"></os-key>
 *
 *   document.addEventListener( 'os-key', ( e ) => {
 *     console.log( e.detail.key, e.detail.source );
 *   } );
 *
 * Attributes:
 *   - `key`     — KeyboardEvent.key to match. Case-sensitive, per the spec.
 *   - `code`    — KeyboardEvent.code to match (takes priority over `key`
 *                 when set). Good for positional keys (NumpadAdd,
 *                 KeyA) that shouldn't match the shifted variant.
 *   - `label`   — visible text. Falls back to the default slot.
 *   - `variant` — `primary` | `secondary` | `ghost` | `danger` (mirrors
 *                 `<os-button>`). Default `ghost`.
 *   - `fill-cell` — boolean; keys fill their parent grid cell.
 *                 Default on — calculators are the common case.
 *   - `hold`    — boolean; press + release dispatch separate
 *                 `os-key-down` / `os-key-up` events instead of
 *                 the single `os-key`. Useful for synths and games.
 *   - `modifier` — `ctrl` | `alt` | `shift` | `meta` | combos joined
 *                 with `+` (e.g. `ctrl+shift`). Required for the key
 *                 match to fire when those modifiers are held.
 *
 * Events:
 *   - `os-key`      — fires once per press (click OR keydown).
 *                      `detail: { key, code, label, source: 'click' | 'keyboard' }`.
 *   - `os-key-down` — only when `hold` is set. Same detail shape.
 *   - `os-key-up`   — only when `hold` is set. Same detail shape.
 *
 * Every event bubbles and `composed: true`, so listeners can live
 * anywhere in the tree including the shadow of a parent component.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-key.styles';

const PRESSED_CLASS = 'os-key--pressed';

type KeySource = 'click' | 'keyboard';

interface OsKeyDetail {
	key: string;
	code: string;
	label: string;
	source: KeySource;
}

export class OsKey extends Component {
	static props = [
		'key',
		'code',
		'label',
		'variant',
		'fill-cell',
		'hold',
		'modifier',
		'disabled',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Key',
		summary:
			'Semantic key cap — a press-sensitive tile that fires os-key on click AND when the matching event.key/event.code is pressed anywhere on the document. Use for calculators, on-screen keyboards, synths, and keybinding demos.',
		status: 'stable',
		since: '0.5.0',
		props: [
			{
				name: 'key',
				type: 'string (KeyboardEvent.key)',
				description: 'Key value to match. Case-sensitive per the spec.',
			},
			{
				name: 'code',
				type: 'string (KeyboardEvent.code)',
				description: 'Positional key code to match. Takes priority over `key` when set.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'Visible text on the cap. Falls back to slotted content.',
			},
			{
				name: 'variant',
				type: "'primary' | 'secondary' | 'ghost' | 'danger'",
				default: 'ghost',
				description: 'Visual weight (mirrors <os-button>).',
			},
			{
				name: 'fill-cell',
				type: 'boolean attribute',
				description: 'Grow to fill the parent grid cell. Usually on for calculator layouts.',
			},
			{
				name: 'hold',
				type: 'boolean attribute',
				description: 'Switch from a single os-key to paired os-key-down / os-key-up events. Useful for synths and games.',
			},
			{
				name: 'modifier',
				type: "'ctrl' | 'alt' | 'shift' | 'meta', combos joined by '+'",
				description: 'Required modifier set for a keyboard match. Strict matching prevents bare `7` firing on Ctrl+7.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Disables click + keyboard matching.',
			},
		],
		parts: [
			{ name: 'button', description: 'Underlying <button> element.' },
		],
		events: [
			{
				name: 'os-key',
				description: 'Fires once per press (click OR keydown) when `hold` is not set.',
				detail: "{ key, code, label, source: 'click' | 'keyboard' }",
			},
			{
				name: 'os-key-down',
				description: 'When `hold` is set, fires on press.',
				detail: "{ key, code, label, source: 'click' | 'keyboard' }",
			},
			{
				name: 'os-key-up',
				description: 'When `hold` is set, fires on release.',
				detail: "{ key, code, label, source: 'click' | 'keyboard' }",
			},
		],
		cssProps: [
			{ name: '--os-ui-key-bg' },
			{ name: '--os-ui-key-bg-hover' },
			{ name: '--os-ui-key-bg-pressed' },
			{ name: '--os-ui-key-fg' },
			{ name: '--os-ui-key-border' },
			{ name: '--os-ui-key-border-radius' },
			{ name: '--os-ui-key-padding' },
			{ name: '--os-ui-key-min-height' },
			{ name: '--os-ui-key-font-size' },
		],
		example: html`
			<os-grid columns="4" gap="4">
				<os-key key="7" label="7"></os-key>
				<os-key key="8" label="8"></os-key>
				<os-key key="9" label="9"></os-key>
				<os-key key="/" label="÷" variant="primary"></os-key>
				<os-key key="Escape" label="AC" variant="danger"></os-key>
				<os-key key="Backspace" label="⌫"></os-key>
				<os-key key="%" label="%"></os-key>
				<os-key key="Enter" label="=" variant="primary"></os-key>
			</os-grid>
		`,
	} as const;

	private _onKeyDown: ( ( e: KeyboardEvent ) => void ) | null = null;
	private _onKeyUp: ( ( e: KeyboardEvent ) => void ) | null = null;
	private _keyHeldByKeyboard = false;

	connectedCallback(): void {
		super.connectedCallback?.();
		this._onKeyDown = ( e: KeyboardEvent ) => this.handleKeyboardDown( e );
		this._onKeyUp = ( e: KeyboardEvent ) => this.handleKeyboardUp( e );
		document.addEventListener( 'keydown', this._onKeyDown );
		document.addEventListener( 'keyup', this._onKeyUp );
	}

	disconnectedCallback(): void {
		if ( this._onKeyDown ) {
			document.removeEventListener( 'keydown', this._onKeyDown );
		}
		if ( this._onKeyUp ) {
			document.removeEventListener( 'keyup', this._onKeyUp );
		}
	}

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label;
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		return html`
			<button
				part="button"
				class="os-holo-sheen"
				type="button"
				?disabled=${ disabled }
				@click=${ ( e: MouseEvent ) => this.handleClick( e ) }
			>
				${ label !== null && label !== undefined && label !== ''
		? label
		: html`<slot></slot>` }
				<span class="os-holo-glint" aria-hidden="true"></span>
				<span class="os-holo-ring" aria-hidden="true"></span>
			</button>
		`;
	}

	private handleClick( e: MouseEvent ): void {
		if ( this.isDisabled() ) {
			return;
		}
		const detail = this.buildDetail( 'click' );
		this.flashPressed();
		if ( this.hasAttribute( 'hold' ) ) {
			this.emitKey( 'os-key-down', detail );
			this.emitKey( 'os-key-up', detail );
		} else {
			this.emitKey( 'os-key', detail );
		}
		e.stopPropagation();
	}

	private handleKeyboardDown( e: KeyboardEvent ): void {
		if ( this.isDisabled() || ! this.matchesEvent( e ) ) {
			return;
		}
		if ( this._keyHeldByKeyboard ) {
			return;
		}
		this._keyHeldByKeyboard = true;
		this.classList.add( PRESSED_CLASS );
		const detail = this.buildDetail( 'keyboard' );
		if ( this.hasAttribute( 'hold' ) ) {
			this.emitKey( 'os-key-down', detail );
		} else {
			this.emitKey( 'os-key', detail );
		}
	}

	private handleKeyboardUp( e: KeyboardEvent ): void {
		if ( ! this._keyHeldByKeyboard || ! this.matchesEvent( e, /* up */ true ) ) {
			return;
		}
		this._keyHeldByKeyboard = false;
		this.classList.remove( PRESSED_CLASS );
		if ( this.hasAttribute( 'hold' ) ) {
			this.emitKey( 'os-key-up', this.buildDetail( 'keyboard' ) );
		}
	}

	/**
	 * Decide whether an incoming KeyboardEvent matches the key cap.
	 * Prefers `code` (positional) when set, falls back to `key`
	 * (character / named). Modifier-matching is strict: if
	 * `modifier` is absent, no modifier may be held; if present,
	 * ALL listed modifiers must be held. Prevents a bare `7` key
	 * from firing when the user presses Ctrl+7.
	 */
	private matchesEvent( e: KeyboardEvent, _isUp = false ): boolean {
		const expectedCode =
			( this as unknown as { code: string | null } ).code || '';
		const expectedKey =
			( this as unknown as { key: string | null } ).key || '';
		if ( expectedCode ) {
			if ( e.code !== expectedCode ) {
				return false;
			}
		} else if ( expectedKey ) {
			if ( e.key !== expectedKey ) {
				return false;
			}
		} else {
			return false;
		}

		const rawMod =
			( this as unknown as { modifier: string | null } ).modifier || '';
		const required = new Set(
			rawMod
				.split( '+' )
				.map( ( s ) => s.trim().toLowerCase() )
				.filter( Boolean ),
		);
		const expectCtrl = required.has( 'ctrl' ) || required.has( 'control' );
		const expectAlt = required.has( 'alt' );
		const expectShift = required.has( 'shift' );
		const expectMeta =
			required.has( 'meta' ) || required.has( 'cmd' ) || required.has( 'command' );

		return (
			e.ctrlKey === expectCtrl &&
			e.altKey === expectAlt &&
			e.shiftKey === expectShift &&
			e.metaKey === expectMeta
		);
	}

	private buildDetail( source: KeySource ): OsKeyDetail {
		const label =
			( this as unknown as { label: string | null } ).label ||
			this.textContent?.trim() ||
			'';
		return {
			key: ( this as unknown as { key: string | null } ).key || '',
			code: ( this as unknown as { code: string | null } ).code || '',
			label,
			source,
		};
	}

	private isDisabled(): boolean {
		return ( this as unknown as { disabled: string | null } ).disabled !== null;
	}

	private emitKey( type: string, detail: OsKeyDetail ): void {
		this.dispatchEvent(
			new CustomEvent< OsKeyDetail >( type, {
				detail,
				bubbles: true,
				composed: true,
			} ),
		);
	}

	/**
	 * Brief visual press flash for click-driven presses — keyboard
	 * presses get the pressed class via the keydown/keyup pair.
	 * Timeout matches the CSS transition so the paint window
	 * roughly aligns with the state flip.
	 */
	private flashPressed(): void {
		this.classList.add( PRESSED_CLASS );
		window.setTimeout( () => {
			this.classList.remove( PRESSED_CLASS );
		}, 120 );
	}
}
defineComponent( 'os-key', OsKey );
