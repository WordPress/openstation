import type { ViewContext } from '@openstation/app';
import type { UsersState, UsersData } from './types';
import type { ActivitySnapshot } from './activity-model';
type Ctx = ViewContext< UsersState, UsersData >;
export class ActivitySummary {
	data: ActivitySnapshot | null = null;
	loading = false;
	error = false;
	private active = false;
	private previous: UsersData | null = null;
	private request: AbortController | null = null;
	private disposed = false;

	update( ctx: Ctx ): void {
		const active = ctx.state.tab === 'activity';
		const refresh = active && ( ! this.active || this.previous !== ctx.data );
		this.active = active; this.previous = ctx.data;
		if ( refresh ) {
			void this.load( ctx );
		}
	}

	async load( ctx: Ctx ): Promise< void > {
		if ( this.disposed || this.loading ) {
			return;
		}
		const request = new AbortController(); this.request = request;
		this.loading = true; this.error = false; ctx.repaint();
		try {
			const response = await ctx.fetch( '/desktop-mode/v1/users/activity-summary', { signal: request.signal } );
			if ( ! response.ok ) {
				throw new Error( 'Activity summary unavailable' );
			}
			const data = await response.json() as ActivitySnapshot;
			if ( ! request.signal.aborted ) {
				this.data = data;
			}
		} catch {
			if ( ! request.signal.aborted ) {
				this.error = true;
			}
		} finally {
			this.loading = false;
			if ( ! this.disposed ) {
				ctx.repaint();
			}
		}
	}

	dispose(): void {
		this.disposed = true; this.request?.abort();
	}
}
