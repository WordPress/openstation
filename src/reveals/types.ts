export interface WindowRevealLayer {

	from: string;

	to: string;

	color?: string;
}

export interface WindowRevealRenderContext {

	duration: number;

	easing: string;

	delay: number;
}

export interface WindowRevealRendered {

	element: HTMLElement;

	play: ( ctx: WindowRevealRenderContext ) => Animation[];
}

export interface WindowRevealDef {

	id: string;

	label: string;

	description?: string;

	from?: string;

	to?: string;

	layers?: WindowRevealLayer[];

	render?: () => WindowRevealRendered;

	duration?: number;

	easing?: string;

	surfaceColor?: string;

	edgeColor?: string;

	edgeLag?: number;

	owner?: string;
}
