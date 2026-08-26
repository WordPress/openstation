/**
 * Content Graph — satellite layer.
 *
 * On node focus, this module fans the focused post's relationship
 * payload out around it as orbiting satellites. Each satellite is a
 * Pixi `Container` with a colour-tinted disc + a dashicon glyph (the
 * same icons WP admin uses for users / categories / comments / media /
 * revisions, so the visual reads as "WordPress" not "ad-hoc shapes").
 *
 * Layout: a single ring around the focused node with all satellites
 * evenly distributed by angle. Refs come from `flattenDetail` already
 * grouped by kind (author → contributors → terms → comments → media →
 * revisions), so the ring is visually banded by colour as you walk
 * around it without having to break it into separate concentric
 * orbits — that variant produced an off-balance cluster when most
 * posts have only a couple of satellites per kind.
 *
 * Behaviour:
 *   - Animates outward from the focused node's centre on entrance.
 *   - Hover highlight + DOM tooltip with label and meta.
 *   - On click, calls `onClick(ref)` — the host then routes the click
 *     to the contextual side panel (showUser / showTerm / etc.) rather
 *     than navigating away. The clicked satellite picks up a
 *     "selected" highlight (thicker stroke + soft halo) so the user
 *     can see what the panel content corresponds to.
 *   - Connector spokes from the focused node to each satellite render
 *     into a layer the scene places BEHIND the node disc (the node
 *     covers the spoke origin instead of being painted over by it).
 *   - Connector lines re-paint each animation tick so they track the
 *     focused node as it moves with the simulation.
 *
 * @public
 */

import { __, sprintf } from '../i18n';
import { resolveDashicon } from '../ui/components/os-icon/dashicons-map';
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

const KIND_COLOR: Record<SatelliteRef['kind'], number> = {
	user: 0x3a6df0,
	term: 0x2ca97a,
	comment: 0xe8893a,
	media: 0xa05ed4,
	revision: 0x6b7785,
};

const KIND_DASHICON: Record<SatelliteRef['kind'], string> = {
	user: 'admin-users',
	// Fallback for term kinds we don't have a specific icon for.
	// Per-taxonomy lookup (see `iconForTermRef`) overrides this for
	// the WordPress built-ins so categories don't share the tag's
	// visual identity.
	term: 'tag',
	comment: 'admin-comments',
	media: 'admin-media',
	revision: 'backup',
};

/**
 * Pick a dashicon for a term satellite based on its taxonomy.
 * Categories get the folder icon, tags keep the tag icon, anything
 * else falls back to the generic `term` icon — gives editors a
 * visual distinction between the two built-in WP taxonomies (which
 * were indistinguishable green-tag pills before).
 */
function iconForTermRef( ref: Extract< SatelliteRef, { kind: 'term' } > ): string {
	switch ( ref.taxonomy ) {
		case 'category':
			return 'category';
		case 'post_tag':
			return 'tag';
		default:
			return KIND_DASHICON.term;
	}
}

/**
 * Per-icon visual-centre offset applied on top of the `(0.5, 0.5)`
 * anchor. Pixi.Text measures bbox = ascent + descent for the font; for
 * dashicons the descent is unused space below the baseline, so the
 * bbox-centred anchor parks the visible glyph ~ascent/2 above the
 * world-y=0 line. With `fontSize: 20`, ascent ≈ 17 + descent ≈ 5 →
 * bbox height ≈ 22 and the glyph centre sits ~3px above bbox centre.
 * A flat +3 y nudge brings the glyph onto the disc centre for every
 * kind; the comment glyph gets an additional +2 x nudge because the
 * speech-bubble bbox is left-loaded (bubble in upper-left, tail
 * trailing to the lower-right).
 */
const KIND_ICON_NUDGE: Record<
	SatelliteRef[ 'kind' ],
	{ x: number; y: number }
> = {
	user: { x: 0, y: 3 },
	term: { x: 0, y: 3 },
	// The speech-bubble dashicon is intrinsically off-balance — even
	// after the bbox is centred, the visible bubble drifts toward the
	// upper-right because the tail-less side carries more glyph mass.
	// Tuned by eye against the rendered output: pull a bit left, push
	// a bit down. Don't pile on more correction without re-checking;
	// what looks centred at one zoom can over-shoot at another.
	comment: { x: 1, y: 4 },
	media: { x: -1, y: 1 },
	revision: { x: 0, y: 3 },
};

const DISC_RADIUS = 14;

interface SatelliteView {
  ref: SatelliteRef;
  key: string;
  container: PixiContainer;
  disc: PixiGraphics;
  icon: PixiText;
  label: PixiText;
  targetX: number;
  targetY: number;
  selected: boolean;
}

