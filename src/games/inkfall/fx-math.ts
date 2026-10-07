export interface ScatterParticle {

	vx: number;

	vy: number;

	spin: number;
}

export const SCATTER_GRAVITY = 900;

export const SCATTER_LIFETIME = 0.9;

export function scatterVelocities(
	count: number,
	rng: () => number,
): ScatterParticle[] {
	const particles: ScatterParticle[] = [];
	for ( let i = 0; i < count; i++ ) {
		const lateral = count > 1 ? ( i / ( count - 1 ) ) * 2 - 1 : 0;
		particles.push( {
			vx: lateral * ( 80 + rng() * 60 ),
			vy: -( 120 + rng() * 120 ),
			spin: ( rng() * 2 - 1 ) * 6,
		} );
	}
	return particles;
}

export function integrateStep(
	particle: ScatterParticle,
	dt: number,
): { dx: number; dy: number; dRotation: number; vyNext: number } {
	const vyNext = particle.vy + SCATTER_GRAVITY * dt;
	return {
		dx: particle.vx * dt,

		dy: ( ( particle.vy + vyNext ) / 2 ) * dt,
		dRotation: particle.spin * dt,
		vyNext,
	};
}

export function scatterAlpha( age: number ): number {
	return Math.max( 0, 1 - age / SCATTER_LIFETIME );
}
