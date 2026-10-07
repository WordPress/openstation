import type { ViewContext } from '@openstation/app';
import type { UserListItem, UsersState, UsersData } from './types';
export interface RoleGroup { role: string; label: string; total: number; members: UserListItem[] }
export interface RolesSnapshot { total: number; groups: RoleGroup[] }
type Ctx = ViewContext< UsersState, UsersData >;
export class RolesSummary {
	data: RolesSnapshot | null = null;
	loading = false;
	error = false;
	private active = false;
	private previous: UsersData | null = null;
	private request: AbortController | null = null;
	private disposed = false;

	update( ctx: Ctx ): void {
		const active = ctx.state.tab === 'roles';
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
			const response = await ctx.fetch( '/desktop-mode/v1/users/roles-summary', { signal: request.signal } );
			if ( ! response.ok ) {
				throw new Error( 'Role summary unavailable' );
			}
			const data = await response.json() as RolesSnapshot;
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
