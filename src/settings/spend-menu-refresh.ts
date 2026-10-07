export function spendMenuRefresh(): void {
	const refreshMenu = (
		window.wp as
			| { os?: { refreshMenu?: () => Promise< void > } }
			| undefined
	)?.os?.refreshMenu;
	if ( typeof refreshMenu !== 'function' ) {
		return;
	}
	try {
		void refreshMenu();
	} catch {

	}
}
