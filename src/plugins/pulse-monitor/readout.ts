/**
 * Pulse Monitor — the vitals readout and the beeper.
 *
 * The readout is plain DOM over the canvas (crisp text, no Pixi text
 * atlas) and carries measured numbers only: requests per minute, ping
 * (median response time), the share of requests that failed, and
 * front-end visits per minute from the server feed. On the wallpaper
 * it is decorative chrome under the desk, so it ignores the pointer; a
 * `role="img"` with an `aria-label` gives assistive tech the same
 * numbers plus the diagnosed rhythm, without live-region chatter.
 * Where it can be reached — the widget card, the reserved band — it is
 * a button that opens the Issues window.
 */

import { __, sprintf } from '../../i18n';
import { subscribeWorkArea, workAreaInsetsOf } from '../../work-area';
import { rhythmLabel, type HealthReading } from './health';

export interface ReadoutData {
	reading: HealthReading;
	lineColor: string;
	errorColor: string;
}

export interface Readout {
	update( data: ReadoutData ): void;
	setVisible( visible: boolean ): void;
	destroy(): void;
}

const STYLE_ID = 'os-pulse-readout-style';

function ensureStyle(): void {
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = STYLE_ID;
	style.textContent = `
/* Doubled class: out-specifies the wallpaper layer's fill-the-layer child rule. */
.os-pulse-readout.os-pulse-readout {
	position: absolute;
	/* The work-area bands chrome floats over (a bottom dock pill) are
	   added in by createReadout(), so the numbers stay uncovered. */
	inset-block: auto calc( 28px + var( --os-pulse-inset-block-end, 0px ) );
	inset-inline: auto calc( 28px + var( --os-pulse-inset-inline-end, 0px ) );
	width: auto;
	height: auto;
	z-index: 1;
	display: flex;
	gap: 18px;
	align-items: baseline;
	pointer-events: none;
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	font-variant-numeric: tabular-nums;
	line-height: 1;
	color: var(--os-pulse-color);
	opacity: 0.85;
}
.os-pulse-readout__value { font-size: 18px; font-weight: 600; }
.os-pulse-readout__unit { font-size: 9px; opacity: 0.6; margin-inline-start: 3px; letter-spacing: 0.06em; }
/* Response time: a clock before the number says what the ms measure. */
.os-pulse-readout__icon.dashicons {
	inline-size: 1em;
	block-size: 1em;
	font-size: 0.8em;
	line-height: 1;
	vertical-align: -0.05em;
	margin-inline-end: 4px;
	opacity: 0.75;
	color: inherit;
}
.os-pulse-readout--alarm { color: var(--os-pulse-alarm); }
.os-pulse-readout.os-pulse-readout--compact { inset-block: auto 6px; inset-inline: 8px auto; gap: 12px; }
.os-pulse-readout--compact .os-pulse-readout__value { font-size: 13px; }
.os-pulse-readout.os-pulse-readout--band {
	inset-block: auto 6px;
	inset-inline: auto 10px;
	gap: 12px;
	padding: 2px 6px;
	border-radius: 6px;
	/* Spike labels pass behind the numbers in a short band. */
	background: rgb(0 0 0 / 0.6);
	z-index: 2;
}
.os-pulse-readout--band .os-pulse-readout__value { font-size: 13px; }
/* Same doubled class as the base rule, so it wins the pointer back. */
.os-pulse-readout.os-pulse-readout--interactive {
	pointer-events: auto;
	cursor: pointer;
	border-radius: 6px;
}
.os-pulse-readout--interactive:hover { background: rgb(255 255 255 / 0.06); opacity: 1; }
.os-pulse-readout--interactive:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.os-pulse-readout--compact .os-pulse-readout__unit { font-size: 8px; margin-inline-start: 2px; }
`;
	document.head.appendChild( style );
}

/** The four vitals, in display order: key + unit label. */
/** Each number: key, unit, and what it means (the hover title). */
function vitals(): Array< [ string, string, string ] > {
	return [
		[ 'req', __( 'req/min' ), __( 'Requests this browser saw finish in the last minute.' ) ],
		[
			'ping',
			__( 'ms' ),
			__( 'Median response time over the last minute: half the requests were faster, half slower. The whole round trip, server work included.' ),
		],
		[ 'err', __( 'errors' ), __( 'Share of those requests that failed (4xx, 5xx, no response).' ) ],
		[ 'visits', __( 'visits/min' ), __( 'Front-end page views across the whole site, from the server feed.' ) ],
	];
}

/** Where the readout sits, and whether it can be clicked. */
export type ReadoutMode = 'wallpaper' | 'band' | 'widget';

/**
 * @param container  Element to append the readout to.
 * @param mode       `wallpaper`: bottom of the work area, clear of a
 *                   docked pill. `band`: the reserved top band's
 *                   bottom-right corner. `widget`: small type along the
 *                   card's bottom edge.
 * @param onActivate When given, the readout is a button that calls it.
 */
