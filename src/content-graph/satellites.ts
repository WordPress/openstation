/**
 * Content Graph — satellite layer.
 *
 * On node focus, this module fans the focused post's relationship
 * payload out around it as orbiting satellites. Each satellite is a
 * differently-shaped Pixi `Container` that:
 *
 *   - Carries an `openUrl` target (admin URL for the underlying entity).
 *   - Animates outward from the focused node's centre on entrance.
 *   - Highlights on hover and shows a DOM tooltip with its label + meta.
 *   - On click, opens its admin URL via `wp.desktop.openUrl`.
 *
 * The satellite layer is parented to the same `world` container as the
 * graph itself so it pans + zooms with the rest of the canvas. Each
 * `setFocused()` call clears the prior fan synchronously, so there's
 * no in-flight animation racing the next focus.
 *
 * @public
 * @since 0.8.2
 */

import { __, sprintf } from '../i18n';
import type {
	PixiContainer,
	PixiGraphics,
	PixiNamespace,
	PixiText,
} from './pixi-types';
import type { GraphNode, PostDetail } from './types';

type Kind = 'user' | 'term' | 'comment' | 'media' | 'revision';

const KIND_COLOR: Record< Kind, number > = {
	user: 0x3a6df0,
	term: 0x2ca97a,
	comment: 0xe8893a,
	media: 0xa05ed4,
	revision: 0x6b7785,
};

interface SatelliteRef {
	kind: Kind;
	label: string;
	meta: string;
	url: string;
}

interface SatelliteView {
	ref: SatelliteRef;
	container: PixiContainer;
	gfx: PixiGraphics;
	label: PixiText;
	targetX: number;
	targetY: number;
}

export type SatelliteOpenUrl = ( args: {
	url: string;
	title: string;
	icon: string;
} ) => void;

export class SatelliteLayer {
	private linkLayer: PixiContainer;
	private linkGfx: PixiGraphics;
	private layer: PixiContainer;
	private views: SatelliteView[] = [];
	private focused: GraphNode | null = null;
	private hoverEl: HTMLDivElement;
	private rafId: number | null = null;

	constructor(
		private pixi: PixiNamespace,
		private world: PixiContainer,
		private openUrl: SatelliteOpenUrl,
		private hostEl: HTMLElement,
	) {
		// Link layer sits BELOW the satellite chips so the line tucks
		// under the shape's edge instead of slicing through it.
		this.linkLayer = new pixi.Container();
		this.linkGfx = new pixi.Graphics();
		this.linkLayer.addChild( this.linkGfx );
		this.world.addChild( this.linkLayer );

		this.layer = new pixi.Container();
		this.world.addChild( this.layer );

		this.hoverEl = document.createElement( 'div' );
		this.hoverEl.className = 'desktop-mode-content-graph__tooltip';
		this.hoverEl.hidden = true;
		this.hostEl.appendChild( this.hoverEl );
	}

	clear(): void {
		this.linkGfx.clear();
		this.layer.removeChildren();
		this.views = [];
		this.focused = null;
		this.hideTooltip();
	}

	/**
	 * Re-draw the connector lines from the focused node to every
	 * satellite. The scene calls this on every animation tick so the
	 * lines track the focused node as it moves with the simulation.
	 */
	drawLinks(): void {
		this.linkGfx.clear();
		if ( ! this.focused || this.views.length === 0 ) {
			return;
		}
		const fx = this.focused.x;
		const fy = this.focused.y;
		for ( const v of this.views ) {
			const color = KIND_COLOR[ v.ref.kind ];
			this.linkGfx
				.moveTo( fx, fy )
				.lineTo( v.container.x, v.container.y )
				.stroke( { color, width: 1.4, alpha: 0.55 } );
		}
	}

	setFocused( focused: GraphNode, detail: PostDetail ): void {
		this.clear();
		this.focused = focused;
		const refs = this.flattenDetail( detail );
		if ( refs.length === 0 ) {
			return;
		}

		const baseR = focused.radius;
		// Ring radius scales with count so adjacent satellites are ~24px
		// apart along the arc (an arc of 2πR / N).
		const ringR = Math.max( 80, baseR + 64 + ( refs.length * 24 ) / ( 2 * Math.PI ) );

		const startAngle = -Math.PI / 2; // 12 o'clock
		const slice = ( 2 * Math.PI ) / refs.length;

		refs.forEach( ( ref, i ) => {
			const angle = startAngle + i * slice;
			const tx = focused.x + Math.cos( angle ) * ringR;
			const ty = focused.y + Math.sin( angle ) * ringR;

			const view = this.buildSatellite( ref, focused.x, focused.y );
			view.targetX = tx;
			view.targetY = ty;
			this.views.push( view );
		} );

		this.animateIn();
	}

