export const FAVORITES_KEY = 'rayloom.effect-favorites.v1';
export const FAVORITES_EVENT = 'rayloom:effect-favorites';
const validId = value => typeof value === 'string' && /^[\w.:/-]{1,200}$/.test(value);
export function readFavorites(storage) {
  try { const saved = JSON.parse(storage.getItem(FAVORITES_KEY) ?? 'null'); return saved?.version === 1 && Array.isArray(saved.ids) ? [...new Set(saved.ids.filter(validId))].slice(0, 512) : []; } catch { return []; }
}
export function toggleFavorite(storage, id) {
  if (!validId(id)) throw Error('Некорректный идентификатор эффекта');
  const current = readFavorites(storage), next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
  if (next.length > 512) throw Error('В избранном уже 512 эффектов. Удалите один, чтобы добавить новый.');
  storage.setItem(FAVORITES_KEY, JSON.stringify({version: 1, ids: next}));
  return next;
}
export function filterLibrary(effects, {query = '', source = 'all', category = 'all'} = {}, favorites = []) {
  const saved = new Set(favorites), needle = query.toLocaleLowerCase('ru').trim();
  return effects.filter(effect => (source === 'all' || source === 'favorites' && saved.has(effect.id) || effect.source === source) && (category === 'all' || effect.category === category) && `${effect.name} ${effect.description ?? ''}`.toLocaleLowerCase('ru').includes(needle));
}
export const libraryViewKey = nativeOnly => `rayloom.effect-library-view.v1.${nativeOnly ? 'native' : 'spatial'}`;
export function readLibraryView(storage, nativeOnly = false) {
  const fallback = {query: '', source: 'all', category: 'all'};
  try {
    const saved = JSON.parse(storage.getItem(libraryViewKey(nativeOnly)) ?? 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    const migratedSource = saved.source === 'lumen' ? 'rayloom' : saved.source;
    return {query: typeof saved.query === 'string' ? saved.query.slice(0, 200) : '', source: (nativeOnly ? ['all', 'favorites'] : ['all', 'favorites', 'rayloom', 'openrgb', 'community']).includes(migratedSource) ? migratedSource : 'all', category: typeof saved.category === 'string' && /^[\w-]{1,60}$/.test(saved.category) ? saved.category : 'all'};
  } catch { return fallback; }
}
