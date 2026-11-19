// Puffin Vice 3D — localStorage save games.
// One slot: cash, story progress, position and which car (if any) the player
// was driving is too fragile to restore, so a loaded game always starts on
// foot near where it was saved.

const KEY = 'puffin-vice-3d-save-v1';

export function saveGame(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      cash: Math.round(data.cash),
      missionIndex: data.missionIndex,
      chainDone: !!data.chainDone,
      x: Math.round(data.x * 10) / 10,
      z: Math.round(data.z * 10) / 10,
      when: Date.now(),
    }));
    return true;
  } catch {
    return false; // storage full or blocked: saving is best-effort
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.cash !== 'number' || typeof data.x !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave() {
  return loadGame() !== null;
}
