/** A transient expression, blended over the user's look without changing it. */
import type { RenderFrame } from './render';
import type { MioAppearance } from './types';

export function advanceMioThinking( current: number, thinking: boolean, seconds: number, reducedMotion: boolean ): number {
	const target = thinking ? 1 : 0;
	return reducedMotion ? target : current + ( target - current ) * ( 1 - Math.exp( -Math.max( 0, seconds ) * 7 ) );
}

export function mioThinkingExpression( frame: RenderFrame, appearance: MioAppearance, amount: number, reducedMotion: boolean ) {
	if ( amount <= 0.001 ) {
		return { frame, appearance };
	}
	const phase = frame.elapsed * Math.PI * 2 / 2.8;
	const ponder = reducedMotion ? -0.5 : Math.sin( phase );
	const breath = reducedMotion ? 0 : ( 1 - Math.cos( phase * 2 ) ) / 2;
	const tilt = amount * ponder * 0.14;
	const scale = 1 + amount * breath * 0.055;
	const cos = Math.cos( tilt );
	const sin = Math.sin( tilt );
	// The silhouette and face share the same pose. Physics, anchor and saved look
	// stay untouched, so changing activity never moves MIO's resting position.
	const rim = frame.rim.map( ( point ) => {
		const x = ( point.x - frame.centre.x ) * scale;
		const y = ( point.y - frame.centre.y ) * scale;
		return { ...point,
			x: frame.centre.x + x * cos - y * sin,
			y: frame.centre.y + x * sin + y * cos,
		};
	} );
	// Bound the live pointer before blending: a distant cursor must not drown
	// out the face's thinking expression or make its first frame snap sideways.
	const gaze = frame.gaze ?? frame.centre;
	const dx = gaze.x - frame.centre.x;
	const dy = gaze.y - frame.centre.y;
	const reach = Math.min( 1, frame.radius * 3 / ( Math.hypot( dx, dy ) || 1 ) );
	const from = { x: frame.centre.x + dx * reach, y: frame.centre.y + dy * reach };
	const target = { x: frame.centre.x + frame.radius * ponder * 2.5, y: frame.centre.y - frame.radius * 3 };
	return {
		frame: { ...frame, rim, faceTilt: tilt,
			gaze: { x: from.x + ( target.x - from.x ) * amount, y: from.y + ( target.y - from.y ) * amount },
			blink: Math.max( frame.blink, amount * ( 0.3 + breath * 0.22 ) ),
		},
		appearance: { ...appearance,
			glow: appearance.glow * ( 1 + amount * ( 0.08 + breath * 0.12 ) ),
			hueAngle: appearance.hueAngle + amount * ( 35 + ponder * 50 ),
		},
	};
}
