import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTargets, waterGoal, weeklyRate, coachAdvice, calorieTarget } from '../js/nutrition.js';
import { getDiet } from '../js/diets.js';

const man = { sex: 'male', age: 40, heightIn: 72, weightLb: 244, goalWeightLb: 210, activity: 'moderate', liftDays: 4, goal: 'lose', lossRate: 1 };
const weeks = (lbs, waists = []) => lbs.map((lb, i) => ({ date: `2026-11-${String(1 + i * 7).padStart(2, '0')}`, lb, ...(waists[i] ? { waist: waists[i] } : {}) }));

test('gym-day cycling keeps the weekly total the same', () => {
  const p = { ...man, gymDays: [1, 3, 5, 6], cycleCalories: true };
  const d = getDiet('highprotein');
  const gym = dailyTargets(p, d, 'gym').kcal, rest = dailyTargets(p, d, 'rest').kcal;
  assert.ok(gym > rest);
  assert.ok(Math.abs(gym * 4 + rest * 3 - calorieTarget(p) * 7) <= 40);
  assert.equal(dailyTargets(p, getDiet('keto'), 'gym').kcal, calorieTarget(p), 'no cycling on keto');
  assert.equal(dailyTargets({ ...p, cycleCalories: false }, d, 'gym').kcal, calorieTarget(p));
});

test('water goal is half body weight in oz, within 64–128', () => {
  assert.equal(waterGoal(man), 120);
  assert.equal(waterGoal({ weightLb: 100 }), 64);
  assert.equal(waterGoal({ weightLb: 400 }), 128);
});

test('weekly rate is the trend slope', () => {
  assert.ok(Math.abs(weeklyRate(weeks([250, 249, 248, 247])) + 1) < 0.01);
});

test('coach: waits for data, then flags plateaus, fast loss and logging gaps', () => {
  assert.equal(coachAdvice(man, weeks([250]), 14, '2026-11-22').status, 'wait');
  const plateau = coachAdvice(man, weeks([246, 246.2, 245.9, 246.1], [44, 44, 44, 44]), 13, '2026-11-22');
  assert.equal(plateau.adjust, -150);
  assert.equal(coachAdvice(man, weeks([246, 246.2, 245.9, 246.1]), 5, '2026-11-22').status, 'log');
  assert.equal(coachAdvice(man, weeks([252, 248, 245, 242]), 14, '2026-11-22').adjust, 150);
  assert.equal(coachAdvice(man, weeks([250, 249, 248, 247]), 14, '2026-11-22').status, 'good');
  // Scale flat but waist shrinking = still progress, no cut.
  assert.equal(coachAdvice(man, weeks([246, 246, 246, 246], [44, 43.5, 43.25, 43]), 14, '2026-11-22').adjust, 0);
});

test('a coach adjustment moves the target but never below the floor', () => {
  assert.equal(calorieTarget({ ...man, kcalAdjust: -150 }), calorieTarget(man) - 150);
  const small = { sex: 'female', age: 60, heightIn: 60, weightLb: 120, activity: 'sedentary', goal: 'lose', lossRate: 1, kcalAdjust: -500 };
  assert.equal(calorieTarget(small), 1200);
});
