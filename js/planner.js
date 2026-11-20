// Builds a day of meals from the foods a user likes, following their diet's rules
// and sized to hit their calorie and macro targets.
//
// The plan is deterministic: the same user, date and `variant` always give the same plan,
// so it doesn't change every time the page reloads. "Shuffle" just bumps `variant`.

import { dietAllows } from './diets.js';
import { nutrientsFor, unitsFor } from './foods.js';
import { sumNutrients } from './nutrition.js';

// Largest sensible portion per food (grams). Anything not listed uses the role default.
const MAX_G = {
  eggs: 200, egg_whites: 250, whey: 62, greek_yogurt: 340, cottage_cheese: 340, turkey_deli: 170, beef_jerky: 56, tuna_can: 284,
  oats: 120, ww_bread: 96, corn_tortilla: 104, ww_tortilla: 135, rice_cakes: 36, popcorn: 40,
  olive_oil: 27, butter: 21, almonds: 57, walnuts: 43, peanut_butter: 48, chia: 36, cheddar: 57, mozzarella: 57, feta: 57,
  avocado: 136, hummus: 90, dark_chocolate: 28,
};
const ROLE_MAX = { protein: 300, carb: 350, fat: 40, veg: 200, fruit: 200 };
const ROLE_MIN = { protein: 60, carb: 30, fat: 5, veg: 30, fruit: 60 };

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function seededRandom(seedStr) {
  let a = hashString(seedStr);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(rand, options) {
  const total = options.reduce((s, o) => s + o.w, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const o of options) {
    r -= o.w;
    if (r <= 0) return o.food;
  }
  return options[options.length - 1].food;
}

// Foods the planner may use for a role at a meal type, with pick weights.
export function candidates(foods, { role, mealType, diet, profile, used }) {
  const liked = new Set(profile.liked || []);
  const disliked = new Set(profile.disliked || []);
  const pool = foods.filter(
    (f) => f.role === role && (f.meals || '').includes(mealType) && dietAllows(diet, f) && !disliked.has(f.id),
  );
  const anyLiked = pool.some((f) => liked.has(f.id));
  const onlyLiked = profile.onlyLiked !== false;
  return pool
    .map((food) => {
      let w = 1;
      if (anyLiked && !liked.has(food.id)) w = onlyLiked ? 0 : 0.15;
      for (const t of food.tags) {
        if (diet.prefer.includes(t)) w *= 2.5;
        if (diet.limit.includes(t)) w *= 0.35;
      }
      // High-fat diets (keto, low-carb) lean toward fattier proteins like salmon, eggs and thighs.
      if (role === 'protein' && diet.macros.fat >= 0.45 && food.protein > 0) w *= 1 + (food.fat / food.protein) * 3;
      if (used.has(food.id)) w *= 0.1;
      return { food, w };
    })
    .filter((o) => o.w > 0);
}

// Big meals (2-meal days, keto) may use bigger portions than the usual caps.
function maxFor(food, scale = 1) {
  return (MAX_G[food.id] ?? ROLE_MAX[food.role] ?? 300) * scale;
}

function minFor(food) {
  return Math.min(ROLE_MIN[food.role] ?? 10, maxFor(food));
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// A "normal" serving of a vegetable or fruit.
function standardServing(food) {
  const u = unitsFor(food);
  if (food.role === 'veg') {
    const cup = u.cup || 100;
    return clamp(cup < 60 ? cup * 2 : cup, 60, 180);
  }
  const piece = Object.entries(food.units || {}).find(([k]) => k !== 'cup');
  return clamp(piece ? piece[1] : u.cup || 120, 80, 180);
}

// Round to something you can actually measure: whole eggs/slices/scoops, ¼ cups, ½ tbsp, ½ oz.
export function roundPortion(food, grams) {
  const unit = food.show;
  const per = unitsFor(food)[unit];
  if (!per || unit === 'g') return Math.max(5, Math.round(grams / 5) * 5);
  let step = 1;
  if (unit === 'cup') step = 0.25;
  else if (unit === 'tbsp' || unit === 'oz') step = 0.5;
  const n = Math.max(step, Math.round(grams / per / step) * step);
  return n * per;
}

// Size portions so the meal lands near its targets.
// Vegetables and fruit get a standard serving; protein foods cover protein,
// carb foods cover carbs, and the fat food fills the remaining calories.
export function sizeMeal(items, target) {
  const scale = clamp(target.kcal / 700, 1, 1.6);
  for (const it of items) it.grams = it.food.role === 'veg' || it.food.role === 'fruit' ? standardServing(it.food) : minFor(it.food);

  const others = (skip) => sumNutrients(items.filter((i) => i !== skip).map((i) => nutrientsFor(i.food, i.grams)));
  for (let pass = 0; pass < 4; pass++) {
    for (const it of items) {
      const f = it.food;
      const o = others(it);
      let g = it.grams;
      if (f.role === 'protein' && f.protein > 0) g = ((target.protein - o.protein) / f.protein) * 100;
      else if (f.role === 'carb' && f.carbs > 0) g = ((target.carbs - o.carbs) / f.carbs) * 100;
      else if (f.role === 'fat' && f.kcal > 0) g = ((target.kcal - o.kcal) / f.kcal) * 100;
      else continue;
      it.grams = clamp(g, minFor(f), maxFor(f, scale));
    }
  }

  // If calories are already covered, the fat item isn't needed.
  const fatItem = items.find((i) => i.food.role === 'fat');
  if (fatItem) {
    const o = others(fatItem);
    if (target.kcal - o.kcal < fatItem.food.kcal * 0.05) items.splice(items.indexOf(fatItem), 1);
  }

  for (const it of items) it.grams = roundPortion(it.food, it.grams);
  // Drop extra fat foods too small to bother with (e.g. ½ tbsp peanut butter).
  for (const it of [...items]) {
    if (it.food.role === 'fat' && nutrientsFor(it.food, it.grams).kcal < 45) items.splice(items.indexOf(it), 1);
  }
  return items;
}

const SHORT = (name) => name.replace(/\s*\(.*?\)\s*/g, '').replace(/,.*$/, '').trim();

function mealTitle(items) {
  const by = (r) => items.filter((i) => i.food.role === r).map((i) => SHORT(i.food.name).toLowerCase());
  const main = by('protein');
  const cooking = new Set(['olive_oil', 'butter']);
  const fats = items.filter((i) => i.food.role === 'fat' && !cooking.has(i.food.id)).map((i) => SHORT(i.food.name).toLowerCase());
  const sides = [...by('carb'), ...by('veg'), ...by('fruit'), ...fats];
  const name = main.length ? main.join(' + ') : sides.shift() || 'Meal';
  const title = sides.length ? `${name} with ${sides.slice(0, -1).join(', ')}${sides.length > 1 ? ' & ' : ''}${sides[sides.length - 1]}` : name;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// variant reshuffles the whole day; mealVariants ({ lunch: 2 }) reshuffles single meals.
export function planDay({ profile, diet, schedule, targets, foods, date, variant = 0, mealVariants = {} }) {
  const used = new Set();
  const veryLowCarb = (diet.carbMaxG || 999) <= 50;

  const meals = schedule.meals.map((slot) => {
    const rand = seededRandom(`${profile.id}|${date}|${variant}|${diet.id}|${schedule.id}|${slot.id}|${mealVariants[slot.id] || 0}`);
    const type = slot.type === 'snack' ? 's' : slot.id === 'breakfast' ? 'b' : 'm';
    const target = {
      kcal: targets.kcal * slot.share,
      protein: targets.protein * slot.share,
      carbs: targets.carbs * slot.share,
      fat: targets.fat * slot.share,
    };

    let roles;
    if (type === 's') roles = veryLowCarb ? ['protein', 'fat'] : ['protein', rand() < 0.5 ? 'fruit' : 'fat'];
    else if (type === 'b') roles = veryLowCarb ? ['protein', 'veg', 'fat'] : ['protein', 'carb', 'fruit', 'fat'];
    else roles = veryLowCarb ? ['protein', 'veg', 'fat'] : ['protein', 'carb', 'veg', 'fat'];

    const items = [];
    for (const role of roles) {
      const opts = candidates(foods, { role, mealType: type, diet, profile, used: new Set([...used, ...items.map((i) => i.food.id)]) });
      const food = weightedPick(rand, opts);
      if (food) items.push({ food, grams: 0 });
    }
    sizeMeal(items, target);

    const totalsOf = () => sumNutrients(items.map((i) => nutrientsFor(i.food, i.grams)));
    const addExtra = (role, filter = () => true) => {
      const inMeal = new Set(items.map((i) => i.food.id));
      const opts = candidates(foods, { role, mealType: type, diet, profile, used: inMeal })
        .filter((o) => !inMeal.has(o.food.id) && filter(o.food));
      const food = weightedPick(rand, opts);
      if (!food) return false;
      items.push({ food, grams: 0 });
      sizeMeal(items, target);
      return true;
    };

    // Breakfast and snacks with a small-portion protein (eggs, yogurt) can fall short: add a lean booster.
    if (type !== 'm' && target.protein - totalsOf().protein > 10) addExtra('protein', (f) => f.tags.includes('lean'));
    // Portion caps can leave a meal well under its calories (common on keto): add up to two more fat foods.
    for (let i = 0; i < 2 && totalsOf().kcal < target.kcal * 0.9; i++) if (!addExtra('fat')) break;

    items.forEach((i) => used.add(i.food.id));
    const totals = sumNutrients(items.map((i) => nutrientsFor(i.food, i.grams)));
    return { id: slot.id, label: slot.label, title: mealTitle(items), items, target, totals };
  });

  return { date, meals, totals: sumNutrients(meals.map((m) => m.totals)) };
}
