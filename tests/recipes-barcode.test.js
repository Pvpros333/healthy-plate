import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FOODS, nutrientsFor, toGrams } from '../js/foods.js';
import { recipeTotals, perServing, buildRecipeFood } from '../js/recipes.js';
import { offToFood, cleanCode } from '../js/barcode.js';

const byId = (id) => BUILTIN_FOODS.find((f) => f.id === id);
const ing = (foodId, qty, unit) => ({ foodId, qty, unit, grams: toGrams(byId(foodId), qty, unit) });

test('recipe nutrition per serving matches the sum of its ingredients', () => {
  const ingredients = [ing('ground_turkey', 16, 'oz'), ing('black_beans', 2, 'cup'), ing('tomato', 2, 'cup'), ing('onion', 1, 'onion'), ing('olive_oil', 1, 'tbsp')];
  const totals = recipeTotals(ingredients, byId);
  const expectKcal = ingredients.reduce((s, i) => s + nutrientsFor(byId(i.foodId), i.grams).kcal, 0);
  assert.ok(Math.abs(totals.kcal - expectKcal) < 0.01);

  const food = buildRecipeFood({ name: 'Turkey chili', servings: 4, servingName: 'bowl', ingredients, role: 'protein', meals: 'm' }, byId);
  const bowl = nutrientsFor(food, food.units.bowl);
  assert.ok(Math.abs(bowl.kcal - totals.kcal / 4) < 0.01);
  assert.ok(Math.abs(bowl.protein - perServing(totals, 4).protein) < 0.01);
  assert.equal(food.show, 'bowl');
  assert.equal(food.units.serving, food.units.bowl);
  assert.equal(food.recipe.ingredients.length, 5);
  assert.equal(food.meals, 'm');
});

test('a recipe with no ingredients is refused', () => {
  assert.throws(() => buildRecipeFood({ name: 'Empty', servings: 2, ingredients: [] }, byId));
});

test('Open Food Facts product maps to a per-100 g food', () => {
  const food = offToFood('3017620422003', {
    product_name: 'Nutella', brands: 'Ferrero, Nutella', serving_quantity: 15, serving_size: '15 g',
    nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, fiber_100g: 0, sodium_100g: 0.0428 },
  });
  assert.equal(food.id, 'off_3017620422003');
  assert.equal(food.name, 'Nutella (Ferrero)');
  assert.equal(food.kcal, 539);
  assert.ok(Math.abs(food.sodium - 42.8) < 0.01, 'sodium converted g → mg');
  assert.equal(food.units.serving, 15);
  assert.equal(food.show, 'serving');
});

test('energy in kJ only is converted, and empty products are rejected', () => {
  const food = offToFood('123456789012', { product_name: 'X', nutriments: { energy_100g: 418.4, proteins_100g: 1 } });
  assert.ok(Math.abs(food.kcal - 100) < 0.01);
  assert.equal(offToFood('123456789012', { product_name: 'Nothing', nutriments: {} }), null);
});

test('barcode cleanup', () => {
  assert.equal(cleanCode(' 0 12345 67890 5 '), '012345678905');
  assert.equal(cleanCode('1234'), null);
});
