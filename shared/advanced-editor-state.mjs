import {advancedDraftKey, LEGACY_ADVANCED_DRAFT_KEY} from './advanced-draft.mjs';

// Copy first, then mark and remove the session copy. Conflicting session work
// gets its own durable recovery copy; neither version nor older backups is
// replaced. A failed write leaves the original session copy intact.
export function migrateSessionDraft(session, persistent, mode) {
  for (const key of [advancedDraftKey(mode), LEGACY_ADVANCED_DRAFT_KEY]) {
    const marker = `${key}.session-imported`;
    if (persistent.getItem(marker) !== null) continue;
    const raw = session.getItem(key);
    if (raw === null) continue;
    const durable = persistent.getItem(key);
    if (durable === null) persistent.setItem(key, raw);
    else if (durable !== raw) {
      const recoveryBase = `${key}.session-conflict.recovery`;
      let recoveryKey = recoveryBase, suffix = 2;
      while (persistent.getItem(recoveryKey) !== null && persistent.getItem(recoveryKey) !== raw) {
        recoveryKey = `${recoveryBase}.${suffix++}`;
      }
      // A previous attempt may have copied successfully and then failed to
      // write its marker. Reuse that exact copy on retry.
      if (persistent.getItem(recoveryKey) === null) persistent.setItem(recoveryKey, raw);
    }
    persistent.setItem(marker, '1');
    session.removeItem(key);
  }
}
export const editorViewKey = mode => `${advancedDraftKey(mode)}.view`;
export const replacementDraftKey = mode => `${advancedDraftKey(mode)}.before-replace`;
// Keep the previous scene available through the editor's restore action. Archive
// an older backup before updating this slot; quota failures abort replacement.
export function preserveReplacedDraft(storage, mode, scene, name) {
  const key = replacementDraftKey(mode), raw = JSON.stringify({scene, name}), previous = storage.getItem(key);
  if (previous !== null && previous !== raw) {
    let index = 2;
    while (storage.getItem(`${key}.${index}`) !== null && storage.getItem(`${key}.${index}`) !== previous) index++;
    if (storage.getItem(`${key}.${index}`) === null) storage.setItem(`${key}.${index}`, previous);
  }
  storage.setItem(key, raw);
  return {scene, name};
}
export function readReplacedDraft(storage, mode) {
  try { const saved = JSON.parse(storage.getItem(replacementDraftKey(mode)) ?? 'null'); return saved?.scene?.version === 2 && Array.isArray(saved.scene.Effects) ? saved : null; }
  catch { return null; }
}
export function readEditorView(storage, mode) {
  try {
    const view = JSON.parse(storage.getItem(editorViewKey(mode)) ?? 'null');
    return {selected: Number.isInteger(view?.selected) && view.selected >= 0 && view.selected < 64 ? view.selected : 0, library: view?.library === true, sceneName: typeof view?.sceneName === 'string' ? view.sceneName.slice(0, 100) : 'Моя сцена'};
  } catch { return {selected: 0, library: false, sceneName: 'Моя сцена'}; }
}
