import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FOODS, formatPortion } from '../js/foods.js';
import { DIETS, SCHEDULES, getDiet, getSchedule } from '../js/diets.js';
import { dailyTargets } from '../js/nutrition.js';
import { planDay, templateItems } from '../js/planner.js';
import { MEALS } from '../js/meals.js';

const profile = { id: 'u1', sex: 'male', age: 40, heightIn: 72, weightLb: 244, goalWeightLb: 210, activity: 'moderate', liftDays: 4, goal: 'lose', lossRate: 1, liked: [], disliked: [] };
const plan = (p, dietId, schedId = 'three_snack', extra = {}) => {
  const diet = getDiet(dietId);
  return planDay({ profile: p, diet, schedule: getSchedule(schedId), targets: dailyTargets(p, diet), foods: BUILTIN_FOODS, date: '2026-11-19', ...extra });
};

test('every diet × schedule lands within 15% of the calorie target and never uses excluded foods', () => {
  for (const d of DIETS) {
    for (const s of SCHEDULES) {
      for (const date of ['2026-11-19', '2026-11-20', '2026-11-21']) {
        const t = dailyTargets(profile, d);
        const p = planDay({ profile, diet: d, schedule: s, targets: t, foods: BUILTIN_FOODS, date });
        const off = Math.abs(p.totals.kcal - t.kcal) / t.kcal;
        assert.ok(off < 0.15, `${d.id}/${s.id}/${date}: ${Math.round(p.totals.kcal)} vs ${t.kcal}`);
        for (const m of p.meals) for (const i of m.items) {
          assert.ok(!i.food.tags.some((tag) => d.exclude.includes(tag)), `${d.id} planned ${i.food.id}`);
        }
      }
    }
  }
});

test('keto plans stay low in net carbs', () => {
  const d = getDiet('keto');
  for (const s of SCHEDULES) for (const date of ['2026-11-19', '2026-11-20', '2026-11-21']) {
    const p = planDay({ profile, diet: d, schedule: s, targets: dailyTargets(profile, d), foods: BUILTIN_FOODS, date });
    const net = p.totals.carbs - p.totals.fiber;
    assert.ok(net <= 50, `${s.id}/${date}: ${Math.round(net)} g net carbs`);
  }
});

test('protein stays close to target', () => {
  for (const d of DIETS) {
    const t = dailyTargets(profile, d);
    const p = plan(profile, d.id);
    assert.ok(p.totals.protein >= t.protein * 0.85, `${d.id}: ${Math.round(p.totals.protein)} vs ${t.protein}`);
  }
});

test('same inputs give the same plan; variant changes it', () => {
  const a = plan(profile, 'highprotein');
  const b = plan(profile, 'highprotein');
  assert.deepEqual(a.meals.map((m) => m.title), b.meals.map((m) => m.title));
  const titles = new Set([0, 1, 2, 3, 4].map((v) => plan(profile, 'highprotein', 'three_snack', { variant: v }).meals.map((m) => m.title).join('|')));
  assert.ok(titles.size > 1);
});

test('meals are built around liked proteins, and disliked foods never appear', () => {
  const liked = ['chicken_breast', 'salmon', 'eggs', 'egg_whites', 'greek_yogurt', 'whey', 'brown_rice', 'oats', 'sweet_potato', 'broccoli', 'spinach', 'blueberries', 'banana', 'olive_oil', 'almonds', 'avocado'];
  const p = { ...profile, liked, disliked: ['tilapia', 'cheddar', 'ground_turkey'] };
  for (const date of ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']) {
    const day = plan(p, 'highprotein', 'three_snack', { date });
    for (const m of day.meals) {
      for (const i of m.items) assert.ok(!p.disliked.includes(i.food.id), `${date} ${m.id} used disliked ${i.food.id}`);
      const main = m.items.find((i) => i.solve === 'protein') || m.items.find((i) => i.food.role === 'protein');
      assert.ok(main && liked.includes(main.food.id), `${date} ${m.id} (${m.title}) main protein ${main?.food.id} not liked`);
    }
  }
});

test('meal library: every ingredient exists, and each meal has steps', () => {
  const ids = new Set(BUILTIN_FOODS.map((f) => f.id));
  for (const m of MEALS) {
    for (const i of m.ingredients) assert.ok(ids.has(i.foodId), `${m.id}: unknown food ${i.foodId}`);
    assert.ok(m.steps.length && m.ingredients.some((i) => i.solve === 'protein'), `${m.id} needs steps and a protein`);
  }
  // Plans come from the library (real meals), not ad-hoc combinations.
  const day = plan(profile, 'mediterranean');
  assert.ok(day.meals.every((m) => m.recipe), 'every meal has a recipe');
});

test('every diet has enough library meals for variety', () => {
  for (const d of DIETS) {
    for (const type of ['b', 'm', 's']) {
      const byId = new Map(BUILTIN_FOODS.map((f) => [f.id, f]));
      const n = MEALS.filter((m) => m.meals.includes(type) && templateItems(m, { diet: d, byId })).length;
      assert.ok(n >= (type === 'm' ? 8 : 4), `${d.id} has only ${n} '${type}' meals`);
    }
  }
});

test('a week of plans for a smaller eater stays on target (portions shrink to fit)', () => {
  const her = { id: 'w', sex: 'female', age: 38, heightIn: 64, weightLb: 170, goalWeightLb: 140, activity: 'light', liftDays: 2, goal: 'lose', lossRate: 1 };
  for (const d of DIETS) for (const s of SCHEDULES) for (let k = 1; k <= 7; k++) {
    const t = dailyTargets(her, d);
    const p = planDay({ profile: her, diet: d, schedule: s, targets: t, foods: BUILTIN_FOODS, date: `2026-12-0${k}` });
    assert.ok(Math.abs(p.totals.kcal - t.kcal) / t.kcal < 0.12, `${d.id}/${s.id}/day ${k}: ${Math.round(p.totals.kcal)} vs ${t.kcal}`);
    assert.ok(p.totals.protein >= t.protein * 0.85, `${d.id}/${s.id}/day ${k}: protein ${Math.round(p.totals.protein)} vs ${t.protein}`);
  }
});

test('portions are measurable amounts', () => {
  const eggs = BUILTIN_FOODS.find((f) => f.id === 'eggs');
  assert.equal(formatPortion(eggs, 150), '3 eggs (150 g)');
  const rice = BUILTIN_FOODS.find((f) => f.id === 'brown_rice');
  assert.equal(formatPortion(rice, 292.5), '1½ cups (293 g)');
});
