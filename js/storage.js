// All app data lives in one JSON object in this browser's localStorage.
// Phone and PC each keep their own copy; Backup/Restore in Profile moves data between them.

const KEY = 'healthyplate.v1';

export function emptyState() {
  return {
    version: 1,
    profiles: [],
    activeId: null,
    customFoods: [],
    logs: {}, // logs[profileId][YYYY-MM-DD] = [{ id, foodId, grams, meal }]
    weights: {}, // weights[profileId] = [{ date, lb }]
    planVariants: {}, // planVariants[profileId][date] = { all: n, <mealId>: n }
    usdaKey: '',
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.profiles)) throw new Error('This does not look like a Healthy Plate backup.');
  return { ...emptyState(), ...data };
}

export function newId(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
