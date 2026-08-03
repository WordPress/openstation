/**
 * os-ui — Component base class.
 *
 * Minimalistic Lit-style custom-element base. Extends `HTMLElement`
 * and gives subclasses:
 *
 *   - Reactive properties declared via `static props`. Each listed
 *     prop is automatically wired to an observed attribute (kebab-
 *     cased) and a typed property accessor. Assigning the property
 *     OR mutating the attribute triggers a batched re-render.
 *   - A `render()` method that returns an `html\`\`` template
 *     result. Called on microtask after any prop / attr change.
 *   - `static styles` array of `css\`\`` results, adopted onto the
 *     shadow root (or inlined as `<style>` tags when shadow is off).
 *   - Shadow DOM by default (`static shadow = true`) so `<slot>`
 *     works and component styles don't leak. Opt out with
 *     `static shadow = false` for layout-only wrappers that must
 *     sit in the outer CSS cascade (rare).
 *   - Structured custom events via `this.emit(name, detail)`.
 *
 * Not included (by design): property types / validators, attribute
 * serializers for non-string types (we keep values as strings on
 * attributes and deserialize manually when needed), lifecycle
 * callbacks beyond connected / disconnected, directive support
 * inside `html\`\``.
 */

import { render, type TemplateResult } from './html';
import type { StyleDef } from './css';
import type { OsHelp } from './help';

/**
 * Prop-accessor declaration. For now every prop is a string at the
 * attribute boundary; the property accessor lets components narrow
 * the type internally without us having to marshal booleans /
 * numbers through attributes.
 */
export type Prop = string;

/**
 * Base class for every os-ui component. Subclasses register
 * themselves with `customElements.define()`; the base class handles
 * rendering + prop reactivity.
 */
export abstract class Component extends HTMLElement {
	/** Property names this component exposes as attributes. */
	static props: readonly Prop[] = [];

	/** Stylesheets adopted (shadow) or inlined (light) on first mount. */
	static styles: readonly StyleDef[] = [];

	/**
	 * `true` (default) attaches a shadow root so `<slot>` works and
	 * component-local styles don't leak. Style the outside via CSS
	 * custom properties (`--wp-admin-theme-color`, etc.) — they
	 * inherit through shadow boundaries and give us the cascade
	 * control we actually want.
	 *
	 * Set `false` only for layout-only wrappers that don't need
	 * slotting or isolation (rare).
	 */
	static shadow = true;

	/**
	 * Optional in-product help descriptor. Consumed by the Help tab
	 * in OS Settings — components without one fall back to a minimal
	 * rendering built from `static props`. See {@link OsHelp}.
	 */
	static help?: OsHelp;

	static get observedAttributes(): string[] {
		return ( this.props as readonly string[] ).map( kebab );
	}

	/** Render target — either `this` (light DOM) or `this.shadowRoot`. */
	private _renderRoot: Element | DocumentFragment;

	/** Pending-render flag so we only schedule one microtask per batch. */
	private _renderScheduled = false;

