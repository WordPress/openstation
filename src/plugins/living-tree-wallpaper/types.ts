export interface Vec2 {
	x: number;
	y: number;
}

export interface BranchDNA {

	depth: number;

	girth: number;

	length: number;
}

export interface LeafDNA {

	hue: number;

	health01: number;

	ageDays: number;

	visits: number;
}

export interface TreeSnapshot {

	siteUrl: string;

	siteName: string;

	installEpoch: number;

	siteAgeDays: number;
	totalPosts: number;
	totalPages: number;
	totalCategories: number;
	totalTags: number;
	totalComments: number;

	activeUsers: number;

	traffic: number;

	seoHealth: number;

	performance: number;

	branches: BranchDNA[];
}

export interface Hormones {

	age01: number;

	vigor01: number;

	foliage01: number;

	health01: number;

	bloom01: number;

	wind01: number;

	structure01: number;

	vitality01: number;

	spark: number;
}

export interface Envelope {

	heightMax: number;

	crownRadius: number;

	trunkBaseGirth: number;

	maxDepth: number;

	attractorBudget: number;
}

export interface BranchNode {

	id: number;

	pos: Vec2;

	parent: number | null;

	depth: number;

	radius: number;

	compliance: number;

	direction: Vec2;
}

export interface GrowthConfig {

	segLen: number;

	influenceRadius: number;

	killRadius: number;

	jitter: number;

	tropism: number;

	droop: number;

	maxNodes: number;

	growthRate: number;
}

export interface SceneHandle {

	destroy(): void;

	setAnimating( playing: boolean ): void;
}
