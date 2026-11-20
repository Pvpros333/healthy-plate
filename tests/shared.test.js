import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FOODS } from '../js/foods.js';
import { getDiet, getSchedule, dietAllows } from '../js/diets.js';
import { dailyTargets, bodyFatNavy, composition } from '../js/nutrition.js';
import { planDay, pickSharedMeal } from '../js/planner.js';

const him = { id: 'a', sex: 'male', age: 40, heightIn: 72, weightLb: 244, goalWeightLb: 210, activity: 'moderate', liftDays: 4, goal: 'lose', lossRate: 1, diet: 'highprotein', schedule: 'three_snack', liked: ['chicken_breast', 'salmon', 'ground_turkey', 'brown_rice', 'sweet_potato', 'broccoli', 'green_beans', 'olive_oil'], disliked: [] };
const her = { id: 'b', sex: 'female', age: 38, heightIn: 64, weightLb: 170, goalWeightLb: 140, activity: 'light', liftDays: 2, goal: 'lose', lossRate: 1, diet: 'mediterranean', schedule: 'if168', liked: ['chicken_breast', 'salmon', 'shrimp', 'brown_rice', 'quinoa', 'broccoli', 'asparagus', 'olive_oil'], disliked: ['ground_turkey'] };

const planWith = (p, fixed, date) => {
  const diet = getDiet(p.diet);
  return planDay({ profile: p, diet, schedule: getSchedule(p.schedule), targets: dailyTargets(p, diet), foods: BUILTIN_FOODS, date, fixed });
};

test('shared dinner: same foods for both, each person sized to their own targets', () => {
  for (const date of ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) {
    const members = [him, her].map((p) => ({ profile: p, diet: getDiet(p.diet) }));
    const ids = pickSharedMeal({ members, foods: BUILTIN_FOODS, date, mealId: 'dinner' });
    assert.ok(!ids.includes('ground_turkey'), 'her dislike is respected');
    const a = planWith(him, { dinner: ids }, date).meals.find((m) => m.id === 'dinner');
    const b = planWith(her, { dinner: ids }, date).meals.find((m) => m.id === 'dinner');
    const core = (m) => m.items.filter((i) => !i.personal).map((i) => i.food.id).sort();
    assert.deepEqual(core(a), core(b), date);
    assert.ok(a.shared && b.shared);
    const protein = (m) => m.items.find((i) => i.food.role === 'protein').grams;
    assert.notEqual(protein(a), protein(b), 'portions differ');
    // Foods everyone likes win: chicken and salmon are the only proteins both liked.
    assert.ok(['chicken_breast', 'salmon'].includes(ids[0]), `${date}: ${ids[0]}`);
  }
});

test('shared meal with a keto member: keto person skips the starch, others keep it', () => {
  const keto = { ...her, diet: 'keto', schedule: 'three_snack' };
  const members = [him, keto].map((p) => ({ profile: p, diet: getDiet(p.diet) }));
  for (const date of ['2026-11-19', '2026-11-20', '2026-11-21']) {
    const ids = pickSharedMeal({ members, foods: BUILTIN_FOODS, date, mealId: 'dinner' });
    const k = planWith(keto, { dinner: ids }, date).meals.find((m) => m.id === 'dinner');
    const h = planWith(him, { dinner: ids }, date).meals.find((m) => m.id === 'dinner');
    assert.ok(!k.items.some((i) => i.food.role === 'carb'));
    assert.ok(h.items.some((i) => i.food.role === 'carb'));
    for (const i of k.items) assert.ok(dietAllows(getDiet('keto'), i.food), i.food.id);
  }
});

test('Navy body-fat estimate', () => {
  // Man, 72 in tall, waist 44, neck 17: 86.010·log10(27) − 70.041·log10(72) + 36.76 ≈ 29.8%
  assert.equal(bodyFatNavy({ sex: 'male', heightIn: 72, waist: 44, neck: 17 }), 29.8);
  // Woman, 64 in, waist 34, hip 42, neck 13.5: 163.205·log10(62.5) − 97.684·log10(64) − 78.387 ≈ 38.3%
  assert.equal(bodyFatNavy({ sex: 'female', heightIn: 64, waist: 34, neck: 13.5, hip: 42 }), 38.3);
  assert.equal(bodyFatNavy({ sex: 'female', heightIn: 64, waist: 34, neck: 13.5 }), null, 'women need hips');
  assert.equal(bodyFatNavy({ sex: 'male', heightIn: 72, waist: 15, neck: 17 }), null);
  const c = composition(244, 29.8);
  assert.ok(Math.abs(c.fat - 72.7) < 0.1 && Math.abs(c.lean - 171.3) < 0.1);
});
