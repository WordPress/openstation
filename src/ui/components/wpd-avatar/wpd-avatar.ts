/**
 * `<wpd-avatar>` — user tile primitive.
 *
 * Renders an image when `src` is set; falls back to a colored circle
 * with the first code point of `name` when no source is available.
 * The fallback hue is deterministic (same name → same color across
 * reloads), so each user gets a stable visual identity even without
 * a profile picture.
 *
 * Optional presence dot in the bottom-end corner — `online` /
 * `inactive` / `offline` — colored from the shell theme variables.
 * Set `user-id` to auto-subscribe the dot to the framework's
 * `desktop-mode-presence-changed` events on `document`, so the dot
 * stays accurate as long as the avatar is mounted.
 *
 * ```html
 * <wpd-avatar src="https://…/me.jpg" alt="Daniel" size="40"></wpd-avatar>
 * <wpd-avatar name="Eric Andersen" presence="online"></wpd-avatar>
 * <wpd-avatar user-id="42" name="Pat" size="lg"></wpd-avatar>
 * ```
 */

import { Component, defineComponent, html } from '../../core';
import { hashTitleToHue } from '../../util/hash-hue';
import { avatarStyles } from './wpd-avatar.styles';

const SIZE_MAP: Record< string, number > = {
	xs: 20,
	sm: 24,
	md: 40,
	lg: 64,
	xl: 96,
};

const VALID_PRESENCE = new Set( [ 'online', 'inactive', 'offline' ] );

export type WpdAvatarPresence = 'online' | 'inactive' | 'offline';

export class WpdAvatar extends Component {
	static props = [ 'src', 'alt', 'name', 'size', 'presence', 'userId', 'clickable' ] as const;
	static styles = [ avatarStyles ];

	static help = {
		title: 'Avatar',
		summary:
			'Image-or-initials user tile with an optional presence dot. Falls back to a deterministic-hue letter tile when src is empty. Set user-id to auto-subscribe the dot to desktop-mode-presence-changed.',
		status: 'stable',
		since: '0.6.0',
		props: [
			{ name: 'src', type: 'string', description: 'Image URL. Falls back to initials when empty or load fails.' },
			{ name: 'alt', type: 'string', description: 'Alt text for the image. Defaults to `name` when omitted.' },
			{ name: 'name', type: 'string', description: 'Used for initials + hue fallback when no src.' },
			{
				name: 'size',
				type: 'number | "xs" | "sm" | "md" | "lg" | "xl"',
				description: 'Pixel size or named preset. Default 32 (sm-ish). Sets --wpd-avatar-size.',
			},
			{
				name: 'presence',
				type: '"online" | "inactive" | "offline"',
				description: 'Presence dot color. Omit for no dot.',
			},
			{
				name: 'user-id',
				type: 'number',
				description: 'When set AND presence is unset, auto-subscribes to desktop-mode-presence-changed and updates the dot.',
			},
			{
				name: 'clickable',
				type: 'boolean attribute',
				description: 'Renders the tile as a focusable button that emits wpd-avatar-click. Omit for a decorative tile that lets clicks pass through to the surrounding row.',
			},
		],
		events: [
			{
				name: 'wpd-avatar-click',
				description: 'Fires on click when the `clickable` attribute is set. Detail carries userId when set.',
				detail: '{ userId: number | null }',
			},
		],
		cssProps: [
			{ name: '--wpd-avatar-size', description: 'Tile size in any CSS length. Set automatically by the size attribute.' },
			{ name: '--wpd-avatar-dot-ring', description: 'Background color used as the dot ring (matches surrounding panel by default).' },
		],
		example: html`
			<wpd-avatar name="Daniel" size="40" presence="online"></wpd-avatar>
		`,
	} as const;

	private _presenceHandler: ( ( e: Event ) => void ) | null = null;
	private _imgFailed = false;
	private _onPointerMove: ( ( e: PointerEvent ) => void ) | null = null;
	private _onPointerEnter: ( ( e: PointerEvent ) => void ) | null = null;
	private _onPointerLeave: ( ( e: PointerEvent ) => void ) | null = null;
	/**
	 * Rolling RAF id for tilt updates. Pointer events fire faster than
	 * the browser can paint; coalescing through `requestAnimationFrame`
	 * collapses bursts into one DOM write per frame.
	 */
	private _tiltRaf = 0;
	private _pendingTiltX = '0deg';
	private _pendingTiltY = '0deg';
	private _pendingGlareX = '50%';
	private _pendingGlareY = '50%';

	connectedCallback(): void {
		super.connectedCallback();
		this._maybeAttachPresenceListener();
		this._attachHoverEffect();
	}

