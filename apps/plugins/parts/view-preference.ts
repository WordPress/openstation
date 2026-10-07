import type { Ctx } from './types';

export interface ViewPreferenceState { savingView: boolean }

export async function changeInstalledView( ctx: Ctx, ui: ViewPreferenceState, view: string ): Promise< void > {
	if ( ctx.loading || ui.savingView || ( view !== 'cards' && view !== 'table' ) || view === ctx.state.installedView ) {
		return;
	}
	const previous = ctx.state.installedView;
	ui.savingView = true;
	ctx.state.installedView = view;
	ctx.repaint();
	try {
		if ( ! await ctx.dispatch( 'save_view', { view } ) ) {
			ctx.state.installedView = previous;
		}
	} catch {
		ctx.state.installedView = previous;
	} finally {
		ui.savingView = false;
		ctx.repaint();
	}
}
