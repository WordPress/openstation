/**
 * Content Graph — satellite layer.
 *
 * On node focus, this module fans the focused post's relationship
 * payload out around it as orbiting satellites. Each satellite is a
 * Pixi `Container` with a colour-tinted disc + a dashicon glyph (the
 * same icons WP admin uses for users / categories / comments / media /
 * revisions, so the visual reads as "WordPress" not "ad-hoc shapes").
 *
 * Behaviour:
 *   - Animates outward from the focused node's centre on entrance.
 *   - Hover highlight + DOM tooltip with label and meta.
 *   - On click, calls `onClick(ref)` — the host then routes the click
 *     to the contextual side panel (showUser / showTerm / etc.) rather
 *     than navigating away.
 *   - Connector lines re-paint each animation tick so they track the
 *     focused node as it moves with the simulation.
 *
 * @public
 * @since 0.8.2
 */

import { __, sprintf } from '../i18n';
import { resolveDashicon } from '../ui/components/wpd-icon/dashicons-map';
import type {
	PixiContainer,
	PixiGraphics,
	PixiNamespace,
	PixiText,
} from './pixi-types';
import type { GraphNode, PostDetail } from './types';

/**
 * Discriminated union — every satellite knows its own kind PLUS the
 * entity id needed to fetch its detail panel.
 */
export type SatelliteRef =
	| {
			kind: 'user';
			userId: number;
			label: string;
			meta: string;
			avatar?: string;
	}
	| {
			kind: 'term';
			termId: number;
			taxonomy: string;
			label: string;
			meta: string;
	}
	| {
			kind: 'comment';
			commentId: number;
			label: string;
			meta: string;
	}
	| {
			kind: 'media';
			mediaId: number;
			label: string;
			meta: string;
			thumb?: string;
	}
	| {
			kind: 'revision';
			revisionId: number;
			parentId: number;
			label: string;
			meta: string;
	};

export type SatelliteOnClick = ( ref: SatelliteRef ) => void;

/**
 * Lookup invoked by the scene on construction; given a post-type
 * slug, returns the dashicon name to render (e.g. `'admin-post'`).
 */
export type PostTypeIconLookup = ( slug: string ) => string;

const KIND_COLOR: Record< SatelliteRef[ 'kind' ], number > = {
	user: 0x3a6df0,
	term: 0x2ca97a,
	comment: 0xe8893a,
	media: 0xa05ed4,
	revision: 0x6b7785,
};

const KIND_DASHICON: Record< SatelliteRef[ 'kind' ], string > = {
	user: 'admin-users',
	term: 'tag',
	comment: 'admin-comments',
	media: 'admin-media',
	revision: 'backup',
};

interface SatelliteView {
	ref: SatelliteRef;
	container: PixiContainer;
	disc: PixiGraphics;
	icon: PixiText;
	label: PixiText;
	targetX: number;
	targetY: number;
}

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
		private onClick: SatelliteOnClick,
		private hostEl: HTMLElement,
	) {
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
		const ringR = Math.max(
			90,
			baseR + 70 + ( refs.length * 26 ) / ( 2 * Math.PI ),
		);

		const startAngle = -Math.PI / 2;
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

	private flattenDetail( detail: PostDetail ): SatelliteRef[] {
		const out: SatelliteRef[] = [];

		if ( detail.author ) {
			out.push( {
				kind: 'user',
				userId: detail.author.id,
				label: detail.author.name,
				meta: __( 'Author' ),
				avatar: detail.author.avatar,
			} );
		}
		for ( const u of detail.contributors.slice( 0, 8 ) ) {
			out.push( {
				kind: 'user',
				userId: u.id,
				label: u.name,
				meta: __( 'Contributor' ),
				avatar: u.avatar,
			} );
		}
		for ( const t of detail.categories.slice( 0, 12 ) ) {
			out.push( {
				kind: 'term',
				termId: t.id,
				taxonomy: t.taxonomy,
				label: t.name,
				meta: sprintf(
					/* translators: 1: taxonomy label (e.g. Category, Tag). 2: post count for the term. */
					__( '%1$s · %2$d posts' ),
					t.tax_label,
					t.count,
				),
			} );
		}
		for ( const c of detail.comments.slice( 0, 8 ) ) {
			out.push( {
				kind: 'comment',
				commentId: c.id,
				label: c.author,
				meta: c.excerpt || formatDate( c.date ),
			} );
		}
		for ( const m of detail.attached_media.slice( 0, 12 ) ) {
			out.push( {
				kind: 'media',
				mediaId: m.id,
				label: m.title,
				meta: m.mime,
				thumb: m.thumb,
			} );
		}
		for ( const r of detail.revisions.slice( 0, 8 ) ) {
			out.push( {
				kind: 'revision',
				revisionId: r.id,
				parentId: detail.post.id,
				label: r.author?.name ?? __( 'Revision' ),
				meta: formatDate( r.date ),
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
		container.hitArea = {
			contains: ( x: number, y: number ) => {
				return x >= -16 && x <= 16 && y >= -14 && y <= 28;
			},
		};

		const disc = new this.pixi.Graphics();
		const fill = KIND_COLOR[ ref.kind ];
		disc.circle( 0, 0, 12 ).fill( { color: fill, alpha: 0.95 } )
			.stroke( { color: 0xffffff, width: 1.5, alpha: 1 } );
		container.addChild( disc );

		const iconChar = resolveDashicon( KIND_DASHICON[ ref.kind ] );
		const icon = new this.pixi.Text( {
			text: iconChar ?? '?',
			style: {
				fontFamily: iconChar ? 'dashicons' : 'sans-serif',
				fontSize: 13,
				fill: 0xffffff,
			},
			resolution: 2,
			anchor: { x: 0.5, y: 0.5 },
		} );
		icon.x = 0;
		icon.y = 0;
		container.addChild( icon );

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
		label.y = 14;
		label.alpha = 0.9;
		container.addChild( label );

		container.on( 'pointerover', ( evt: unknown ) => {
			disc.alpha = 1;
			const e = evt as { global?: { x: number; y: number } };
			this.showTooltip( ref, e.global );
		} );
		container.on( 'pointermove', ( evt: unknown ) => {
			const e = evt as { global?: { x: number; y: number } };
			this.showTooltip( ref, e.global );
		} );
		container.on( 'pointerout', () => {
			disc.alpha = 0.95;
			this.hideTooltip();
		} );
		container.on( 'pointertap', ( evt: unknown ) => {
			const e = evt as { stopPropagation?: () => void };
			e.stopPropagation?.();
			this.hideTooltip();
			this.onClick( ref );
		} );

		this.layer.addChild( container );

		return {
			ref,
			container,
			disc,
			icon,
			label,
			targetX: startX,
			targetY: startY,
		};
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