export function createReadout( container: HTMLElement, mode: ReadoutMode = 'wallpaper', onActivate?: () => void ): Readout {
	ensureStyle();
	const compact = mode === 'widget';
	const root = document.createElement( 'div' );
	root.className = [
		'os-pulse-readout',
		compact ? 'os-pulse-readout--compact' : '',
		mode === 'band' ? 'os-pulse-readout--band' : '',
		onActivate ? 'os-pulse-readout--interactive' : '',
	].filter( Boolean ).join( ' ' );
	root.setAttribute( 'role', onActivate ? 'button' : 'img' );
	if ( onActivate ) {
		root.tabIndex = 0;
		root.addEventListener( 'click', onActivate );
		root.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			if ( e.key === 'Enter' || e.key === ' ' ) {
				e.preventDefault();
				onActivate();
			}
		} );
	}
	const values: Record< string, HTMLElement > = {};
	for ( const [ key, unit, meaning ] of vitals() ) {
		const cell = document.createElement( 'div' );
		cell.title = meaning;
		const value = document.createElement( 'span' );
		value.className = 'os-pulse-readout__value';
		value.textContent = '--';
		if ( key === 'ping' ) {
			const icon = document.createElement( 'span' );
			icon.className = 'os-pulse-readout__icon dashicons dashicons-clock';
			icon.setAttribute( 'aria-hidden', 'true' );
			cell.append( icon );
		}
		const label = document.createElement( 'span' );
		label.className = 'os-pulse-readout__unit';
		label.textContent = unit;
		cell.append( value, label );
		root.appendChild( cell );
		values[ key ] = value;
	}
	container.appendChild( root );

	// The wallpaper fills the whole shell, docks included; keep the
	// numbers inside the work area. The widget card and the band are
	// already where nothing covers them.
	let unsubscribe = (): void => undefined;
	if ( mode === 'wallpaper' ) {
		const place = (): void => {
			const insets = workAreaInsetsOf( container );
			const rtl = getComputedStyle( container ).direction === 'rtl';
			root.style.setProperty( '--os-pulse-inset-block-end', `${ Math.max( 0, insets.bottom ) }px` );
			root.style.setProperty( '--os-pulse-inset-inline-end', `${ Math.max( 0, rtl ? insets.left : insets.right ) }px` );
		};
		place();
		unsubscribe = subscribeWorkArea( place );
	}

	return {
		update( data: ReadoutData ): void {
			const { reading } = data;
			root.style.setProperty( '--os-pulse-color', data.lineColor );
			root.style.setProperty( '--os-pulse-alarm', data.errorColor );
			root.classList.toggle( 'os-pulse-readout--alarm', reading.state === 'critical' || reading.state === 'down' );

			values.req.textContent = String( reading.requestsPerMinute );
			values.ping.textContent = reading.latencyP50 === null ? '--' : String( Math.round( reading.latencyP50 ) );
			values.err.textContent =
				reading.successRate === null ? '--' : `${ Math.round( ( 1 - reading.successRate ) * 100 ) }%`;
			values.visits.textContent = reading.visitsPerMinute === null ? '--' : String( reading.visitsPerMinute );

			const summary = sprintf(
				/* translators: 1: rhythm name, 2: requests per minute, 3: health score out of 100. */
				__( 'Site pulse: %1$s, %2$d requests per minute, health %3$d of 100' ),
				rhythmLabel( reading.state ),
				reading.requestsPerMinute,
				reading.score,
			);
			root.setAttribute(
				'aria-label',
				onActivate
					? /* translators: %s: the site pulse summary. */ sprintf( __( '%s. Show issues' ), summary )
					: summary,
			);
		},
		setVisible( visible: boolean ): void {
			root.hidden = ! visible;
		},
		destroy(): void {
			unsubscribe();
			root.remove();
		},
	};
}

/**
 * Monitor beeps over Web Audio. Nothing is created while sound is off:
 * an `AudioContext` holds the output device open for as long as it
 * lives, so the context only exists between "sound on" and "sound
 * off". Browsers start one suspended until a user gesture (autoplay
 * policy), so with sound on the first click or key press resumes it;
 * until then beeps are silently skipped.
 */
export class Beeper {
	private ctx: AudioContext | null = null;
	private enabled = false;
	private readonly unlock = (): void => {
		if ( ! this.enabled ) {
			return;
		}
		if ( ! this.ctx ) {
			const Ctor =
				window.AudioContext ??
				( window as unknown as { webkitAudioContext?: typeof AudioContext } ).webkitAudioContext;
			if ( Ctor ) {
				this.ctx = new Ctor();
			}
		}
		void this.ctx?.resume();
	};

	/** Turn sound on (listen for the unlocking gesture) or off (release the device). */
	setEnabled( on: boolean ): void {
		if ( on === this.enabled ) {
			return;
		}
		this.enabled = on;
		if ( on ) {
			document.addEventListener( 'pointerdown', this.unlock, { capture: true, passive: true } );
			document.addEventListener( 'keydown', this.unlock, { capture: true, passive: true } );
			return;
		}
		document.removeEventListener( 'pointerdown', this.unlock, { capture: true } );
		document.removeEventListener( 'keydown', this.unlock, { capture: true } );
		void this.ctx?.close();
		this.ctx = null;
	}

	beep( frequency: number, ms: number, gain = 0.05 ): void {
		const ctx = this.ctx;
		if ( ! ctx || ctx.state !== 'running' ) {
			return;
		}
		const osc = ctx.createOscillator();
		const amp = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.value = frequency;
		const t = ctx.currentTime;
		amp.gain.setValueAtTime( 0, t );
		amp.gain.linearRampToValueAtTime( gain, t + 0.005 );
		amp.gain.exponentialRampToValueAtTime( 0.0001, t + ms / 1000 );
		osc.connect( amp ).connect( ctx.destination );
		osc.start( t );
		osc.stop( t + ms / 1000 + 0.02 );
	}

	destroy(): void {
		this.setEnabled( false );
	}
}