	disconnectedCallback(): void {
		if ( this._presenceHandler ) {
			document.removeEventListener(
				'desktop-mode-presence-changed',
				this._presenceHandler,
			);
			this._presenceHandler = null;
		}
		this._detachHoverEffect();
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		super.attributeChangedCallback( name, oldValue, newValue );
		if ( name === 'src' ) {
			// Reset failed state when the src changes — let the new src
			// have a fresh chance to load.
			this._imgFailed = false;
		}
		if ( name === 'user-id' || name === 'presence' ) {
			this._maybeAttachPresenceListener();
		}
	}

	protected render() {
		const src = this._attr( 'src' );
		const name = this._attr( 'name' ) || '';
		const altRaw = this._attr( 'alt' );
		const alt = altRaw !== null ? altRaw : name;
		const sizeRaw = this._attr( 'size' );
		const size = this._resolveSize( sizeRaw );
		const presence = this._presenceForRender();
		// Avatars are decorative by default — they render as a non-
		// interactive `<div>`, so clicks pass straight through to the
		// surrounding row / link. Set the `clickable` boolean attribute
		// to opt into a focusable `<button>` (e.g., a profile pill).
		const clickable = this._attr( 'clickable' ) !== null;

		// Set the CSS custom property at host level so size cascades
		// through the styles. Use `style` attribute so external CSS
		// can still win via specificity.
		this.style.setProperty( '--wpd-avatar-size', `${ size }px` );

		const initialsBg = src && ! this._imgFailed ? '' : this._initialsBg( name );
		const inner = src && ! this._imgFailed
			? html`<img
					src=${ src }
					alt=${ alt }
					@error=${ () => this._onImgError() }
					loading="lazy"
				/>`
			: this._initials( name );

		const dot = presence
			? html`<span
					class=${ `wpd-avatar__dot wpd-avatar__dot--${ presence }` }
					aria-label=${ this._presenceLabel( presence ) }
				></span>`
			: html``;

		if ( clickable ) {
			return html`
				<button
					type="button"
					class="wpd-avatar__tile"
					aria-label=${ alt || 'User' }
					style=${ initialsBg ? `background:${ initialsBg };` : '' }
					@click=${ ( e: MouseEvent ) => this._onClick( e ) }
				>${ inner }</button>
				${ dot }
			`;
		}

		// Non-clickable: a plain `<div>` so the surrounding row's
		// click handler isn't fighting a focusable inner element for
		// the click target / :active visual feedback. Non-clickable
		// tiles do NOT emit `wpd-avatar-click` — only the `clickable`
		// button branch wires the handler.
		return html`
			<div
				class="wpd-avatar__tile"
				role="img"
				aria-label=${ alt || 'User' }
				style=${ initialsBg ? `background:${ initialsBg };` : '' }
			>${ inner }</div>
			${ dot }
		`;
	}

	private _attr( name: string ): string | null {
		return this.getAttribute( name );
	}

	private _resolveSize( raw: string | null ): number {
		if ( ! raw ) {
			return 32;
		}
		if ( raw in SIZE_MAP ) {
			return SIZE_MAP[ raw ];
		}
		const n = Number( raw );
		return Number.isFinite( n ) && n > 0 ? n : 32;
	}

	private _initials( name: string ): string {
		const trimmed = name.trim();
		if ( ! trimmed ) {
			return '?';
		}
		// First code point — handles emoji, accented chars cleanly.
		return Array.from( trimmed )[ 0 ]?.toUpperCase() ?? '?';
	}

	private _initialsBg( name: string ): string {
		const hue = hashTitleToHue( name );
		return `linear-gradient(135deg, hsl(${ hue } 62% 55%), hsl(${
			( hue + 24 ) % 360
		} 58% 42%))`;
	}

	private _presenceForRender(): WpdAvatarPresence | null {
		const raw = this._attr( 'presence' );
		if ( raw && VALID_PRESENCE.has( raw ) ) {
			return raw as WpdAvatarPresence;
		}
		return null;
	}

	private _presenceLabel( p: WpdAvatarPresence ): string {
		switch ( p ) {
			case 'online':
				return 'Online';
			case 'inactive':
				return 'Inactive';
			case 'offline':
				return 'Offline';
		}
	}

	private _onImgError(): void {
		this._imgFailed = true;
		this.requestUpdate();
	}

	private _onClick( e: MouseEvent ): void {
		const userId = this._attr( 'user-id' );
		const detail = {
			userId: userId !== null ? Number( userId ) || null : null,
			originalEvent: e,
		};
		this.emit( 'wpd-avatar-click', detail );
	}

