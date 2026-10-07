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
		if ( ! this._keyHeldByKeyboard || ! this.matchesEvent( e, true ) ) {
			return;
		}
		this._keyHeldByKeyboard = false;
		this.classList.remove( PRESSED_CLASS );
		if ( this.hasAttribute( 'hold' ) ) {
			this.emitKey( 'os-key-up', this.buildDetail( 'keyboard' ) );
		}
	}

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

	private flashPressed(): void {
		this.classList.add( PRESSED_CLASS );
		window.setTimeout( () => {
			this.classList.remove( PRESSED_CLASS );
		}, 120 );
	}
}
defineComponent( 'os-key', OsKey );
