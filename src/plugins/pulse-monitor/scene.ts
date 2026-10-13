/**
 * Pulse Monitor — PixiJS scene.
 *
 * Draws the trace a {@link Rhythm} produces: one value per 2-px
 * column, written by a head that moves at `speed` px/s. Two layouts:
 *
 *   - `sweep`   the head crosses the desk and wraps, erasing a short
 *               gap ahead of itself — the classic bedside monitor.
 *   - `scroll`  the newest sample sits at the right edge and the whole
 *               trace flows left.
 *
 * Older samples fade like phosphor. Failed beats are drawn in the
 * error colour. Faint "echo" traces — delayed, attenuated copies of
 * the main one — fill the rest of the desk, and an optional ECG-paper
 * grid sits behind everything.
 *
 * The scene owns the monitor clock: it advances only while animating,
 * so a hidden tab does not come back to a minute of queued beats
 * drawn in one frame.
 */

import type { PixiApp, PixiGraphics, PixiNamespace, PixiStrokeStyle } from './pixi-types';
import type { Rhythm } from './rhythm';
import { hexToNumber, type PulseSettings } from './settings';

export interface PulseSceneOptions {
	container: HTMLElement;
	pixi: PixiNamespace;
	settings: PulseSettings;
	prefersReducedMotion: boolean;
	rhythm: Rhythm;
	/**
	 * Which surface the trace fills:
	 *
	 *   - `wallpaper`  the whole desk.
	 *   - `widget`     a small card — taller beats, a slower sweep so a
	 *                  label stays readable, at most three echoes.
	 *   - `preview`    an OS Settings swatch — no labels, no glow
	 *                  filter, no head halo.
	 */
	variant?: 'wallpaper' | 'widget' | 'preview';
}

export interface PulseScene {
	/** Current monitor time, ms. Signals schedule delayed beats against it. */
	now(): number;
	applySettings( settings: PulseSettings ): void;
	/**
	 * Print `text` above the beat that starts at the current column
	 * (call from the rhythm's `onBeat`, which fires inside the scene's
	 * own step, so "current" is exact). The label anchors to the
	 * complex's peak and travels and fades with the trace.
	 */
	labelBeat( text: string, error: boolean, durationMs: number ): void;
	setAnimating( animating: boolean ): void;
	destroy(): void;
}

/** Column width in CSS px. */
const STEP = 2;
/** Blank gap ahead of the sweep head, CSS px. */
const SWEEP_GAP = 28;
/** Phosphor fade steps. */
const BUCKETS = 6;
/** Per-variant scale: beat height (share of the surface), sweep speed, echo cap. */
const VARIANTS = {
	wallpaper: { amp: 0.17, speed: 1, echoes: Infinity },
	widget: { amp: 0.3, speed: 0.55, echoes: 3 },
	preview: { amp: 0.17, speed: 1, echoes: 3 },
} as const;

/** Echo traces sample every Nth column — they are faint; detail is wasted. */
const ECHO_STRIDE = 3;
/** Same-text labels closer than this (CSS px) merge into "text ×N". */
const LABEL_MERGE_PX = 70;
/** Labels closer than this (CSS px) stack upwards instead of overlapping. */
const LABEL_STACK_PX = 90;
/** Live labels cap — a burst merges or drops rather than piling up DOM. */
const LABEL_MAX = 40;

interface SpikeLabel {
	el: HTMLElement;
	text: string;
	count: number;
	error: boolean;
	/** Column of the complex's peak so far. */
	col: number;
	/** Signal value at that peak. */
	peak: number;
	/** Columns still to scan for the peak. */
	scan: number;
	/** Value of `written` when the label was created. */
	born: number;
	/** Stack row: 0 sits on the peak, 1+ above earlier neighbours. */
	row: number;
}

const LABEL_STYLE_ID = 'os-pulse-labels-style';

