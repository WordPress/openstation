/**
 * OpenStation — Pinned notes motion.
 *
 * The WAAPI sequences + pendulum physics behind the pushpin feel:
 *
 *   - `playPinInsertion()` — the "thunk": pin falls in from above,
 *     the paper takes a one-frame squash on impact, spring-settles
 *     with a decaying paper shiver, and a ripple ring expands from
 *     the pin anchor.
 *   - `playPinPullOut()` — pin tilts back out and lifts as its
 *     shadow diverges; the paper sags, held by one point.
 *   - `startPendulum()` — while a note is carried by its pin, the
 *     paper swings from the needle tip driven by the drag's
 *     horizontal velocity (under-damped spring, ~one visible swing).
 *   - `playSnapBack()` — cancel: a flyback clone overshoots home,
 *     then a shortened insertion re-seats the pin.
 *   - `playCrumpleIntoBin()` — commit-to-trash: the pin pops out
 *     first, then the paper shrinks and roughens toward the bin.
 *
 * Everything routes through `prefersReducedMotion()` — reduced-motion
 * users get instant state changes / short fades, never transforms.
 * No dependencies; springs are explicit keyframe arrays.
 */

/** House curves (mirrored in assets/css/notes.css). */
const EASE_GLIDE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const EASE_FALL = 'cubic-bezier(0.5, 0, 0.9, 0.4)';
const EASE_OVERSHOOT = 'cubic-bezier(0.2, 0.7, 0.3, 1.15)';

