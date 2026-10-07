import { __, html, type TemplateResult } from '@openstation/app';
import type { UsersData, UserListItem, UsersState } from './types';
import type { ViewContext } from '@openstation/app';
type Ctx = ViewContext< UsersState, UsersData >;

export class PeopleFeed {
	items: UserListItem[] = [];
	pending = false;
	error = false;
	private key = '';
	private lastData: UsersData | null = null;
	private page = 0;
	private pages = 0;
	private expected = 0;
	private disposed = false;
	private ctx: Ctx | null = null;
	private observer: IntersectionObserver | null = null;
	private sentinel: Element | null = null;
	private restarting = false;

	reconcile( ctx: Ctx ): Ctx {
		this.ctx = ctx;
		const { state, data } = ctx;
		const key = JSON.stringify( [ state.search, state.role, state.orderby, state.order, state.perPage ] );
		if ( key !== this.key ) {
			this.key = key; this.items = []; this.page = 0; this.pages = 0; this.lastData = null; this.error = false;
		}
		if ( ! ctx.loading && data && data !== this.lastData && data.list.page === state.page ) {
			this.lastData = data;
			if ( data.list.error ) {
				this.error = true;
			} else if ( data.list.page > 1 && data.list.page !== this.expected ) {
				if ( ! this.restarting ) {
					this.restarting = true;
					queueMicrotask( () => {
						if ( this.disposed ) {
							return;
						}
						void ctx.dispatch( 'page', { page: 1 } ).catch( () => {
							this.error = true;
						} ).finally( () => {
							this.restarting = false;
							if ( ! this.disposed ) {
								ctx.repaint();
							}
						} );
					} );
				}
			} else {
				const combined = data.list.page === 1 ? data.list.items : [ ...this.items, ...data.list.items ];
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
		this.pending = true; this.error = false; this.expected = this.page + 1;
		ctx.repaint();
		try {
			const requested = this.expected;
			const ok = await ctx.dispatch( 'page', { page: requested } );
			if ( ! ok || ctx.data?.list.error || this.page !== requested || ( ! this.hasMore && this.items.length < ctx.data.list.total ) ) {
				this.error = true;
			}
		} catch {
			this.error = true;
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
			content = html`<os-button variant="ghost" @click=${ () => void this.more() }>${ this.error ? __( 'Could not load more. Retry' ) : __( 'Load more people' ) }</os-button>`;
		}
		return html`<div class="os-people__continuation" data-users-feed-end role="status">${ content }</div>`;
	}

	observe( root: HTMLElement ): void {
		const sentinel = root.querySelector( '.os-people__cards [data-users-feed-end]' );
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
		}, { root: root.querySelector( '.os-people__cards' ), rootMargin: '0px 0px 240px 0px' } );
		this.observer.observe( sentinel );
	}

	dispose(): void {
		this.disposed = true; this.observer?.disconnect();
	}
}
