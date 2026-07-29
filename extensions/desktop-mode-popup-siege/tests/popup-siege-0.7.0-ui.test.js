const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const test = require( 'node:test' );

const root = path.resolve( __dirname, '..' );

function read( relativePath ) {
	return fs.readFileSync( path.join( root, relativePath ), 'utf8' );
}

function relativeLuminance( hex ) {
	const channels = hex
		.match( /[a-f0-9]{2}/gi )
		.map( ( channel ) => parseInt( channel, 16 ) / 255 )
		.map( ( channel ) =>
			channel <= 0.04045
				? channel / 12.92
				: Math.pow( ( channel + 0.055 ) / 1.055, 2.4 )
		);

	return (
		0.2126 * channels[ 0 ] +
		0.7152 * channels[ 1 ] +
		0.0722 * channels[ 2 ]
	);
}

function contrastRatio( first, second ) {
	const lighter = Math.max(
		relativeLuminance( first ),
		relativeLuminance( second )
	);
	const darker = Math.min(
		relativeLuminance( first ),
		relativeLuminance( second )
	);

	return ( lighter + 0.05 ) / ( darker + 0.05 );
}

function projectedGeometry( host, projection, manifest ) {
	const assumptions = manifest.projectionContract.assumptions;
	const applianceWidth = Math.min(
		( host.height -
			2 * projection.bodyPaddingYCssPixels -
			assumptions.maxHeightInsetCssPixels ) *
			assumptions.aspectRatio,
		host.height * assumptions.heightWidthFactor -
			assumptions.heightWidthOffsetCssPixels,
		host.width -
			2 * projection.bodyPaddingXCssPixels -
			projection.horizontalWidthInsetCssPixels
	);
	const applianceHeight =
		applianceWidth / assumptions.aspectRatio;
	const controlWidth =
		applianceWidth *
		manifest.appliance.consoleShare *
		manifest.regions.controls.width;
	const controlHeight =
		applianceHeight * manifest.regions.controls.height;

	return {
		applianceWidth,
		applianceHeight,
		controlKeyWidth:
			( controlWidth *
				( 1 - manifest.regions.controls.columnGap ) ) /
			manifest.regions.controls.columns,
		controlKeyHeight:
			( controlHeight *
				( 1 - manifest.regions.controls.rowGap ) ) /
			manifest.regions.controls.rows,
	};
}

test( '0.7.0 is one scoped presentation owner over 0.6.1', () => {
	const styles = read( 'standalone/popup-breaker-0.7.0.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.7.0.json'
		)
	);

	assert.match(
		styles,
		/^\/\*[\s\S]*@import url\("\.\/popup-breaker-0\.6\.1\.css"\);/
	);
	assert.equal( manifest.id, 'popup-siege-ui-system-0.7.0' );
	assert.equal( manifest.inherits, 'popup-siege-ui-system-0.6.1' );
	assert.equal( manifest.featureSelector, 'siege-game--experience-070' );
	assert.match( styles, /\.siege-game--experience-070/ );
} );

test( 'right-side placement is explicit and has no stacked fallback', () => {
	const styles = read( 'standalone/popup-breaker-0.7.0.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.7.0.json'
		)
	);

	assert.deepEqual( manifest.spatialInvariant.gridTemplateAreas, [
		[ 'bar', 'header' ],
		[ 'stage', 'header' ],
		[ 'rail', 'rail' ],
	] );
	assert.equal(
		manifest.spatialInvariant.consolePlacement,
		'right-at-all-widths'
	);
	assert.equal(
		manifest.spatialInvariant.stackedFallbackAllowed,
		false
	);
	assert.equal( manifest.belowMinimum.stackingAllowed, false );
	assert.match(
		styles,
		/grid-template-areas:\s*"bar header"\s*"stage header"\s*"rail rail"/
	);
	assert.match(
		styles,
		/grid-template-columns:\s*minmax\(0, var\(--siege-ui-stage-share\)\)\s*minmax\(0, var\(--siege-ui-console-share\)\)/
	);
	assert.doesNotMatch( styles, /grid-template-areas:\s*"bar bar"/ );
	assert.doesNotMatch( styles, /grid-template-areas:\s*"header header"/ );
} );

test( 'supported host projection clears the 44px target gate', () => {
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.7.0.json'
		)
	);
	const host = manifest.smallestSupportedHost;
	const projection =
		manifest.projectionContract.smallestSupportedHost;
	const calculated = projectedGeometry(
		host,
		projection,
		manifest
	);

	assert.equal(
		manifest.projectionContract.measurementKind,
		'calculated-css-projection-not-browser-measurement'
	);
	assert.deepEqual(
		[ host.width, host.height ],
		[ 520, 480 ]
	);
	assert.ok( calculated.controlKeyWidth >= 44 );
	assert.ok( calculated.controlKeyHeight >= 44 );
	assert.ok(
		Math.abs(
			calculated.controlKeyWidth -
				projection.projectedControlKeyWidthCssPixels
		) < 0.01
	);
	assert.ok(
		Math.abs(
			calculated.controlKeyHeight -
				projection.projectedControlKeyHeightCssPixels
		) < 0.01
	);
	assert.equal( manifest.belowMinimum.status, 'unsupported-contained' );
	assert.equal(
		manifest.belowMinimum.targetConformance,
		'not-guaranteed'
	);
} );

