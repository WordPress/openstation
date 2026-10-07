import { __, html, type TemplateResult } from '@openstation/app';
import type { ListData, PostListItem } from './types';
import type { Ctx } from './window-context';

export class ContentFeed {
	items: PostListItem[] = [];
	pending = false;
	error = false;
	private key = '';
	private lastData: ListData | null = null;
	private page = 0;
	private pages = 0;
	private expected = 0;
	private disposed = false;
	private ctx: Ctx | null = null;
	private observer: IntersectionObserver | null = null;
	private sentinel: Element | null = null;
	private generation = 0;
	private queryKey( state: Record< string, unknown > ): string {
		return JSON.stringify( [ state.search, state.status, state.orderby, state.order, state.author, state.tag, state.perPage ] );
	}

	reconcile( ctx: Ctx ): Ctx {
		this.ctx = ctx;
		const { state, data } = ctx;
		const key = this.queryKey( state );
		if ( key !== this.key ) {
			this.generation++; this.expected = 0;
			this.key = key; this.items = []; this.page = 0; this.pages = 0; this.lastData = null; this.error = false;
		}
		if ( ! ctx.loading && data && data !== this.lastData && data.list.page === state.page && ( ! data.query || this.queryKey( data.query ) === key ) ) {
			this.lastData = data;
			if ( data.list.error ) {
				this.error = true;
			} else {
				if ( data.list.page > 1 && this.page === 0 && data.list.page !== this.expected && ! data.list.replace ) {
					return { ...ctx, data: { ...data, list: { ...data.list, items: this.items } } };
				}
				const combined = data.list.page === 1 || data.list.replace ? data.list.items : [ ...this.items, ...data.list.items ];
				this.items = Array.from( new Map( combined.map( ( row ) => [ row.id, row ] ) ).values() );
				this.page = data.list.page; this.pages = data.list.pages; this.error = false;
			}
		}
		return data ? { ...ctx, data: { ...data, list: { ...data.list, items: this.items } } } : ctx;
	}

	get hasMore(): boolean {
		return this.page > 0 && this.page < this.pages;
	}

	async more(): Promise< void > {
		const ctx = this.ctx;
		if ( ! ctx || this.disposed || this.pending || ctx.loading || ! this.hasMore ) {
			return;
		}
		const generation = this.generation;
		this.pending = true; this.error = false; this.expected = this.page + 1;
		ctx.repaint();
		try {
			const ok = await ctx.dispatch( 'page', { page: this.expected } );
			if ( generation === this.generation && ( ! ok || ctx.data?.list.error ) ) {
				this.error = true;
			}
		} catch {
			if ( generation === this.generation ) {
				this.error = true;
			}
		} finally {
			this.pending = false; this.expected = 0; this.sentinel = null;
			if ( ! this.disposed ) {
				ctx.repaint();
			}
		}
	}

	tail(): TemplateResult {
		let content: TemplateResult | string = this.items.length ? __( 'You’re all caught up.' ) : '';
		if ( this.pending ) {
			content = __( 'Loading more…' );
		} else if ( this.hasMore ) {
			content = html`<os-button variant="ghost" @click=${ () => void this.more() }>${ this.error ? __( 'Could not load more. Retry' ) : __( 'Load more' ) }</os-button>`;
		}
		return html`<div class="os-posts-desk__continuation" data-content-feed-end role="status">${ content }</div>`;
	}

	observe( root: HTMLElement ): void {
		const sentinel = root.querySelector( '.os-posts-desk__feed [data-content-feed-end]' );
		if ( sentinel === this.sentinel ) {
			return;
		}
		this.observer?.disconnect(); this.sentinel = sentinel;
		if ( ! sentinel || typeof IntersectionObserver === 'undefined' ) {
			return;
		}
		this.observer = new IntersectionObserver( ( entries ) => {
			if ( entries.some( ( e ) => e.isIntersecting ) && ! this.error ) {
				void this.more();
			}
		}, { root: root.querySelector( '.os-posts-desk__feed' ), rootMargin: '0px 0px 240px 0px' } );
		this.observer.observe( sentinel );
	}

	dispose(): void {
		this.disposed = true; this.observer?.disconnect();
	}
}
