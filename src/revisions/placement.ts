export interface PlacementRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

const GAP = 16;

const MARGIN = 16;

const MAX_WIDTH = 1100;

const MAX_HEIGHT = 860;

export function revisionWindowPlacement(
	editor: PlacementRect,
	desktop: { width: number; height: number },
): PlacementRect {
	const available = Math.max( 0, desktop.width - MARGIN * 2 );
	const width = Math.max(
		320,
		Math.min( MAX_WIDTH, Math.round( available * 0.5 ) ),
	);
	const height = Math.max(
		200,
		Math.min( MAX_HEIGHT, Math.round( desktop.height * 0.8 ) ),
	);

	const y = clamp( editor.y, MARGIN, Math.max( MARGIN, desktop.height - height - MARGIN ) );

	const rightOf = editor.x + editor.width + GAP;
	if ( rightOf + width + MARGIN <= desktop.width ) {
		return { x: rightOf, y, width, height };
	}

	const leftOf = editor.x - GAP - width;
	if ( leftOf >= MARGIN ) {
		return { x: leftOf, y, width, height };
	}

	const editorCentreX = editor.x + editor.width / 2;
	const editorCentreY = editor.y + editor.height / 2;
	const right = editorCentreX <= desktop.width / 2;
	const bottom = editorCentreY <= desktop.height / 2;
	return {
		x: right
			? Math.max( MARGIN, desktop.width - width - MARGIN )
			: MARGIN,
		y: bottom
			? Math.max( MARGIN, desktop.height - height - MARGIN )
			: MARGIN,
		width,
		height,
	};
}

function clamp( value: number, min: number, max: number ): number {
	return Math.min( Math.max( value, min ), max );
}
