/**
 * Posts app — the Categories mind map's force simulation: repulsion
 * between every pair, a spring to the parent, a weak pull to the
 * origin for roots, a strong outward shove out of the spotlight zone
 * while a node is focused, and a gentle pull toward the radial slot.
 * Pinned nodes (roots, the dragged one) ease straight to their targets.
 *
 * @public
 */

import type { MindNode } from './mindmap-draw';

const REPULSION_K = 5500;
const SPRING_K = 0.05;
const SPRING_LEN = 130;

export interface PhysicsContext {
	dragNode: MindNode | null;
	focusId: number | null;
	nudge: { x: number; y: number; radius: number } | null;
}

export function physicsStep( nodes: Map< number, MindNode >, dt: number, ctx: PhysicsContext ): void {
	const list = Array.from( nodes.values() );
	for ( const a of list ) {
		if ( a.pinned ) {
			a.x += ( a.tx - a.x ) * 0.12;
			a.y += ( a.ty - a.y ) * 0.12;
			a.gfx.x = a.x;
			a.gfx.y = a.y;
			continue;
		}
		let fx = 0;
		let fy = 0;
		for ( const b of list ) {
			if ( a === b ) {
				continue;
			}
			const dx = a.x - b.x;
			const dy = a.y - b.y;
			const d2 = dx * dx + dy * dy + 1;
			const f = REPULSION_K / d2;
			const d = Math.sqrt( d2 );
			fx += ( dx / d ) * f;
			fy += ( dy / d ) * f;
		}
		const parent = nodes.get( a.parent );
		if ( parent ) {
			const dx = parent.x - a.x;
			const dy = parent.y - a.y;
			const d = Math.sqrt( dx * dx + dy * dy ) || 1;
			const stretch = d - SPRING_LEN;
			fx += ( ( dx / d ) * stretch ) * SPRING_K;
			fy += ( ( dy / d ) * stretch ) * SPRING_K;
		} else {
			fx += -a.x * 0.0008;
			fy += -a.y * 0.0008;
		}
		// Spotlight nudge: a strong outward impulse while inside the
		// keep-out zone, nothing outside it.
		if ( ctx.nudge && a.id !== ctx.focusId ) {
			const ndx = a.x - ctx.nudge.x;
			const ndy = a.y - ctx.nudge.y;
			const nd = Math.sqrt( ndx * ndx + ndy * ndy ) || 1;
			const limit = ctx.nudge.radius + a.radius;
			if ( nd < limit ) {
				const pushK = 18;
				fx += ( ndx / nd ) * pushK * ( limit - nd );
				fy += ( ndy / nd ) * pushK * ( limit - nd );
			}
		}
		if ( a !== ctx.dragNode ) {
			// Physics eased over dt, blended with a gentle pull toward
			// the radial slot.
			a.x += fx * dt * 0.001 + ( a.tx - a.x ) * 0.02;
			a.y += fy * dt * 0.001 + ( a.ty - a.y ) * 0.02;
		}
		a.gfx.x = a.x;
		a.gfx.y = a.y;
	}
}

/** Converge while the stage is still hidden, then lock the equilibrium in as the targets. */
export function preSettle( nodes: Map< number, MindNode >, iterations: number ): void {
	const ctx: PhysicsContext = { dragNode: null, focusId: null, nudge: null };
	for ( let i = 0; i < iterations; i++ ) {
		physicsStep( nodes, 16, ctx );
	}
	for ( const n of nodes.values() ) {
		n.tx = n.x;
		n.ty = n.y;
	}
}
