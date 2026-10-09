/**
 * My WordPress — the gallery view.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. Media's third view, after Finder's
 * Gallery: the open item large on a stage, the section as a
 * filmstrip under it, and the detail pane as an inspector that is
 * always there. Every region has a fixed place, so stepping through
 * the strip only swaps what they show; nothing moves under the
 * pointer between the two clicks of a double click.
 *
 * @public
 */

import { __, html, type TemplateResult } from '@openstation/app';
import { isMobileStamped } from '../../../src/mode/stamp';
import { uiOf, type Ctx, type ListItem, type SectionDef } from './types';
import { explorerItemTrashing, openPreview, previewDetail } from './optimistic';
import { renderDetail } from './dossier-views';
import { rowInteractions } from './rows';

/**
 * Whether this section paints as a gallery. The view is Media's: a
 * post or a person has no picture to put on the stage. A phone keeps
 * the icons, because an open item there is a page of its own.
 */
export function galleryOn( ctx: Ctx, section: SectionDef | null ): boolean {
	return ctx.state.view === 'gallery' && section?.kind === 'media' && ! isMobileStamped();
}

/** Step the open item along the strip, and bring the new one into sight. */
function step( ctx: Ctx, items: ListItem[], by: number ): void {
	const at = items.findIndex( ( i ) => i.id === ctx.state.item );
	const next = items[ Math.min( items.length - 1, Math.max( 0, at + by ) ) ];
	if ( ! next || next.id === ctx.state.item ) {
		return;
	}
	ctx.local( 'select-set', { ids: [ next.id ] } );
	openPreview( ctx, next.id );
	uiOf( ctx ).revealSelection = true;
	// The strip repaints around the new item; keep the keyboard on it.
	requestAnimationFrame( () => {
		ctx.root.querySelector< HTMLElement >( `.os-mywp__strip [data-item-id="${ next.id }"]` )?.focus();
	} );
}

function renderStage( ctx: Ctx, section: SectionDef, items: ListItem[] ): TemplateResult {
	const row = items.find( ( i ) => i.id === ctx.state.item );
	if ( ! row ) {
		return html`<div class="os-mywp__stage"></div>`;
	}
	const detail = previewDetail( ctx );
	// The full image once the dossier lands; the row's thumbnail
	// holds the stage until then, so a step never paints a blank.
	const src = detail?.id === row.id && detail.image ? detail.image : row.thumb;
	const activate = rowInteractions( ctx, section, row, items.map( ( i ) => i.id ) ).activate;
	return html`
		<div class="os-mywp__stage" @dblclick=${ activate }>
			${ src && row.mime.startsWith( 'image/' )
				? html`<img
					class="os-mywp__stage-image"
					src=${ src }
					alt=${ String( row.alt || row.title ) }
					title=${ __( 'Click to zoom, double-click to open' ) }
					@click=${ () => {
						uiOf( ctx ).zoom = true;
						ctx.repaint();
					} }
				/>`
				: html`<span class="os-mywp__stage-glyph dashicons ${ section.icon }" aria-hidden="true"></span>` }
		</div>
	`;
}

function renderStrip( ctx: Ctx, section: SectionDef, items: ListItem[] ): TemplateResult {
	const order = items.map( ( i ) => i.id );
	const drag = section.post_type || section.kind;
	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'ArrowRight' || e.key === 'ArrowLeft' ) {
			e.preventDefault();
			step( ctx, items, e.key === 'ArrowRight' ? 1 : -1 );
		}
	};
	return html`
		<div
			class="os-mywp__strip os-mywp__canvas"
			role="listbox"
			aria-label=${ section.label }
			aria-orientation="horizontal"
			@keydown=${ onKey }
		>
			${ items.map( ( item ) => {
				const row = rowInteractions( ctx, section, item, order );
				const isOpen = ctx.state.item === item.id;
				return html`
					<div
						class="os-mywp__strip-cell ${ isOpen ? 'is-open' : '' }"
						data-item-id=${ String( item.id ) }
						data-mywp-drag=${ drag }
						role="option"
						aria-selected=${ isOpen ? 'true' : 'false' }
						aria-label=${ item.title }
						title=${ item.title }
						tabindex=${ isOpen ? '0' : '-1' }
						@click=${ row.select }
						@dblclick=${ row.activate }
						@keydown=${ ( e: KeyboardEvent ) => {
							if ( e.key === 'Enter' ) {
								row.activate();
							}
						} }
						@contextmenu=${ row.menu }
					>
						${ item.thumb
							? html`<img src=${ item.thumb } alt="" loading="lazy" draggable="false"/>`
							: html`<span class="dashicons ${ section.icon }" aria-hidden="true"></span>` }
					</div>
				`;
			} ) }
			${ uiOf( ctx ).list.hasMore() ? html`<div class="os-mywp__sentinel" data-mywp-sentinel></div>` : '' }
		</div>
	`;
}

/** The gallery body: stage and strip on the left, the inspector on the right. */
export function renderGallery( ctx: Ctx, section: SectionDef, items: ListItem[] ): TemplateResult {
	if ( items.length === 0 ) {
		return html`
			<os-empty-state icon="dashicons-format-image">
				${ ctx.state.query ? __( 'Nothing matches the search.' ) : __( 'Nothing here yet.' ) }
			</os-empty-state>
		`;
	}
	const open = ctx.state.item > 0 && ! explorerItemTrashing( section, ctx.state.item );
	return html`
		<div class="os-mywp__gallery">
			${ renderStage( ctx, section, items ) }
			${ renderStrip( ctx, section, items ) }
			<aside class="os-mywp__inspector" aria-label=${ __( 'Information' ) }>
				${ open ? renderDetail( ctx, section, true ) : '' }
			</aside>
		</div>
	`;
}

/**
 * After a paint: a gallery always has something on its stage. With
 * nothing open in the strip (just switched in, a new section, a
 * search, the open item trashed), open its first item.
 */
export function galleryAfterRender( ctx: Ctx ): void {
	const strip = ctx.root.querySelector( '.os-mywp__strip' );
	if ( ! strip || uiOf( ctx ).previewLoading ) {
		return;
	}
	if ( strip.querySelector( '.os-mywp__strip-cell.is-open' ) ) {
		return;
	}
	const first = Number( strip.querySelector( '[data-item-id]' )?.getAttribute( 'data-item-id' ) ?? 0 );
	if ( first <= 0 || autoOpening.has( ctx.root ) ) {
		return;
	}
	// Out of the render pass: a local action repaints synchronously,
	// and this hook runs after every paint. Opening first marks the
	// preview as loading, which is what stops the next pass here.
	autoOpening.add( ctx.root );
	queueMicrotask( () => {
		autoOpening.delete( ctx.root );
		if ( ctx.state.item > 0 && ctx.root.querySelector( '.os-mywp__strip-cell.is-open' ) ) {
			return;
		}
		openPreview( ctx, first );
		ctx.local( 'select-set', { ids: [ first ] } );
	} );
}

/** Windows whose first item is already on its way to the stage. */
const autoOpening = new WeakSet< Element >();
