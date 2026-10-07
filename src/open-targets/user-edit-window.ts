export const USER_EDIT_WINDOW_ID = 'desktop-mode-user-edit';

interface DesktopFacade {
	openWindow?: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean | undefined;
	relations?: {
		set?: (
			windowId: string,
			ref: { type: string; id: number | string; label?: string } | null,
		) => void;
	};
}

export function openUserEditWindow(
	userId: number,
	opts: { source?: string; fallback?: () => void } = {},
): boolean {
	if ( ! Number.isFinite( userId ) || userId <= 0 ) {
		return false;
	}
	const desktop = ( window as unknown as { wp?: { os?: DesktopFacade } } ).wp?.os;
	const opened = desktop?.openWindow?.( USER_EDIT_WINDOW_ID, {
		source: opts.source ?? 'user-edit/open',
		params: { userId },
	} );

	if ( opened ) {
		desktop?.relations?.set?.( USER_EDIT_WINDOW_ID, {
			type: 'user',
			id: userId,
		} );
		return true;
	}

	opts.fallback?.();
	return false;
}
