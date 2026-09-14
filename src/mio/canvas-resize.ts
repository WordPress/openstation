/** Resizing clears a canvas. Repaint synchronously before the browser can expose it. */
export function resizeMioCanvas(
	app: { screen: { width: number; height: number }; renderer: { resize: ( width: number, height: number ) => void }; render: () => void },
	bounds: { width: number; height: number },
	reflow: () => void,
): void {
	if ( app.screen.width !== bounds.width || app.screen.height !== bounds.height ) {
		app.renderer.resize( bounds.width, bounds.height );
	}
	reflow();
	app.render();
}