	/**
	 * Wire up the pointer-driven tilt + glare. Listens on the host so
	 * one set of bindings covers both the clickable `<button>` and
	 * the decorative `<div>` rendering branches. The actual math
	 * runs in `_handlePointerMove`; this method just owns the
	 * bind/unbind plumbing.
	 *
	 * Bails entirely when `prefers-reduced-motion: reduce` is set —
	 * the CSS has its own `@media` guard for the visual layer, but
	 * skipping the JS too saves the per-event work for users who
	 * won't benefit from it.
	 */
	private _attachHoverEffect(): void {
		// Respect the user's motion preference. SSR / non-DOM contexts
		// don't have `matchMedia`, so guard.
		const reduceMotion =
			typeof window !== 'undefined' &&
			window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		if ( reduceMotion ) {
			return;
		}

		this._onPointerEnter = (): void => {
			this.style.setProperty( '--wpd-avatar-hover', '1' );
		};
		this._onPointerLeave = (): void => {
			this.style.setProperty( '--wpd-avatar-hover', '0' );
			// Reset the tilt/glare so the next pointer-enter starts from
			// a neutral pose instead of snapping from wherever the
			// pointer last hovered.
			this._pendingTiltX = '0deg';
			this._pendingTiltY = '0deg';
			this._pendingGlareX = '50%';
			this._pendingGlareY = '50%';
			this._flushTilt();
		};
		this._onPointerMove = ( e: PointerEvent ): void => {
			const rect = this.getBoundingClientRect();
			if ( rect.width === 0 || rect.height === 0 ) {
				return;
			}
			// Normalize pointer position to [-1, 1] from tile center.
			const nx = ( e.clientX - rect.left ) / rect.width - 0.5;
			const ny = ( e.clientY - rect.top ) / rect.height - 0.5;

			// Maximum tilt angle (degrees). 14° feels animated without
			// looking jittery. Sign: pointer on the right (positive
			// nx) → right edge tips TOWARD the viewer →
			// rotateY is +nx * MAX. Pointer above center (negative
			// ny) → top edge tips toward viewer → rotateX = -ny * MAX.
			const MAX = 14;
			this._pendingTiltY = `${ ( nx * MAX ).toFixed( 2 ) }deg`;
			this._pendingTiltX = `${ ( -ny * MAX ).toFixed( 2 ) }deg`;
			// Glare follows the pointer position as a percentage of
			// the tile box. Clamp to [0, 100] so a pointer that
			// briefly leaves the bounds doesn't push the bloom
			// off-canvas.
			const gx = Math.max( 0, Math.min( 100, ( nx + 0.5 ) * 100 ) );
			const gy = Math.max( 0, Math.min( 100, ( ny + 0.5 ) * 100 ) );
			this._pendingGlareX = `${ gx.toFixed( 1 ) }%`;
			this._pendingGlareY = `${ gy.toFixed( 1 ) }%`;

			if ( ! this._tiltRaf ) {
				this._tiltRaf = requestAnimationFrame( () => this._flushTilt() );
			}
		};

		this.addEventListener( 'pointerenter', this._onPointerEnter );
		this.addEventListener( 'pointerleave', this._onPointerLeave );
		this.addEventListener( 'pointermove', this._onPointerMove );
	}

	private _flushTilt(): void {
		this._tiltRaf = 0;
		this.style.setProperty( '--wpd-avatar-tilt-x', this._pendingTiltX );
		this.style.setProperty( '--wpd-avatar-tilt-y', this._pendingTiltY );
		this.style.setProperty( '--wpd-avatar-glare-x', this._pendingGlareX );
		this.style.setProperty( '--wpd-avatar-glare-y', this._pendingGlareY );
	}

	private _detachHoverEffect(): void {
		if ( this._onPointerMove ) {
			this.removeEventListener( 'pointermove', this._onPointerMove );
			this._onPointerMove = null;
		}
		if ( this._onPointerEnter ) {
			this.removeEventListener( 'pointerenter', this._onPointerEnter );
			this._onPointerEnter = null;
		}
		if ( this._onPointerLeave ) {
			this.removeEventListener( 'pointerleave', this._onPointerLeave );
			this._onPointerLeave = null;
		}
		if ( this._tiltRaf ) {
			cancelAnimationFrame( this._tiltRaf );
			this._tiltRaf = 0;
		}
	}

	private _maybeAttachPresenceListener(): void {
		// Only auto-subscribe when caller set user-id AND didn't set
		// presence explicitly — explicit presence is authoritative.
		const userId = this._attr( 'user-id' );
		const explicit = this._attr( 'presence' );
		const wantsListener = !! userId && ! explicit;

		if ( wantsListener && ! this._presenceHandler ) {
			this._presenceHandler = ( e: Event ) => {
				const detail = ( e as CustomEvent< {
					userId?: number;
					newStatus?: string;
				} > ).detail;
				if ( ! detail ) {
					return;
				}
				if ( String( detail.userId ) !== String( userId ) ) {
					return;
				}
				if (
					detail.newStatus &&
					VALID_PRESENCE.has( detail.newStatus )
				) {
					this.setAttribute( 'presence', detail.newStatus );
				}
			};
			document.addEventListener(
				'desktop-mode-presence-changed',
				this._presenceHandler,
			);
		} else if ( ! wantsListener && this._presenceHandler ) {
			document.removeEventListener(
				'desktop-mode-presence-changed',
				this._presenceHandler,
			);
			this._presenceHandler = null;
		}
	}
}
defineComponent( 'wpd-avatar', WpdAvatar );
