/**
 * Resolve bundled public assets relative to the page hosting the game.
 *
 * CrazyGames serves a build below a game-specific path (for example
 * `/en_US/rattleworks/`), while local development serves it at `/`.  A
 * root-absolute `/textures/...` URL works locally but misses the uploaded
 * folder on portal hosts.  Keeping this resolver page-relative makes both
 * deployments use the same authored files.
 */
export function assetUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, '');
  if (typeof document === 'undefined' || !document.baseURI) return `/${cleanPath}`;
  return new URL(cleanPath, document.baseURI).href;
}
