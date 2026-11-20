import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FOODS, formatPortion } from '../js/foods.js';
import { DIETS, SCHEDULES, getDiet, getSchedule } from '../js/diets.js';
import { dailyTargets } from '../js/nutrition.js';
import { planDay } from '../js/planner.js';

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

test('liked foods are used and disliked foods never are', () => {
  const liked = ['chicken_breast', 'salmon', 'eggs', 'greek_yogurt', 'brown_rice', 'oats', 'sweet_potato', 'broccoli', 'spinach', 'blueberries', 'banana', 'olive_oil', 'almonds', 'avocado'];
  const p = { ...profile, liked, disliked: ['tilapia'] };
  for (const date of ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) {
    const day = plan(p, 'highprotein', 'three_snack', { date });
    for (const m of day.meals) for (const i of m.items) {
      assert.notEqual(i.food.id, 'tilapia');
      assert.ok(liked.includes(i.food.id), `${date} ${m.id} used unliked ${i.food.id}`);
    }
  }
});

test('portions are measurable amounts', () => {
  const eggs = BUILTIN_FOODS.find((f) => f.id === 'eggs');
  assert.equal(formatPortion(eggs, 150), '3 eggs (150 g)');
  const rice = BUILTIN_FOODS.find((f) => f.id === 'brown_rice');
  assert.equal(formatPortion(rice, 292.5), '1½ cups (293 g)');
});
