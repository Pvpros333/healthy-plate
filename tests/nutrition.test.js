import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bmr, calorieTarget, dailyTargets, proteinTarget, tdee } from '../js/nutrition.js';
import { DIETS, getDiet } from '../js/diets.js';

const man = { sex: 'male', age: 40, heightIn: 72, weightLb: 244, goalWeightLb: 210, activity: 'moderate', liftDays: 4, goal: 'lose', lossRate: 1 };
const woman = { sex: 'female', age: 38, heightIn: 64, weightLb: 160, activity: 'light', liftDays: 0, goal: 'lose', lossRate: 2 };

test('Mifflin–St Jeor BMR', () => {
  // 10 × 110.68 kg + 6.25 × 182.88 cm − 5 × 40 + 5
  assert.equal(bmr(man), 2055);
  // 10 × 72.57 + 6.25 × 162.56 − 5 × 38 − 161
  assert.equal(bmr(woman), 1391);
});

test('deficit is capped at 25% of maintenance and never under the floor', () => {
  const t = calorieTarget(woman);
  const maintenance = tdee(woman);
  assert.ok(t >= maintenance * 0.75 - 10, `${t} vs tdee ${maintenance}`);
  assert.equal(calorieTarget({ ...woman, weightLb: 100, heightIn: 58, age: 70, activity: 'sedentary' }), 1200);
});

test('protein uses goal weight when it is below current weight', () => {
  assert.equal(proteinTarget(man), Math.round(210 * 0.9));
  assert.equal(proteinTarget({ ...man, goalWeightLb: null, liftDays: 0 }), Math.round(244 * 0.75));
});

test('macros add up to the calorie target for every diet', () => {
  for (const d of DIETS) {
    const t = dailyTargets(man, d);
    const kcal = t.protein * 4 + t.carbs * 4 + t.fat * 9;
    assert.ok(Math.abs(kcal - t.kcal) < 15, `${d.id}: ${kcal} vs ${t.kcal}`);
  }
});

test('keto caps carbs', () => {
  assert.ok(dailyTargets(man, getDiet('keto')).carbs <= 30);
});
