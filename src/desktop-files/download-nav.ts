export function navigateToDownload( url: string ): void {
	const a = document.createElement( 'a' );
	a.href = url;

	a.setAttribute( 'download', '' );
	a.style.display = 'none';
	document.body.appendChild( a );
	a.click();
	a.remove();
}