function ensureLabelStyle(): void {
	if ( document.getElementById( LABEL_STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = LABEL_STYLE_ID;
	style.textContent = `
.os-pulse-labels { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.os-pulse-label {
	position: absolute;
	inset-block-start: 0;
	inset-inline-start: 0;
	transform: translate( -50%, -100% );
	white-space: nowrap;
	font: 600 10px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	will-change: transform, opacity;
}
.os-pulse-label--below { transform: translate( -50%, 0 ); }
.os-pulse-labels--widget .os-pulse-label { font-size: 9px; letter-spacing: 0.04em; }
`;
	document.head.appendChild( style );
}

export async function mountPulseScene( opts: PulseSceneOptions ): Promise< PulseScene > {
	const { container, pixi, rhythm } = opts;
	let settings = opts.settings;
	const variant = opts.variant ?? 'wallpaper';
	const scale = VARIANTS[ variant ];
	const preview = variant === 'preview';
	/** Effective sweep speed, px/s. */
	const speed = (): number => settings.speed * scale.speed;

	const priorBackground = container.style.background;
	container.style.background = settings.background;

	const app: PixiApp = new pixi.Application();
	try {
		await app.init( {
			resizeTo: container,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,
			resolution: Math.min( window.devicePixelRatio || 1, 2 ),
		} );
	} catch ( err ) {
		container.style.background = priorBackground;
		throw err;
	}

	container.appendChild( app.canvas );
	app.canvas.style.position = 'absolute';
	app.canvas.style.inset = '0';
	app.canvas.style.width = '100%';
	app.canvas.style.height = '100%';
	app.canvas.style.pointerEvents = 'none';

	const grid: PixiGraphics = new pixi.Graphics();
	const echoes: PixiGraphics = new pixi.Graphics();
	const glow: PixiGraphics = new pixi.Graphics();
	const trace: PixiGraphics = new pixi.Graphics();
	const head: PixiGraphics = new pixi.Graphics();
	app.stage.addChild( grid, echoes, glow, trace, head );

	ensureLabelStyle();
	const labelLayer = document.createElement( 'div' );
	labelLayer.className = `os-pulse-labels os-pulse-labels--${ variant }`;
	container.appendChild( labelLayer );
	let labels: SpikeLabel[] = [];
	/** Columns written since mount — the label clock. */
	let written = 0;

	const blur = pixi.BlurFilter && ! preview ? new pixi.BlurFilter( { strength: 8, quality: 2 } ) : null;

	let width = 0;
	let height = 0;
	let cols = 0;
	let values = new Float32Array( 0 );
	let errors = new Uint8Array( 0 );
	/** Next column to write. */
	let cursor = 0;
	/** Sub-column px carried between frames. */
	let carry = 0;
	let clock = 0;
	let animating = false;
	let destroyed = false;

	const lineColor = (): number => hexToNumber( settings.lineColor );
	const errorColor = (): number => hexToNumber( settings.errorColor );

	function drawGrid(): void {
		grid.clear();
		if ( ! settings.grid ) {
			return;
		}
		const minor = 20;
		const color = lineColor();
		for ( let i = 0, x = 0; x <= width; i++, x += minor ) {
			grid.moveTo( x, 0 ).lineTo( x, height ).stroke( { color, width: 1, alpha: i % 5 === 0 ? 0.1 : 0.04 } );
		}
		for ( let i = 0, y = 0; y <= height; i++, y += minor ) {
			grid.moveTo( 0, y ).lineTo( width, y ).stroke( { color, width: 1, alpha: i % 5 === 0 ? 0.1 : 0.04 } );
		}
	}

	function allocate(): void {
		width = app.screen.width;
		height = app.screen.height;
		cols = Math.max( 2, Math.ceil( width / STEP ) + 1 );
		values = new Float32Array( cols ).fill( Number.NaN );
		errors = new Uint8Array( cols );
		cursor = 0;
		carry = 0;
		clearLabels();
		drawGrid();
	}

	function clearLabels(): void {
		for ( const label of labels ) {
			label.el.remove();
		}
		labels = [];
	}

	function labelBeat( text: string, error: boolean, durationMs: number ): void {
		if ( ! settings.labels || preview ) {
			return;
		}
		const last = labels[ labels.length - 1 ];
		const gapPx = last ? ( written - last.born ) * STEP : Infinity;
		if ( last && last.text === text && last.error === error && gapPx < LABEL_MERGE_PX ) {
			last.count++;
			last.el.textContent = `${ text } ×${ last.count }`;
			return;
		}
		if ( labels.length >= LABEL_MAX ) {
			labels.shift()?.el.remove();
		}
		const el = document.createElement( 'span' );
		el.className = 'os-pulse-label';
		el.textContent = text;
		labelLayer.appendChild( el );
		labels.push( {
			el,
			text,
			count: 1,
			error,
			col: cursor,
			peak: 0,
			scan: Math.max( 1, Math.ceil( ( ( durationMs / 1000 ) * speed() ) / STEP ) ),
			born: written,
			row: last && gapPx < LABEL_STACK_PX ? Math.min( 2, last.row + 1 ) : 0,
		} );
	}

	/** Place every label on its peak; retire the ones the trace has erased. */
	function drawLabels(): void {
		if ( ! labels.length ) {
			return;
		}
		const by = baseY();
		const amp = ampPx();
		const gap = settings.style === 'sweep' ? Math.ceil( SWEEP_GAP / STEP ) : 0;
		const normal = settings.lineColor;
		const failed = settings.errorColor;
		const keep: SpikeLabel[] = [];
		for ( const label of labels ) {
			const age = written - label.born;
			if ( ! settings.labels || age >= cols - gap - 2 ) {
				label.el.remove();
				continue;
			}
			keep.push( label );
			const j = ( label.col - cursor + cols ) % cols;
			const x = xFor( label.col, j );
			const below = label.peak < -0.05;
			const peakY = Math.min( height - 6, Math.max( 6, by - label.peak * amp ) );
			const y = below ? peakY + 8 + label.row * 13 : peakY - 8 - label.row * 13;
			label.el.classList.toggle( 'os-pulse-label--below', below );
			label.el.style.insetInlineStart = `${ x }px`;
			label.el.style.insetBlockStart = `${ y }px`;
			label.el.style.color = label.error ? failed : normal;
			label.el.style.opacity = String( 0.25 + 0.75 * Math.pow( j / cols, 1.4 ) );
		}
		labels = keep;
	}

	const baseY = (): number => ( height * settings.baseline ) / 100;
	const ampPx = (): number => height * scale.amp * settings.intensity;

	/** Column index → x, given its position `j` in oldest-first order. */
	function xFor( idx: number, j: number ): number {
		return settings.style === 'sweep' ? idx * STEP : width - ( cols - 1 - j ) * STEP;
	}

	function write( value: number, error: boolean ): void {
		for ( const label of labels ) {
			if ( label.scan > 0 ) {
				label.scan--;
				if ( Math.abs( value ) > Math.abs( label.peak ) ) {
					label.peak = value;
					label.col = cursor;
				}
			}
		}
		written++;
		values[ cursor ] = value;
		errors[ cursor ] = error ? 1 : 0;
		cursor = ( cursor + 1 ) % cols;
		if ( settings.style === 'sweep' ) {
			const gap = Math.ceil( SWEEP_GAP / STEP );
			for ( let k = 0; k < gap; k++ ) {
				values[ ( cursor + k ) % cols ] = Number.NaN;
			}
		}
	}

	/**
	 * Stroke the buffer oldest → newest as runs of constant style:
	 * a run breaks where the fade bucket or the error flag changes,
	 * and on blank (NaN) columns.
	 */
	function strokeTrace( g: PixiGraphics, widthPx: number, alphaScale: number ): void {
		const by = baseY();
		const amp = ampPx();
		const min = 6;
		const max = height - 6;
		const normal = lineColor();
		const failed = errorColor();
		let open = false;
		let runKey = -1;
		let style: PixiStrokeStyle = { color: normal, width: widthPx };
		const styleFor = ( bucket: number, err: number ): PixiStrokeStyle => ( {
			color: err ? failed : normal,
			width: widthPx,
			alpha: alphaScale * ( 0.32 + 0.68 * Math.pow( ( bucket + 1 ) / BUCKETS, 1.4 ) ),
			cap: 'round',
			join: 'round',
		} );
		for ( let j = 0; j < cols; j++ ) {
			const idx = ( cursor + j ) % cols;
			const v = values[ idx ];
			if ( Number.isNaN( v ) ) {
				if ( open ) {
					g.stroke( style );
					open = false;
				}
				continue;
			}
			// The sweep buffer wraps at the right edge: lift the pen
			// rather than draw a line back across the desk.
			if ( open && idx === 0 && settings.style === 'sweep' ) {
				g.stroke( style );
				open = false;
			}
			const x = xFor( idx, j );
			const y = Math.min( max, Math.max( min, by - v * amp ) );
			const bucket = Math.min( BUCKETS - 1, Math.floor( ( j / cols ) * BUCKETS ) );
			const key = bucket * 2 + errors[ idx ];
			if ( ! open ) {
				g.moveTo( x, y );
				open = true;
				runKey = key;
				style = styleFor( bucket, errors[ idx ] );
			} else if ( key !== runKey ) {
				g.lineTo( x, y );
				g.stroke( style );
				g.moveTo( x, y );
				runKey = key;
				style = styleFor( bucket, errors[ idx ] );
			} else {
				g.lineTo( x, y );
			}
		}
		if ( open ) {
			g.stroke( style );
		}
	}

	function drawEchoes(): void {
		echoes.clear();
		const count = Math.min( settings.echoes, scale.echoes );
		if ( ! count ) {
			return;
		}
		const by = baseY();
		const amp = ampPx();
		const spacing = height / ( count + 1 );
		for ( let e = 1; e <= count; e++ ) {
			const ey = e * spacing;
			const dy = Math.abs( ey - by );
			if ( dy < 14 ) {
				continue;
			}
			// Echoes near the trace carry more of its shape.
			const echoScale = 0.22 * Math.exp( -dy / ( height * 0.3 ) );
			const lag = e * 11;
			let open = false;
			for ( let j = 0; j < cols; j += ECHO_STRIDE ) {
				const idx = ( cursor + j ) % cols;
				const v = values[ ( idx - lag + cols * 2 ) % cols ];
				if ( Number.isNaN( v ) || ( idx < ECHO_STRIDE && settings.style === 'sweep' ) ) {
					open = false;
					continue;
				}
				const x = xFor( idx, j );
				const y = ey - v * amp * echoScale;
				if ( open ) {
					echoes.lineTo( x, y );
				} else {
					echoes.moveTo( x, y );
					open = true;
				}
			}
			echoes.stroke( { color: 0xffffff, width: 1, alpha: 0.07 } );
		}
	}

	function drawHead(): void {
		head.clear();
		const idx = ( cursor - 1 + cols ) % cols;
		const v = values[ idx ];
		if ( Number.isNaN( v ) ) {
			return;
		}
		const x = xFor( idx, cols - 1 );
		const y = Math.min( height - 6, Math.max( 6, baseY() - v * ampPx() ) );
		const color = errors[ idx ] ? errorColor() : lineColor();
		if ( ! preview ) {
			head.circle( x, y, settings.lineWidth * 6 ).fill( { color, alpha: 0.06 + settings.glow * 0.12 } );
		}
		head.circle( x, y, settings.lineWidth * 1.4 ).fill( { color, alpha: 1 } );
	}

	function redraw(): void {
		trace.clear();
		glow.clear();
		strokeTrace( trace, settings.lineWidth, 1 );
		if ( settings.glow > 0 ) {
			strokeTrace( glow, settings.lineWidth * 4, settings.glow * 0.45 );
		}
		glow.filters = blur && settings.glow > 0 ? [ blur ] : null;
		drawEchoes();
		drawHead();
		drawLabels();
	}

	/** Advance the monitor by `dt` ms, writing the columns the head crossed. */
	function advance( dt: number ): void {
		const t0 = clock;
		clock += dt;
		carry += ( speed() * dt ) / 1000;
		const n = Math.min( cols, Math.floor( carry / STEP ) );
		carry -= Math.floor( carry / STEP ) * STEP;
		if ( n === 0 ) {
			rhythm.step( clock );
			return;
		}
		for ( let k = 1; k <= n; k++ ) {
			const t = t0 + ( dt * k ) / n;
			rhythm.step( t );
			const s = rhythm.sample( t );
			write( s.value, s.error );
		}
	}

	const tick = ( ticker: { deltaMS: number } ): void => {
		if ( app.screen.width !== width || app.screen.height !== height ) {
			allocate();
		}
		advance( Math.min( ticker.deltaMS, 100 ) );
		redraw();
	};

	allocate();

	if ( opts.prefersReducedMotion ) {
		// One still frame: a full desk of resting rhythm, no movement.
		const msPerScreen = ( width / speed() ) * 1000;
		const frames = Math.ceil( msPerScreen / 16 );
		for ( let i = 0; i < frames; i++ ) {
			advance( 16 );
		}
		redraw();
		app.ticker.stop();
		app.render();
	} else {
		app.ticker.add( tick );
		animating = true;
	}

	return {
		now: () => clock,
		labelBeat,
		applySettings( next: PulseSettings ): void {
			const restyled = next.style !== settings.style;
			settings = next;
			container.style.background = settings.background;
			if ( restyled ) {
				allocate();
			} else {
				drawGrid();
			}
			if ( opts.prefersReducedMotion ) {
				redraw();
				app.render();
			}
		},
		setAnimating( next: boolean ): void {
			if ( destroyed || opts.prefersReducedMotion || next === animating ) {
				return;
			}
			animating = next;
			if ( next ) {
				app.ticker.start();
			} else {
				app.ticker.stop();
			}
		},
		destroy(): void {
			if ( destroyed ) {
				return;
			}
			destroyed = true;
			app.ticker.remove( tick );
			clearLabels();
			labelLayer.remove();
			app.destroy( { removeView: true }, { children: true } );
			container.style.background = priorBackground;
		},
	};
}
