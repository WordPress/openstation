import { render, type TemplateResult } from './html';
import type { StyleDef } from './css';
import type { OsHelp } from './help';

export type Prop = string;

export abstract class Component extends HTMLElement {
	static props: readonly Prop[] = [];

	static styles: readonly StyleDef[] = [];

	static shadow = true;

	static help?: OsHelp;

	static get observedAttributes(): string[] {
		return ( this.props as readonly string[] ).map( kebab );
	}

	private _renderRoot: Element | DocumentFragment;

	private _renderScheduled = false;

	private _propValues: Record<string, string | null> = {};

	constructor() {
		super();
		const ctor = this.constructor as typeof Component;
		if ( ctor.shadow ) {
			this.attachShadow( { mode: 'open' } );
			this._renderRoot = this.shadowRoot!;
		} else {
			this._renderRoot = this;
		}
		this._installPropAccessors();
	}

	connectedCallback(): void {
		this._adoptStyles();
		this.requestUpdate();
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		if ( oldValue === newValue ) {
			return;
		}
		const prop = camel( name );
		this._propValues[ prop ] = newValue;

		this.requestUpdate();
	}

	get classNames(): string[] {
		return Array.from( this.classList );
	}
	set classNames( next: string | readonly string[] | null | undefined ) {
		if ( next === null || next === undefined ) {
			this.removeAttribute( 'class' );
			return;
		}
		const list = Array.isArray( next )
			? next
			: String( next ).split( /\s+/ );
		const cleaned = list
			.map( ( s ) => String( s ).trim() )
			.filter( ( s ) => s !== '' );
		this.className = cleaned.join( ' ' );
	}

	protected abstract render(): TemplateResult;

	protected requestUpdate(): void {
		this._scheduleRender();
	}

	protected emit<T>( name: string, detail: T ): boolean {
		return this.dispatchEvent(
			new CustomEvent( name, {
				detail,
				bubbles: true,
				composed: true,
			} ),
		);
	}

	private _installPropAccessors(): void {
		const ctor = this.constructor as typeof Component;
		for ( const prop of ctor.props ) {
			if ( Object.getOwnPropertyDescriptor( this, prop ) ) {
				continue;
			}
			const attr = kebab( prop );
			Object.defineProperty( this, prop, {
				get: (): string | null => {
					if ( prop in this._propValues ) {
						return this._propValues[ prop ];
					}
					return this.getAttribute( attr );
				},
				set: ( value: unknown ): void => {
					let str: string | null;
					if ( value === null || value === undefined || value === false ) {
						str = null;
					} else if ( value === true ) {
						str = '';
					} else {
						str = String( value );
					}
					this._propValues[ prop ] = str;
					if ( str === null ) {
						this.removeAttribute( attr );
					} else {
						this.setAttribute( attr, str );
					}

					this.requestUpdate();
				},
				enumerable: true,
				configurable: true,
			} );
		}
	}

	private _scheduleRender(): void {
		if ( this._renderScheduled || ! this.isConnected ) {
			return;
		}
		this._renderScheduled = true;
		queueMicrotask( () => {
			this._renderScheduled = false;
			if ( ! this.isConnected ) {
				return;
			}
			render( this.render(), this._renderRoot );
		} );
	}

	private _adoptStyles(): void {
		const ctor = this.constructor as typeof Component;
		if ( ctor.styles.length === 0 ) {
			return;
		}
		if ( ctor.shadow && this.shadowRoot ) {
			const sheets = ctor.styles
				.map( ( s ) => s.sheet )
				.filter( ( s ): s is CSSStyleSheet => s !== null );
			this.shadowRoot.adoptedStyleSheets = sheets;

			if ( sheets.length !== ctor.styles.length ) {
				for ( const s of ctor.styles ) {
					if ( ! s.sheet ) {
						const tag = document.createElement( 'style' );
						tag.textContent = s.cssText;
						this.shadowRoot.appendChild( tag );
					}
				}
			}
		} else {
			this._adoptLightStyles( ctor );
		}
	}

	private static _lightStylesAdopted = new WeakSet<typeof Component>();

	private _adoptLightStyles( ctor: typeof Component ): void {
		if ( Component._lightStylesAdopted.has( ctor ) ) {
			return;
		}
		Component._lightStylesAdopted.add( ctor );
		for ( const s of ctor.styles ) {
			const tag = document.createElement( 'style' );
			tag.dataset.osUi = this.tagName.toLowerCase();
			tag.textContent = s.cssText;
			document.head.appendChild( tag );
		}
	}
}

export function defineComponent(
	tag: string,
	ctor: CustomElementConstructor,
): void {
	if ( customElements.get( tag ) ) {
		return;
	}
	customElements.define( tag, ctor );
}

function kebab( s: string ): string {
	return s.replace( /[A-Z]/g, ( c ) => '-' + c.toLowerCase() );
}

function camel( s: string ): string {
	return s.replace( /-([a-z])/g, ( _, c ) => c.toUpperCase() );
}
