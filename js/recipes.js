// Recipes are saved as ordinary custom foods (per 100 g, like every other food), plus a `recipe`
// field holding the ingredient list so they can be edited later.
// One serving = total ingredient weight ÷ servings, available as the unit `serving` or the recipe's own serving name.

import { nutrientsFor } from './foods.js';
import { sumNutrients } from './nutrition.js';

// ingredients: [{ foodId, qty, unit, grams }]
export function recipeTotals(ingredients, byId) {
  const parts = ingredients.map((i) => {
    const f = byId(i.foodId);
    return f ? nutrientsFor(f, i.grams) : {};
  });
  return { grams: ingredients.reduce((s, i) => s + (i.grams || 0), 0), ...sumNutrients(parts) };
}

export function perServing(totals, servings) {
  const n = Math.max(servings || 1, 0.01);
  const out = {};
  for (const k of ['grams', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sodium']) out[k] = (totals[k] || 0) / n;
  return out;
}

export function buildRecipeFood({ id, name, servings, servingName, ingredients, role = 'other', meals = '' }, byId) {
  const totals = recipeTotals(ingredients, byId);
  if (!totals.grams) throw new Error('Add at least one ingredient with an amount.');
  const k = 100 / totals.grams;
  const unit = (servingName || '').trim() || 'serving';
  const units = { [unit]: totals.grams / Math.max(servings || 1, 0.01) };
  if (unit !== 'serving') units.serving = units[unit];
  return {
    id: id || 'recipe_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || 'My recipe',
    role,
    meals: role === 'other' ? '' : meals,
    kcal: totals.kcal * k,
    protein: totals.protein * k,
    carbs: totals.carbs * k,
    fat: totals.fat * k,
    fiber: totals.fiber * k,
    sodium: totals.sodium * k,
    tags: [],
    units,
    show: unit,
    custom: true,
    recipe: { servings, servingName: unit === 'serving' ? '' : unit, ingredients: ingredients.map(({ foodId, qty, unit: u, grams }) => ({ foodId, qty, unit: u, grams })) },
  };
}