	destroy(): void {
		if ( this.rafId !== null ) {
			cancelAnimationFrame( this.rafId );
			this.rafId = null;
		}
		this.clear();
		this.layer.destroy( { children: true } );
		this.linkLayer.destroy( { children: true } );
		this.hoverEl.remove();
	}

	/**
	 * Flatten a `PostDetail` into a deterministic list of satellites.
	 * Caps each section so a noisy post doesn't produce 100+ orbits.
	 */
	private flattenDetail( detail: PostDetail ): SatelliteRef[] {
		const out: SatelliteRef[] = [];

		if ( detail.author ) {
			out.push( {
				kind: 'user',
				label: detail.author.name,
				meta: __( 'Author' ),
				url: detail.author.edit_url,
			} );
		}
		for ( const u of detail.contributors.slice( 0, 8 ) ) {
			out.push( {
				kind: 'user',
				label: u.name,
				meta: __( 'Contributor' ),
				url: u.edit_url,
			} );
		}
		for ( const t of detail.categories.slice( 0, 12 ) ) {
			out.push( {
				kind: 'term',
				label: t.name,
				meta: sprintf(
					/* translators: 1: taxonomy label (e.g. Category, Tag). 2: post count for the term. */
					__( '%1$s · %2$d posts' ),
					t.tax_label,
					t.count,
				),
				url: t.edit_url,
			} );
		}
		for ( const c of detail.comments.slice( 0, 8 ) ) {
			out.push( {
				kind: 'comment',
				label: c.author,
				meta: c.excerpt || formatDate( c.date ),
				url: c.edit_url,
			} );
		}
		for ( const m of detail.attached_media.slice( 0, 12 ) ) {
			out.push( {
				kind: 'media',
				label: m.title,
				meta: m.mime,
				url: m.edit_url,
			} );
		}
		for ( const r of detail.revisions.slice( 0, 8 ) ) {
			out.push( {
				kind: 'revision',
				label: r.author?.name ?? __( 'Revision' ),
				meta: formatDate( r.date ),
				url: r.edit_url,
			} );
		}
		return out;
	}

	private buildSatellite(
		ref: SatelliteRef,
		startX: number,
		startY: number,
	): SatelliteView {
		const container = new this.pixi.Container();
		container.x = startX;
		container.y = startY;
		container.alpha = 0;
		container.eventMode = 'static';
		container.cursor = 'pointer';
		// Explicit hit area so satellites are easy to grab regardless of
		// shape geometry. Includes the label slot below the chip so a
		// user clicking the text still triggers the satellite.
		container.hitArea = {
			contains: ( x: number, y: number ) => {
				return x >= -16 && x <= 16 && y >= -14 && y <= 28;
			},
		};

		const gfx = new this.pixi.Graphics();
		this.drawShape( gfx, ref.kind );
		container.addChild( gfx );

		const labelText = truncate( ref.label || '—', 28 );
		const label = new this.pixi.Text( {
			text: labelText,
			style: {
				fill: 0x1a1f2b,
				fontSize: 11,
				fontFamily:
					'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
				fontWeight: '500',
			},
			resolution: 2,
			anchor: { x: 0.5, y: 0 },
		} );
		label.x = 0;
		label.y = 12;
		label.alpha = 0.9;
		container.addChild( label );

		container.on( 'pointerover', ( evt: unknown ) => {
			gfx.alpha = 1;
			const e = evt as { global?: { x: number; y: number } };
			this.showTooltip( ref, e.global );
		} );
		container.on( 'pointermove', ( evt: unknown ) => {
			const e = evt as { global?: { x: number; y: number } };
			this.showTooltip( ref, e.global );
		} );
		container.on( 'pointerout', () => {
			gfx.alpha = 0.95;
			this.hideTooltip();
		} );
		container.on( 'pointertap', ( evt: unknown ) => {
			const e = evt as { stopPropagation?: () => void };
			e.stopPropagation?.();
			if ( ! ref.url ) {
				return;
			}
			this.openUrl( {
				url: ref.url,
				title: ref.label || ref.meta,
				icon: iconForKind( ref.kind ),
			} );
		} );

		this.layer.addChild( container );

		return {
			ref,
			container,
			gfx,
			label,
			targetX: startX,
			targetY: startY,
		};
	}