export class SatelliteLayer {
	private linkGfx: PixiGraphics;
	private layer: PixiContainer;
	private views: SatelliteView[] = [];
	private focused: GraphNode | null = null;
	private hoverEl: HTMLDivElement;
	private rafId: number | null = null;
	private selectedKey: string | null = null;

	constructor(
    private pixi: PixiNamespace,
    // Parent for the satellite icons themselves — drawn ABOVE the
    // node layer so satellites sit in front of nodes.
    private satelliteParent: PixiContainer,
    // Parent for the connector spokes — the scene places this BELOW
    // the node layer so the spoke endpoints appear to start from
    // behind the focused node disc rather than pasted over it.
    private spokeParent: PixiContainer,
    private onClick: SatelliteOnClick,
    private hostEl: HTMLElement,
    // Called on satellite `pointerdown` so the scene can flip its
    // pixi-click gate. Without this the canvas-level pan handler
    // fires on the same pointer event, then the matching pointerup
    // triggers `onBackgroundClick` and closes the panel right after
    // `panel.show*()` opened the contextual view.
    private claimPointer: () => void,
	) {
		this.linkGfx = new pixi.Graphics();
		this.spokeParent.addChild( this.linkGfx );

		this.layer = new pixi.Container();
		this.satelliteParent.addChild( this.layer );

		this.hoverEl = document.createElement( 'div' );
		this.hoverEl.className = 'os-content-graph__tooltip';
		this.hoverEl.hidden = true;
		this.hostEl.appendChild( this.hoverEl );
	}

	clear(): void {
		this.linkGfx.clear();
		this.layer.removeChildren();
		this.views = [];
		this.focused = null;
		this.selectedKey = null;
		this.hideTooltip();
	}

	drawLinks(): void {
		this.linkGfx.clear();
		if ( ! this.focused || this.views.length === 0 ) {
			return;
		}
		// Trim the spoke origin from the focused node's CENTRE to its
		// halo OUTER EDGE so lines stop at the disc boundary instead
		// of running through it. The halo radius (`node.radius + 8`)
		// matches the value the scene paints in `draw()`.
		const halo = this.focused.radius + 8;
		const fx = this.focused.x;
		const fy = this.focused.y;
		for ( const v of this.views ) {
			const dx = v.container.x - fx;
			const dy = v.container.y - fy;
			const d = Math.sqrt( dx * dx + dy * dy );
			if ( d <= halo ) {
				continue;
			}
			const t = halo / d;
			const sx = fx + dx * t;
			const sy = fy + dy * t;
			const color = KIND_COLOR[ v.ref.kind ];
			this.linkGfx
				.moveTo( sx, sy )
				.lineTo( v.container.x, v.container.y )
				.stroke( {
					color,
					width: v.selected ? 1.8 : 1.4,
					alpha: v.selected ? 0.85 : 0.5,
				} );
		}
	}

