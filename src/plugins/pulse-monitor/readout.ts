/**
 * Pulse Monitor — the vitals readout and the beeper.
 *
 * The readout is plain DOM over the canvas (crisp text, no Pixi text
 * atlas) and carries measured numbers only: requests per minute, ping
 * (median response time), the share of requests that failed, and
 * front-end visits per minute from the server feed. It is decorative
 * chrome on the wallpaper, so it ignores the pointer; a `role="img"`
 * with an `aria-label` gives assistive tech the same numbers plus the
 * diagnosed rhythm, without live-region chatter.
 */

import { __, sprintf } from '../../i18n';
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
	inset-block: auto 28px;
	inset-inline: auto 28px;
	width: auto;
	height: auto;
	z-index: 1;
	display: flex;
	gap: 26px;
	align-items: baseline;
	pointer-events: none;
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	font-variant-numeric: tabular-nums;
	line-height: 1;
	color: var(--os-pulse-color);
	opacity: 0.85;
}
.os-pulse-readout__value { font-size: 28px; font-weight: 600; }
.os-pulse-readout__unit { font-size: 10px; opacity: 0.6; margin-inline-start: 4px; letter-spacing: 0.06em; }
.os-pulse-readout--alarm { color: var(--os-pulse-alarm); }
.os-pulse-readout.os-pulse-readout--compact { inset-block: auto 6px; inset-inline: 8px auto; gap: 12px; }
.os-pulse-readout--compact .os-pulse-readout__value { font-size: 13px; }
.os-pulse-readout--compact .os-pulse-readout__unit { font-size: 8px; margin-inline-start: 2px; }
`;
	document.head.appendChild( style );
}

/** The four vitals, in display order: key + unit label. */
function vitals(): Array< [ string, string ] > {
	return [
		[ 'req', __( 'req/min' ) ],
		[ 'ping', __( 'ms' ) ],
		[ 'err', __( 'errors' ) ],
		[ 'visits', __( 'visits/min' ) ],
	];
}

/**
 * @param container Element to append the readout to.
 * @param compact   Small type along the bottom edge — the widget card.
 */
export function createReadout( container: HTMLElement, compact = false ): Readout {
	ensureStyle();
	const root = document.createElement( 'div' );
	root.className = compact ? 'os-pulse-readout os-pulse-readout--compact' : 'os-pulse-readout';
	root.setAttribute( 'role', 'img' );
	const values: Record< string, HTMLElement > = {};
	for ( const [ key, unit ] of vitals() ) {
		const cell = document.createElement( 'div' );
		const value = document.createElement( 'span' );
		value.className = 'os-pulse-readout__value';
		value.textContent = '--';
		const label = document.createElement( 'span' );
		label.className = 'os-pulse-readout__unit';
		label.textContent = unit;
		cell.append( value, label );
		root.appendChild( cell );
		values[ key ] = value;
	}
	container.appendChild( root );

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

			root.setAttribute(
				'aria-label',
				sprintf(
					/* translators: 1: rhythm name, 2: requests per minute, 3: health score out of 100. */
					__( 'Site pulse: %1$s, %2$d requests per minute, health %3$d of 100' ),
					rhythmLabel( reading.state ),
					reading.requestsPerMinute,
					reading.score,
				),
			);
		},
		setVisible( visible: boolean ): void {
			root.hidden = ! visible;
		},
		destroy(): void {
			root.remove();
		},
	};
}

/**
 * Monitor beeps over Web Audio. The context is only created after a
 * user gesture (autoplay policy); until then beeps are silently
 * skipped.
 */
export class Beeper {
	private ctx: AudioContext | null = null;
	private readonly unlock = (): void => {
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

	constructor() {
		document.addEventListener( 'pointerdown', this.unlock, { capture: true, passive: true } );
		document.addEventListener( 'keydown', this.unlock, { capture: true, passive: true } );
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
		document.removeEventListener( 'pointerdown', this.unlock, { capture: true } );
		document.removeEventListener( 'keydown', this.unlock, { capture: true } );
		void this.ctx?.close();
		this.ctx = null;
	}
}
