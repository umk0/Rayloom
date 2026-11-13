import test from 'node:test';
import assert from 'node:assert/strict';
import {FAVORITES_KEY, readFavorites, toggleFavorite, filterLibrary, readLibraryView, libraryViewKey} from '../shared/effect-library-state.mjs';
import {migrateSessionDraft, editorViewKey, readEditorView} from '../shared/advanced-editor-state.mjs';
import {advancedDraftKey, readAdvancedDraft} from '../shared/advanced-draft.mjs';
class Storage { data = new Map(); getItem(key) { return this.data.get(key) ?? null; } setItem(key, value) { this.data.set(key, value); } removeItem(key) { this.data.delete(key); } }
test('favorites persist stable builtin/native/plugin IDs and retain temporarily missing plugins', () => {
  const storage = new Storage();
  for (const id of ['prism', 'openrgb:RainbowWave', 'org.example.lights/sunset']) toggleFavorite(storage, id);
  const favorites = readFavorites(storage); assert.equal(favorites.length, 3);
  const renamed = [{id: 'prism', name: 'Новое имя', source: 'rayloom'}];
  assert.deepEqual(filterLibrary(renamed, {source: 'favorites'}, favorites), renamed);
  assert(readFavorites(storage).includes('org.example.lights/sunset'));
  assert.deepEqual(toggleFavorite(storage, 'prism'), ['openrgb:RainbowWave', 'org.example.lights/sunset']);
});
test('favorite filter composes with search/category and never mutates records', () => {
  const items = [{id: 'openrgb:Wave', name: 'Радуга', category: 'Rainbow', source: 'openrgb'}, {id: 'prism', name: 'Призма', source: 'rayloom'}], before = structuredClone(items);
  assert.equal(filterLibrary(items, {source: 'favorites', query: ' раду ', category: 'Rainbow'}, ['openrgb:Wave']).length, 1);
  assert.equal(filterLibrary(items, {source: 'favorites', query: 'Призма'}, ['openrgb:Wave']).length, 0);
  assert.deepEqual(items, before);
});
test('malformed favorites are safe and failed writes preserve the saved list', () => {
  const storage = new Storage(); storage.setItem(FAVORITES_KEY, 'broken'); assert.deepEqual(readFavorites(storage), []);
  storage.setItem(FAVORITES_KEY, JSON.stringify({version: 1, ids: ['prism', null, 'prism', {}, 'bad id']})); assert.deepEqual(readFavorites(storage), ['prism']);
  storage.setItem = () => { throw Error('quota'); }; assert.throws(() => toggleFavorite(storage, 'wave'), /quota/); assert.deepEqual(readFavorites(storage), ['prism']);
});
test('library contexts and native editor selection are separate and bounded', () => {
  const storage = new Storage(); storage.setItem(libraryViewKey(false), JSON.stringify({query: 'сияние', source: 'favorites', category: 'all'}));
  assert.equal(readLibraryView(storage).source, 'favorites'); assert.equal(readLibraryView(storage, true).query, '');
  storage.setItem(libraryViewKey(false), JSON.stringify({source: 'lumen'}));
  assert.equal(readLibraryView(storage).source, 'rayloom');
  storage.setItem(editorViewKey('virtual'), JSON.stringify({selected: 3, library: false, sceneName: 'Мои слои'}));
  assert.equal(readEditorView(storage, 'virtual').selected, 3); assert.equal(readEditorView(storage, 'hardware').selected, 0);
});
test('native draft survives closing the session and damaged drafts remain recoverable', () => {
  const session = new Storage(), persistent = new Storage(), key = advancedDraftKey('virtual'); session.setItem(key, '{broken');
  migrateSessionDraft(session, persistent, 'virtual'); assert.equal(session.getItem(key), null); assert.equal(persistent.getItem(key), '{broken');
  const restored = readAdvancedDraft(persistent, 'virtual', []); assert.equal(restored.recovery.raw, '{broken');
  session.setItem(key, 'stale'); persistent.removeItem(key); migrateSessionDraft(session, persistent, 'virtual'); assert.equal(persistent.getItem(key), null, 'applied drafts cannot be resurrected from old session data');
});
test('migration keeps both conflicting drafts without replacing older recovery copies', () => {
  const session = new Storage(), persistent = new Storage(), key = advancedDraftKey('hardware'); session.setItem(key, 'session'); persistent.setItem(key, 'durable');
  const recoveryKey = `${key}.session-conflict.recovery`;
  persistent.setItem(recoveryKey, 'older recovery');
  migrateSessionDraft(session, persistent, 'hardware');
  assert.equal(persistent.getItem(key), 'durable');
  assert.equal(persistent.getItem(recoveryKey), 'older recovery');
  assert.equal(persistent.getItem(`${recoveryKey}.2`), 'session');
  assert.equal(session.getItem(key), null);
});
test('failed conflict backup leaves both drafts intact and can be retried', () => {
  const session = new Storage(), persistent = new Storage(), key = advancedDraftKey('hardware'), recoveryKey = `${key}.session-conflict.recovery`;
  session.setItem(key, 'recover me'); persistent.setItem(key, 'durable');
  const setItem = persistent.setItem.bind(persistent);
  persistent.setItem = (target, value) => { if (target === recoveryKey) throw Error('backup full'); setItem(target, value); };
  assert.throws(() => migrateSessionDraft(session, persistent, 'hardware'), /backup full/);
  assert.equal(session.getItem(key), 'recover me');
  assert.equal(persistent.getItem(key), 'durable');
  assert.equal(persistent.getItem(`${key}.session-imported`), null);
  persistent.setItem = (target, value) => { if (target === `${key}.session-imported`) throw Error('marker full'); setItem(target, value); };
  assert.throws(() => migrateSessionDraft(session, persistent, 'hardware'), /marker full/);
  assert.equal(session.getItem(key), 'recover me');
  assert.equal(persistent.getItem(recoveryKey), 'recover me');
  persistent.setItem = setItem;
  migrateSessionDraft(session, persistent, 'hardware');
  assert.equal(persistent.getItem(key), 'durable');
  assert.equal(persistent.getItem(recoveryKey), 'recover me');
  assert.equal(persistent.getItem(`${recoveryKey}.2`), null, 'retry reuses the existing identical backup');
  assert.equal(session.getItem(key), null);
});
test('migration never deletes the source when initial persistence fails', () => {
  const session = new Storage(), key = advancedDraftKey('hardware');
  const failed = new Storage(); failed.setItem = () => { throw Error('disk full'); }; session.setItem(key, 'recover me');
  assert.throws(() => migrateSessionDraft(session, failed, 'hardware'), /disk full/); assert.equal(session.getItem(key), 'recover me');
});