test( 'canonical projection and type roles have named optical floors', () => {
	const styles = read( 'standalone/popup-breaker-0.7.0.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.7.0.json'
		)
	);
	const canonical = manifest.projectionContract.canonicalHost;
	const calculated = projectedGeometry(
		manifest.canonicalHost,
		canonical,
		manifest
	);

	assert.deepEqual(
		[ manifest.canonicalHost.width, manifest.canonicalHost.height ],
		[ 900, 620 ]
	);
	assert.ok(
		Math.abs(
			calculated.applianceWidth -
				canonical.projectedApplianceWidthCssPixels
		) < 0.01
	);
	assert.deepEqual(
		{
			brand: manifest.typeTokens.brandEyebrow.minimumCssPixels,
			hudLabel: manifest.typeTokens.hudLabel.minimumCssPixels,
			hudValue: manifest.typeTokens.hudValue.minimumCssPixels,
			control:
				manifest.typeTokens.controlLabel.minimumCssPixels,
			long:
				manifest.typeTokens.longControlLabel.minimumCssPixels,
		},
		{
			brand: 9,
			hudLabel: 10,
			hudValue: 15,
			control: 9,
			long: 8.5,
		}
	);
	for ( const token of [
		'brand-eyebrow',
		'hud-label',
		'hud-value',
		'control-label',
		'control-label-long',
		'browser-chrome',
		'browser-rail',
	] ) {
		assert.match( styles, new RegExp( `--siege-ui-type-${ token }` ) );
	}
	assert.ok( canonical.projectedTypeCssPixels.brandEyebrow >= 9 );
	assert.ok( canonical.projectedTypeCssPixels.hudLabel >= 10 );
	assert.ok( canonical.projectedTypeCssPixels.hudValue >= 15 );
	assert.ok( canonical.projectedTypeCssPixels.controlLabel >= 9 );
	assert.ok( canonical.projectedTypeCssPixels.longControlLabel >= 8.5 );
	assert.ok( canonical.projectedTypeCssPixels.browserChrome >= 9 );
	assert.ok( canonical.projectedTypeCssPixels.browserRail >= 9 );
} );

test( 'HUD and control fit policy preserves the limiting strings', () => {
	const styles = read( 'standalone/popup-breaker-0.7.0.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.7.0.json'
		)
	);
	const projection =
		manifest.projectionContract.smallestSupportedHost;

	assert.ok(
		projection.projectedSixDigitScorePaintWidthCssPixels <=
			projection.projectedHudInstrumentWidthCssPixels
	);
	assert.ok(
		projection.projectedLongestControlLabelPaintWidthCssPixels <=
			projection.projectedControlKeyWidthCssPixels
	);
	assert.equal( manifest.regions.hud.scorePaintScaleX, 0.76 );
	assert.match(
		styles,
		/\[data-role="score"\][\s\S]*transform:\s*scaleX\(0\.76\)/
	);
	assert.match(
		styles,
		/\.siege-actions[\s\S]*button::after,[\s\S]*white-space:\s*nowrap/
	);
} );

test( 'pause key meets the declared normal-text contrast policy', () => {
	const styles = read( 'standalone/popup-breaker-0.7.0.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.7.0.json'
		)
	);
	const policy = manifest.contrastPolicy;
	const key = policy.pauseKey;
	const lightRatio = contrastRatio( key.foreground, key.lightFace );
	const darkRatio = contrastRatio( key.foreground, key.darkFace );

	assert.ok( lightRatio >= policy.minimumNormalTextRatio );
	assert.ok( darkRatio >= policy.minimumNormalTextRatio );
	assert.ok(
		Math.abs( lightRatio - key.foregroundOnLightFaceRatio ) < 0.01
	);
	assert.ok(
		Math.abs( darkRatio - key.foregroundOnDarkFaceRatio ) < 0.01
	);
	assert.match( styles, /--siege-ui-pause-foreground:\s*#100b17/ );
	assert.match( styles, /--siege-ui-pause-face-dark:\s*#d78315/ );
} );

test( 'all live phases, feedback hooks, and accessibility modes are styled', () => {
	const styles = read( 'standalone/popup-breaker-0.7.0.css' );
	const manifest = JSON.parse(
		read(
			'games/popup-breaker/assets/popup-siege-ui-system-0.7.0.json'
		)
	);

	for ( const selector of [
		'data-phase="menu"',
		'data-phase="playing"',
		'data-phase="paused"',
		'data-phase="results"',
		'data-runtime-state="off"',
		'aria-pressed="false"',
		':focus-visible',
	] ) {
		assert.ok( styles.includes( selector ), `Missing ${ selector } state` );
	}
	assert.match( styles, /@media \(prefers-reduced-motion: reduce\)/ );
	assert.match( styles, /@media \(forced-colors: active\)/ );
	assert.match( styles, /\.siege-target__x/ );
	assert.match( styles, /\.siege-popup-close-beat/ );
	assert.match( styles, /\.siege-restored-page/ );
	assert.match( styles, /\.siege-archive-receipt/ );
	assert.match(
		styles,
		/\.siege-challenge\[data-openstation-challenge="active"\]/
	);
	assert.match(
		styles,
		/\.openstation-popup-siege-message__actions button[\s\S]*min-height:\s*44px/
	);
	assert.match( styles, /\[data-role="restored-reveal"\]/ );
	assert.match( styles, /\[data-role="receipt-summary"\]/ );
	assert.ok(
		manifest.runtimeHooks.popupCloseBeat.semanticPolicy.includes(
			'visual-supplement-only'
		)
	);
	assert.deepEqual( manifest.states.motion, [ 'default', 'reduced' ] );
	assert.deepEqual( manifest.states.colors, [ 'default', 'forced' ] );
	assert.equal(
		manifest.runtimeHooks.challenge.placement,
		'absolute-within-browser-no-implicit-grid-track'
	);
	assert.equal(
		manifest.runtimeHooks.loadFailureActions.minimumTargetCssPixels,
		44
	);
} );