	private drawShape( gfx: PixiGraphics, kind: Kind ): void {
		const fill = KIND_COLOR[ kind ];
		const stroke = 0xffffff;
		gfx.alpha = 0.95;
		switch ( kind ) {
			case 'user':
				gfx.circle( 0, 0, 8 ).fill( { color: fill, alpha: 0.95 } )
					.stroke( { color: stroke, width: 1.5, alpha: 1 } );
				break;
			case 'term':
				gfx.roundRect( -10, -7, 20, 14, 4 )
					.fill( { color: fill, alpha: 0.95 } )
					.stroke( { color: stroke, width: 1.5, alpha: 1 } );
				break;
			case 'comment': {
				// Speech-bubble: roundRect with a small triangular tail.
				gfx.roundRect( -11, -7, 22, 12, 5 )
					.fill( { color: fill, alpha: 0.95 } )
					.stroke( { color: stroke, width: 1.2, alpha: 1 } );
				gfx.moveTo( -3, 5 ).lineTo( 0, 9 ).lineTo( 3, 5 )
					.lineTo( -3, 5 ).fill( { color: fill, alpha: 0.95 } );
				break;
			}
			case 'media':
				gfx.roundRect( -8, -8, 16, 16, 2 )
					.fill( { color: fill, alpha: 0.95 } )
					.stroke( { color: stroke, width: 1.5, alpha: 1 } );
				break;
			case 'revision':
				// Diamond (rotated square).
				gfx.moveTo( 0, -9 )
					.lineTo( 9, 0 )
					.lineTo( 0, 9 )
					.lineTo( -9, 0 )
					.lineTo( 0, -9 )
					.fill( { color: fill, alpha: 0.95 } )
					.stroke( { color: stroke, width: 1.5, alpha: 1 } );
				break;
		}
	}

	private animateIn(): void {
		const t0 = performance.now();
		const duration = 240;
		const starts = this.views.map( ( v ) => ( {
			x: v.container.x,
			y: v.container.y,
		} ) );

		const frame = ( now: number ) => {
			const t = Math.min( 1, ( now - t0 ) / duration );
			const k = 1 - Math.pow( 1 - t, 3 );
			for ( let i = 0; i < this.views.length; i++ ) {
				const v = this.views[ i ];
				const s = starts[ i ];
				v.container.x = s.x + ( v.targetX - s.x ) * k;
				v.container.y = s.y + ( v.targetY - s.y ) * k;
				v.container.alpha = k;
			}
			// Lines re-paint each animation tick so they grow with the
			// satellites instead of jumping straight to their final length.
			this.drawLinks();
			if ( t < 1 ) {
				this.rafId = requestAnimationFrame( frame );
			} else {
				this.rafId = null;
			}
		};
		this.rafId = requestAnimationFrame( frame );
	}

	private showTooltip(
		ref: SatelliteRef,
		global?: { x: number; y: number },
	): void {
		this.hoverEl.hidden = false;
		this.hoverEl.innerHTML =
			`<strong>${ escapeHtml( ref.label || '—' ) }</strong>` +
			( ref.meta ? `<span>${ escapeHtml( ref.meta ) }</span>` : '' );
		if ( global ) {
			const rect = this.hostEl.getBoundingClientRect();
			const lx = global.x - rect.left;
			const ly = global.y - rect.top;
			this.hoverEl.style.left = `${ lx + 12 }px`;
			this.hoverEl.style.top = `${ ly + 12 }px`;
		}
	}

	private hideTooltip(): void {
		this.hoverEl.hidden = true;
	}
}

function truncate( text: string, max: number ): string {
	if ( text.length <= max ) {
		return text;
	}
	return text.slice( 0, max - 1 ).trimEnd() + '…';
}

function iconForKind( kind: Kind ): string {
	switch ( kind ) {
		case 'user': return 'dashicons-admin-users';
		case 'term': return 'dashicons-tag';
		case 'comment': return 'dashicons-admin-comments';
		case 'media': return 'dashicons-admin-media';
		case 'revision': return 'dashicons-backup';
	}
}

function formatDate( iso: string ): string {
	if ( ! iso ) {
		return '';
	}
	try {
		return new Date( iso ).toLocaleString();
	} catch {
		return iso;
	}
}

function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}