	/** Backing store so attr + prop share state without infinite loops. */
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
		// Route through `requestUpdate()` — the single hook subclasses
		// override to plug in extra work (e.g. an imperative paint
		// pipeline alongside the templated render). Calling
		// `_scheduleRender` directly here would bypass those hooks and
		// silently desync state on attribute changes.
		this.requestUpdate();
	}

	/**
	 * Declarative class-name setter. Assign an array (or a
	 * space-separated string) and the host's `class` attribute is
	 * rewritten to match. Intended for programmatic styling — when
	 * a plugin has enqueued its own stylesheet and wants to apply
	 * one of those classes to a shell component:
	 *
	 * ```js
	 * element.classNames = [ 'my-plugin-brand', 'is-active' ];
	 * // → <os-select class="my-plugin-brand is-active">
	 * ```
	 *
	 * The plain HTML `class="…"` attribute works just the same and
	 * is always preferred when writing markup by hand — this setter
	 * exists for the JS-API case where the caller has an array of
	 * conditional classes in hand.
	 *
	 * Getter returns the current `classList` as a plain array for
	 * symmetric read/write.
	 */
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

	/**
	 * Subclasses implement this. Called on the microtask after any
	 * prop / attribute / manual `requestUpdate()` call. Must return
	 * an `html\`\`` template result — no side effects, no reaching
	 * into the DOM directly.
	 */
	protected abstract render(): TemplateResult;

	/**
	 * Request a re-render explicitly. Components rarely need this —
	 * declare state via props + attribute observers and the render
	 * loop picks up changes automatically.
	 */
	protected requestUpdate(): void {
		this._scheduleRender();
	}

	/**
	 * Dispatch a `CustomEvent` with a `detail`. Bubbles + composed
	 * by default (matches typical WC UX — events cross shadow
	 * boundaries, parents can listen without knowing about internal
	 * structure).
	 */
	protected emit<T>( name: string, detail: T ): boolean {
		return this.dispatchEvent(
			new CustomEvent( name, {
				detail,
				bubbles: true,
				composed: true,
			} ),
		);
	}

	// ------------------------------------------------------------------
	// Internals
	// ------------------------------------------------------------------

	/**
	 * Wire every `static props` entry to a matched property getter +
	 * setter on the element. Setting the property reflects into the
	 * attribute (so downstream observers + CSS selectors see it);
	 * reading the property falls back to the attribute.
	 */
	private _installPropAccessors(): void {
		const ctor = this.constructor as typeof Component;
		for ( const prop of ctor.props ) {
			if ( Object.getOwnPropertyDescriptor( this, prop ) ) {
				continue; // Don't clobber subclass-defined fields.
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
					// Match HTML's reflection convention: any of
					// `false` / `null` / `undefined` REMOVES the
					// attribute. Without this branch
					// `el.disabled = false` would call
					// `setAttribute('disabled', 'false')` and the
					// element would stay disabled — every CSS
					// `[disabled]` rule and every `hasAttribute`
					// check would still match, because attribute
					// presence is what HTML semantics care about,
					// not its string value.
					//
					// `true` reflects as the empty string (mirrors
					// `<button disabled>` which has no value), and
					// everything else stringifies as before so
					// non-boolean props like `variant` / `value`
					// keep working unchanged.
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
					// `setAttribute`/`removeAttribute` will fire
					// `attributeChangedCallback`, which itself calls
					// `requestUpdate()` — but only when the attribute
					// value actually changed at the DOM level. Programmatic
					// setters that write back the same string don't fire
					// the observer, so we still need our own update call.
					// Both paths debounce on the same flag, so the cost
					// is one extra microtask check at worst.
					this.requestUpdate();
				},
				enumerable: true,
				configurable: true,
			} );
		}
	}

	/**
	 * Schedule a render on the next microtask. Multiple property
	 * assignments in the same tick collapse into a single render.
	 */
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

	/**
	 * Mount adoptable stylesheets onto the shadow root (via
	 * `adoptedStyleSheets`) or the light DOM (via one `<style>`
	 * tag per def). No-op if `static styles` is empty.
	 */
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
			// Fallback for engines without adoptedStyleSheets — stamp
			// a `<style>` tag carrying the text.
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
			// Light DOM: inline all styles into <head> ONCE per
			// component class (identified by the class reference).
			// We intentionally don't scope these — the whole point
			// of light-DOM os-ui is so outer CSS wins. Each
			// component's styles are just "extra rules" on global.
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

/**
 * Register a tag once, silently skipping if another component beat
 * us to it (e.g. HMR reloads). Use this instead of
 * `customElements.define()` directly in component files.
 */
export function defineComponent(
	tag: string,
	ctor: CustomElementConstructor,
): void {
	if ( customElements.get( tag ) ) {
		return;
	}
	customElements.define( tag, ctor );
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function kebab( s: string ): string {
	return s.replace( /[A-Z]/g, ( c ) => '-' + c.toLowerCase() );
}

function camel( s: string ): string {
	return s.replace( /-([a-z])/g, ( _, c ) => c.toUpperCase() );
}
