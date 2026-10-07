import { Component, defineComponent, html } from '../../core';
import { hashTitleToHue } from '../../util/hash-hue';
import { avatarStyles } from './os-avatar.styles';

const SIZE_MAP: Record< string, number > = {
	xs: 20,
	sm: 24,
	md: 40,
	lg: 64,
	xl: 96,
};

const VALID_PRESENCE = new Set( [ 'online', 'inactive', 'offline' ] );

export type OsAvatarPresence = 'online' | 'inactive' | 'offline';

export class OsAvatar extends Component {
	static props = [ 'src', 'alt', 'name', 'size', 'presence', 'userId', 'clickable' ] as const;
	static styles = [ avatarStyles ];

	static help = {
		title: 'Avatar',
		summary:
			'Image-or-initials user tile with an optional presence dot. Falls back to a deterministic-hue letter tile when src is empty. Set user-id to auto-subscribe the dot to os-presence-changed.',
		status: 'stable',
		props: [
			{ name: 'src', type: 'string', description: 'Image URL. Falls back to initials when empty or load fails.' },
			{ name: 'alt', type: 'string', description: 'Alt text for the image. Defaults to `name` when omitted.' },
			{ name: 'name', type: 'string', description: 'Used for initials + hue fallback when no src.' },
			{
				name: 'size',
				type: 'number | "xs" | "sm" | "md" | "lg" | "xl"',
				description: 'Pixel size or named preset. Default 32 (sm-ish). Sets --os-ui-avatar-size.',
			},
			{
				name: 'presence',
				type: '"online" | "inactive" | "offline"',
				description: 'Presence dot color. Omit for no dot.',
			},
			{
				name: 'user-id',
				type: 'number',
				description: 'When set AND presence is unset, auto-subscribes to os-presence-changed and updates the dot.',
			},
			{
				name: 'clickable',
				type: 'boolean attribute',
				description: 'Renders the tile as a focusable button that emits os-avatar-click. Omit for a decorative tile that lets clicks pass through to the surrounding row.',
			},
		],
		events: [
			{
				name: 'os-avatar-click',
				description: 'Fires on click when the `clickable` attribute is set. Detail carries userId when set.',
				detail: '{ userId: number | null }',
			},
		],
		cssProps: [
			{ name: '--os-ui-avatar-size', description: 'Tile size in any CSS length. Set automatically by the size attribute.' },
			{ name: '--os-ui-avatar-dot-ring', description: 'Background color used as the dot ring (matches surrounding panel by default).' },
		],
		example: html`
			<os-avatar name="Daniel" size="40" presence="online"></os-avatar>
		`,
	} as const;

	private _presenceHandler: ( ( e: Event ) => void ) | null = null;
	private _imgFailed = false;
	private _onPointerMove: ( ( e: PointerEvent ) => void ) | null = null;
	private _onPointerEnter: ( ( e: PointerEvent ) => void ) | null = null;
	private _onPointerLeave: ( ( e: PointerEvent ) => void ) | null = null;

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
				'os-presence-changed',
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

		const clickable = this._attr( 'clickable' ) !== null;

		this.style.setProperty( '--os-ui-avatar-size', `${ size }px` );

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
					class=${ `os-avatar__dot os-avatar__dot--${ presence }` }
					aria-label=${ this._presenceLabel( presence ) }
				></span>`
			: html``;

		if ( clickable ) {
			return html`
				<button
					type="button"
					class="os-avatar__tile"
					aria-label=${ alt || 'User' }
					style=${ initialsBg ? `background:${ initialsBg };` : '' }
					@click=${ ( e: MouseEvent ) => this._onClick( e ) }
				>${ inner }</button>
				${ dot }
			`;
		}

		return html`
			<div
				class="os-avatar__tile"
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

		return Array.from( trimmed )[ 0 ]?.toUpperCase() ?? '?';
	}

	private _initialsBg( name: string ): string {
		const hue = hashTitleToHue( name );
		return `linear-gradient(135deg, hsl(${ hue } 62% 55%), hsl(${
			( hue + 24 ) % 360
		} 58% 42%))`;
	}

	private _presenceForRender(): OsAvatarPresence | null {
		const raw = this._attr( 'presence' );
		if ( raw && VALID_PRESENCE.has( raw ) ) {
			return raw as OsAvatarPresence;
		}
		return null;
	}

	private _presenceLabel( p: OsAvatarPresence ): string {
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
		this.emit( 'os-avatar-click', detail );
	}

	private _attachHoverEffect(): void {
		const reduceMotion =
			typeof window !== 'undefined' &&
			window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		if ( reduceMotion ) {
			return;
		}

		this._onPointerEnter = (): void => {
			this.style.setProperty( '--os-ui-avatar-hover', '1' );
		};
		this._onPointerLeave = (): void => {
			this.style.setProperty( '--os-ui-avatar-hover', '0' );

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

			const nx = ( e.clientX - rect.left ) / rect.width - 0.5;
			const ny = ( e.clientY - rect.top ) / rect.height - 0.5;

			const MAX = 14;
			this._pendingTiltY = `${ ( nx * MAX ).toFixed( 2 ) }deg`;
			this._pendingTiltX = `${ ( -ny * MAX ).toFixed( 2 ) }deg`;

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
		this.style.setProperty( '--os-ui-avatar-tilt-x', this._pendingTiltX );
		this.style.setProperty( '--os-ui-avatar-tilt-y', this._pendingTiltY );
		this.style.setProperty( '--os-ui-avatar-glare-x', this._pendingGlareX );
		this.style.setProperty( '--os-ui-avatar-glare-y', this._pendingGlareY );
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
				'os-presence-changed',
				this._presenceHandler,
			);
		} else if ( ! wantsListener && this._presenceHandler ) {
			document.removeEventListener(
				'os-presence-changed',
				this._presenceHandler,
			);
			this._presenceHandler = null;
		}
	}
}
defineComponent( 'os-avatar', OsAvatar );