export function prefersReducedMotion(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

function animate(
	el: Element,
	keyframes: Keyframe[],
	options: KeyframeAnimationOptions,
): Promise< void > {
	// jsdom (vitest) has no WAAPI; treat it as "finished instantly".
	if ( typeof el.animate !== 'function' ) {
		return Promise.resolve();
	}
	return el
		.animate( keyframes, options )
		.finished.then( () => undefined )
		.catch( () => undefined );
}

export interface PinInsertionParts {
	/** The pin wrapper (button or ghost pin container). */
	pin: Element;
	/** The paper element that recoils. */
	paper: Element;
	/** Element the ripple ring is appended to (positioned parent). */
	rippleHost: HTMLElement;
	/** Resting pin rotation, deg (per-note jitter). */
	restRotation?: number;
	/** Fall distance in px — 30 for a first pinning, ~12 for a move. */
	fallDistance?: number;
	/** Scale the whole timeline (1 = the ceremonial 540 ms thunk). */
	tempo?: number;
}

/**
 * The thunk. Resolves when the paper has settled.
 */
export async function playPinInsertion( parts: PinInsertionParts ): Promise< void > {
	const rot = parts.restRotation ?? 0;
	if ( prefersReducedMotion() ) {
		// Static substitute: one accent ring, no motion.
		spawnRipple( parts.rippleHost, 400 );
		return;
	}
	const tempo = parts.tempo ?? 1;
	const fall = parts.fallDistance ?? 30;

	// Phase 1 — the fall (gravity easing).
	await animate(
		parts.pin,
		[
			{
				opacity: 0,
				transform: `translate(8px, ${ -fall }px) rotate(${ rot - 16 }deg) scale(1.9)`,
			},
			{ opacity: 1, offset: 0.35 },
			{
				opacity: 1,
				transform: `translate(0, 0) rotate(${ rot }deg) scale(0.92)`,
			},
		],
		{ duration: 170 * tempo, easing: EASE_FALL, fill: 'forwards' },
	);

	// Phase 2 — strike + settle, in parallel on paper and pin.
	spawnRipple( parts.rippleHost, 420 * tempo );
	const paperSettle = animate(
		parts.paper,
		[
			{ transform: 'scale(1) translateY(0) skewX(0)' },
			{
				transform: 'scale(0.982) translateY(2px) skewX(0)',
				offset: 0.08,
			},
			{
				transform: 'scale(1.01) translateY(0) skewX(0.6deg)',
				offset: 0.32,
			},
			{
				transform: 'scale(0.996) translateY(0) skewX(-0.4deg)',
				offset: 0.55,
			},
			{ transform: 'scale(1) translateY(0) skewX(0)' },
		],
		{ duration: 370 * tempo, easing: 'linear' },
	);
	const pinSettle = animate(
		parts.pin,
		[
			{ transform: `rotate(${ rot }deg) scale(0.92)` },
			{ transform: `rotate(${ rot + 1.5 }deg) scale(1.07)`, offset: 0.25 },
			{ transform: `rotate(${ rot - 1 }deg) scale(0.98)`, offset: 0.5 },
			{ transform: `rotate(${ rot }deg) scale(1)` },
		],
		{ duration: 370 * tempo, easing: EASE_GLIDE, fill: 'forwards' },
	);
	await Promise.all( [ paperSettle, pinSettle ] );
}

/**
 * Pull the pin out (played on the REAL note just before the ghost
 * takes over; the note then drops to its "imprint" look via CSS).
 */
export function playPinPullOut( pin: Element, restRotation = 0 ): Promise< void > {
	if ( prefersReducedMotion() ) {
		return Promise.resolve();
	}
	return animate(
		pin,
		[
			{ transform: `translate(0, 0) rotate(${ restRotation }deg) scale(1)` },
			{
				transform: `translate(4px, -12px) rotate(${ restRotation - 18 }deg) scale(1.12)`,
			},
		],
		{ duration: 200, easing: EASE_GLIDE, fill: 'forwards' },
	);
}

/** One-shot expanding "thunk" ripple at the pin anchor. */
function spawnRipple( host: HTMLElement, duration: number ): void {
	const ripple = document.createElement( 'span' );
	ripple.className = 'os-pinned-note__ripple';
	ripple.setAttribute( 'aria-hidden', 'true' );
	host.appendChild( ripple );
	void animate(
		ripple,
		[
			{ boxShadow: '0 0 0 0 rgba(0, 0, 0, 0.28)', opacity: 0.35 },
			{ boxShadow: '0 0 0 26px rgba(0, 0, 0, 0)', opacity: 0 },
		],
		{ duration, easing: 'ease-out' },
	).then( () => ripple.remove() );
	// Belt-and-braces removal for engines without WAAPI.
	window.setTimeout( () => ripple.remove(), duration + 100 );
}

export interface PendulumHandle {
	/** Feed the pointer's clientX each move. */
	onPointerMove( clientX: number ): void;
	/** Bias the swing (deg) — e.g. lean toward the recycle bin. */
	setBias( deg: number ): void;
	stop(): void;
}

/**
 * Under-damped pendulum on the ghost's swing wrapper. The wrapper's
 * `transform-origin` must sit at the pin tip (CSS). Spring constants
 * tuned for ~one visible swing: K = 120 /s², C = 14 /s.
 */
export function startPendulum( swingEl: HTMLElement ): PendulumHandle {
	if ( prefersReducedMotion() ) {
		return {
			onPointerMove: () => undefined,
			setBias: () => undefined,
			stop: () => undefined,
		};
	}

	const K = 120;
	const C = 14;
	let angle = 0;
	let velocity = 0;
	let target = 0;
	let bias = 0;
	let lastX: number | null = null;
	let lastMoveTime = 0;
	let emaVx = 0;
	let raf = 0;
	let lastFrame = 0;
	let running = true;

	const frame = ( now: number ): void => {
		if ( ! running ) {
			return;
		}
		const dt = Math.min( 0.05, lastFrame ? ( now - lastFrame ) / 1000 : 0.016 );
		lastFrame = now;
		// Velocity decays toward zero when the pointer stops moving.
		if ( now - lastMoveTime > 80 ) {
			emaVx *= 0.85;
		}
		target = Math.max( -14, Math.min( 14, -emaVx * 0.055 ) ) + bias;
		velocity += ( -K * ( angle - target ) - C * velocity ) * dt;
		angle += velocity * dt;
		swingEl.style.transform = `rotate(${ angle.toFixed( 2 ) }deg)`;
		raf = window.requestAnimationFrame( frame );
	};
	raf = window.requestAnimationFrame( frame );

	return {
		onPointerMove( clientX: number ): void {
			const now = performance.now();
			if ( lastX !== null && now > lastMoveTime ) {
				const instVx = ( ( clientX - lastX ) / ( now - lastMoveTime ) ) * 16.7;
				emaVx = emaVx * 0.7 + instVx * 0.3;
			}
			lastX = clientX;
			lastMoveTime = now;
		},
		setBias( deg: number ): void {
			bias = deg;
		},
		stop(): void {
			running = false;
			window.cancelAnimationFrame( raf );
			swingEl.style.transform = '';
		},
	};
}

export interface SnapBackParts {
	/** Visual clone to fly home (already positioned at the release point, fixed). */
	flyback: HTMLElement;
	/** Inner swing wrapper of the clone (elastic-yank rotation). */
	swing: HTMLElement | null;
	/** Viewport-space destination of the clone's top-left. */
	homeX: number;
	homeY: number;
}

/**
 * Fly a cancelled drag home with one overshoot. Caller removes the
 * clone and restores the real note when the promise resolves.
 */
export async function playSnapBack( parts: SnapBackParts ): Promise< void > {
	if ( prefersReducedMotion() ) {
		await animate( parts.flyback, [ { opacity: 1 }, { opacity: 0 } ], {
			duration: 120,
			easing: 'linear',
			fill: 'forwards',
		} );
		return;
	}
	const yank = parts.swing
		? animate(
			parts.swing,
			[
				{ transform: 'rotate(0deg)' },
				{ transform: 'rotate(9deg)', offset: 0.35 },
				{ transform: 'rotate(-4deg)', offset: 0.7 },
				{ transform: 'rotate(0deg)' },
			],
			{ duration: 330, easing: 'linear', fill: 'forwards' },
		)
		: Promise.resolve();
	const fly = animate(
		parts.flyback,
		[
			{
				left: `${ parts.flyback.offsetLeft }px`,
				top: `${ parts.flyback.offsetTop }px`,
			},
			{ left: `${ parts.homeX }px`, top: `${ parts.homeY }px` },
		],
		{ duration: 330, easing: EASE_OVERSHOOT, fill: 'forwards' },
	);
	await Promise.all( [ fly, yank ] );
}

export interface CrumpleParts {
	/** Commit-animation clone at the release point (fixed positioning). */
	clone: HTMLElement;
	/** The pin element inside the clone (discarded first). */
	pin: Element | null;
	/** The paper element inside the clone (crumples). */
	paper: HTMLElement;
	/** Viewport-space center of the recycle bin. */
	binX: number;
	binY: number;
}

/**
 * Crumple the paper into the bin. Caller removes the clone when the
 * promise resolves.
 */
export async function playCrumpleIntoBin( parts: CrumpleParts ): Promise< void > {
	if ( prefersReducedMotion() ) {
		await animate( parts.clone, [ { opacity: 1 }, { opacity: 0 } ], {
			duration: 150,
			easing: 'linear',
			fill: 'forwards',
		} );
		return;
	}
	if ( parts.pin ) {
		void animate(
			parts.pin,
			[
				{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
				{ transform: 'translate(2px, -16px) rotate(-30deg)', opacity: 0 },
			],
			{ duration: 200, easing: EASE_GLIDE, fill: 'forwards' },
		);
	}
	const rect = parts.clone.getBoundingClientRect();
	const dx = parts.binX - ( rect.left + rect.width / 2 );
	const dy = parts.binY - ( rect.top + rect.height / 2 );
	const rough1 =
		'polygon(4% 8%, 38% 2%, 68% 7%, 96% 3%, 98% 42%, 92% 71%, 97% 94%, 60% 98%, 30% 93%, 3% 97%, 6% 62%, 2% 34%)';
	const rough2 =
		'polygon(10% 14%, 42% 6%, 64% 12%, 90% 8%, 94% 38%, 86% 66%, 92% 88%, 58% 94%, 34% 86%, 10% 92%, 14% 58%, 8% 36%)';
	await animate(
		parts.paper,
		[
			{
				transform: 'translate(0, 0) scale(0.88) rotate(0deg)',
				borderRadius: '2px',
				opacity: 1,
			},
			{
				transform: `translate(${ dx * 0.3 }px, ${ dy * 0.3 }px) scale(0.6) rotate(12deg)`,
				clipPath: rough1,
				offset: 0.3,
			},
			{
				transform: `translate(${ dx * 0.6 }px, ${ dy * 0.6 }px) scale(0.34) rotate(24deg)`,
				clipPath: rough2,
				offset: 0.6,
				opacity: 1,
			},
			{
				transform: `translate(${ dx }px, ${ dy }px) scale(0.12) rotate(38deg)`,
				borderRadius: '50%',
				clipPath: rough2,
				opacity: 0,
			},
		],
		{ duration: 400, easing: EASE_FALL, delay: 60, fill: 'forwards' },
	);
}

/**
 * FNV-1a over a string, as a positive 31-bit integer. This is the
 * note's jitter SEED: computed once from the note's text at creation
 * time (never re-derived on edits) and persisted server-side, so a
 * note keeps its exact tilt for life.
 */
export function hashNoteSeed( text: string ): number {
	/* eslint-disable no-bitwise -- FNV-1a is defined in terms of XOR
	   and unsigned shifts; a non-bitwise rewrite would obscure the
	   reference algorithm. */
	let hash = 0x811c9dc5;
	for ( let i = 0; i < text.length; i++ ) {
		hash ^= text.charCodeAt( i );
		hash = Math.imul( hash, 0x01000193 ) >>> 0;
	}
	const seed = ( hash >>> 1 ) || 1;
	/* eslint-enable no-bitwise */
	return seed;
}

/**
 * Deterministic per-note jitter so the wall feels hand-placed and
 * never re-shuffles between reloads. Derived from the note's
 * creation-time seed (see `hashNoteSeed`).
 */
export function noteJitter( seed: number ): {
	rotation: number;
	pinOffsetX: number;
	pinRotation: number;
} {
	/* eslint-disable no-bitwise -- decorrelate the three knobs with
	   unsigned shifts of the same seed. */
	let hash = 0x811c9dc5;
	const key = `os-note-${ seed }`;
	for ( let i = 0; i < key.length; i++ ) {
		hash ^= key.charCodeAt( i );
		hash = Math.imul( hash, 0x01000193 ) >>> 0;
	}
	const shifted3 = hash >>> 3;
	const shifted5 = hash >>> 5;
	/* eslint-enable no-bitwise */
	return {
		rotation: ( ( hash % 45 ) - 22 ) / 10, // ±2.2°
		pinOffsetX: ( shifted3 % 21 ) - 10, // ±10 px
		pinRotation: ( shifted5 % 17 ) - 8, // ±8°
	};
}