	setFocused( focused: GraphNode, detail: PostDetail ): void {
		this.clear();
		this.focused = focused;
		const refs = this.flattenDetail( detail );
		if ( refs.length === 0 ) {
			return;
		}

		// Single ring. Radius blends a base offset with the satellite
		// count so a post with many satellites still has enough
		// circumference to breathe; a post with few stays tight to
		// the focused node instead of sprawling to the canvas edge.
		const baseR = focused.radius;
		const minSpacing = 36;
		const ringR = Math.max(
			baseR + 86,
			baseR + 70 + ( refs.length * minSpacing ) / ( 2 * Math.PI ),
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

	/**
	 * Mark a satellite by its synthetic key (e.g. `user:123`,
	 * `term:category:42`). Pass `null` to clear. The selected satellite
	 * gets a thicker stroke + soft halo so the user can see which one
	 * matches the panel content. Auto-cleared by `clear()` and on a
	 * fresh `setFocused()`.
	 */
	setSelectedKey( key: string | null ): void {
		if ( this.selectedKey === key ) {
			return;
		}
		this.selectedKey = key;
		for ( const v of this.views ) {
			const next = v.key === key;
			if ( next === v.selected ) {
				continue;
			}
			v.selected = next;
			this.repaintDisc( v );
		}
		this.drawLinks();
	}

	destroy(): void {
		if ( this.rafId !== null ) {
			cancelAnimationFrame( this.rafId );
			this.rafId = null;
		}
		this.clear();
		this.layer.destroy( { children: true } );
		this.linkGfx.destroy();
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
		const hitR = DISC_RADIUS + 4;
		container.hitArea = {
			contains: ( x: number, y: number ) => {
				return x >= -hitR && x <= hitR && y >= -hitR && y <= hitR + 18;
			},
		};

		const disc = new this.pixi.Graphics();
		container.addChild( disc );

		const dashName =
			ref.kind === 'term' ? iconForTermRef( ref ) : KIND_DASHICON[ ref.kind ];
		const iconChar = resolveDashicon( dashName );
		// Bigger glyph + true bbox-centre anchor, then per-kind x/y
		// nudge in KIND_ICON_NUDGE pushes the visible glyph (not the
		// bbox) onto the disc centre. The `admin-comments` bubble
		// needs the largest correction because the speech tail makes
		// the bbox asymmetric — see the nudge comment above.
		const icon = new this.pixi.Text( {
			text: iconChar ?? '?',
			style: {
				fontFamily: iconChar ? 'dashicons' : 'sans-serif',
				fontSize: iconChar ? 20 : 13,
				fill: 0xffffff,
			},
			resolution: 2,
			anchor: { x: 0.5, y: 0.5 },
		} );
		const nudge = KIND_ICON_NUDGE[ ref.kind ];
		icon.x = nudge?.x ?? 0;
		icon.y = nudge?.y ?? 0;
		container.addChild( icon );

		const labelText = truncate( ref.label || '—', 28 );
		// Draw the backing FIRST so it sits beneath the text, then
		// the text itself. Without the backing, a satellite label that
		// happens to overlap the focused-node disc or another label
		// (e.g. "Recipe" landing on top of a neighbour-post label)
		// becomes near-illegible — the backing pill keeps each
		// satellite's name readable without competing for attention.
		const labelBg = new this.pixi.Graphics();
		container.addChild( labelBg );

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
		label.y = DISC_RADIUS + 2;
		container.addChild( label );

		// Now that the text has measured itself, paint the backing
		// pill behind it. Width is fixed for the lifetime of this
		// satellite (label text doesn't mutate after construction),
		// so this is a one-time draw, not per-frame.
		const padX = 6;
		const padY = 1;
		const lw = label.width + padX * 2;
		const lh = label.height + padY * 2;
		labelBg
			.roundRect( -lw / 2, label.y - padY, lw, lh, 4 )
			.fill( { color: 0xffffff, alpha: 0.92 } )
			.stroke( { color: 0x000000, alpha: 0.08, width: 1 } );

		container.on( 'pointerdown', ( evt: unknown ) => {
			const e = evt as { stopPropagation?: () => void };
			e.stopPropagation?.();
			// Tell the scene that a pixi-managed element is the click
			// target. The canvas-level pointerdown listener checks
			// this and bails out of pan/background-click setup.
			this.claimPointer();
		} );
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
			// Auto-mark this satellite as selected so the visual flips
			// instantly. The host can refine via `setSelectedKey()` if
			// it ends up rendering a different view (e.g. fetch
			// failure), but for the common path this avoids round-trip
			// flicker.
			this.setSelectedKey( keyForRef( ref ) );
			this.onClick( ref );
		} );

		this.layer.addChild( container );

		const view: SatelliteView = {
			ref,
			key: keyForRef( ref ),
			container,
			disc,
			icon,
			label,
			targetX: startX,
			targetY: startY,
			selected: false,
		};
		this.repaintDisc( view );
		return view;
	}

	private repaintDisc( v: SatelliteView ): void {
		const fill = KIND_COLOR[ v.ref.kind ];
		v.disc.clear();
		if ( v.selected ) {
			// Soft halo behind the disc so the selected satellite
			// reads as "active" without yelling colour.
			v.disc.circle( 0, 0, DISC_RADIUS + 6 ).fill( { color: fill, alpha: 0.18 } );
		}
		v.disc
			.circle( 0, 0, DISC_RADIUS )
			.fill( { color: fill, alpha: 0.95 } )
			.stroke( {
				color: 0xffffff,
				width: v.selected ? 2.5 : 1.5,
				alpha: 1,
			} );
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
			// Pixi v8's `event.global` is already in the canvas's local
			// (CSS-pixel) coordinate space. The host element wraps the
			// canvas with `position: relative` and no padding, so the
			// canvas-local x/y is identical to the host-local x/y the
			// tooltip needs. The previous code subtracted
			// `host.getBoundingClientRect().left/top`, which was a
			// viewport-coords value — that mismatch is what made the
			// tooltip drift far from the cursor.
			this.hoverEl.style.left = `${ global.x + 14 }px`;
			this.hoverEl.style.top = `${ global.y + 14 }px`;
		}
	}

	private hideTooltip(): void {
		this.hoverEl.hidden = true;
	}
}

/**
 * Stable identity for a satellite — used by `setSelectedKey()` to mark
 * the visual selected state and by hosts that want to reason about
 * which satellite a click landed on without holding the ref directly.
 */
export function keyForRef( ref: SatelliteRef ): string {
	switch ( ref.kind ) {
		case 'user':
			return `user:${ ref.userId }`;
		case 'term':
			return `term:${ ref.taxonomy }:${ ref.termId }`;
		case 'comment':
			return `comment:${ ref.commentId }`;
		case 'media':
			return `media:${ ref.mediaId }`;
		case 'revision':
			return `revision:${ ref.revisionId }`;
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
