// Builds a day of meals from the foods a user likes, following their diet's rules
// and sized to hit their calorie and macro targets.
//
// The plan is deterministic: the same user, date and `variant` always give the same plan,
// so it doesn't change every time the page reloads. "Shuffle" just bumps `variant`.

import { dietAllows } from './diets.js';
import { nutrientsFor, unitsFor } from './foods.js';
import { sumNutrients } from './nutrition.js';
import { MEALS } from './meals.js';

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

// Round to something you can actually measure: whole eggs/slices/scoops, ¼ of a big item (avocado,
// potato, pepper), ¼ cups, ½ tbsp, ½ oz.
export function roundPortion(food, grams) {
  const unit = food.show;
  const per = unitsFor(food)[unit];
  if (!per || unit === 'g') return Math.max(5, Math.round(grams / 5) * 5);
  let step = 1;
  if (unit === 'cup') step = 0.25;
  else if (unit === 'tbsp' || unit === 'oz') step = 0.5;
  else if (per >= 100) step = 0.25;
  else if (per >= 60) step = 0.5;
  const n = Math.max(step, Math.round(grams / per / step) * step);
  return n * per;
}

// Which target an item is sized to: 'protein', 'carbs', 'kcal' (fills remaining calories) or null (fixed amount).
// Meal-library ingredients say so explicitly; parts picked by role default to their role.
function solveOf(it) {
  if (it.solve !== undefined) return it.solve;
  return { protein: 'protein', carb: 'carbs', fat: 'kcal' }[it.food.role] || null;
}

// Size portions so the meal lands near its targets.
// Fixed items keep their amount (vegetables and fruit get a standard serving); protein items cover
// protein, carb items cover carbs, and the fat item fills the remaining calories.
// Meal-library items carry base grams and their own min/max range (minG/maxG).
export function sizeMeal(items, target) {
  const scale = clamp(target.kcal / 700, 1, 1.6);
  for (const it of items) {
    if (it.base != null) it.grams = it.base;
    else it.grams = it.food.role === 'veg' || it.food.role === 'fruit' ? standardServing(it.food) : minFor(it.food);
  }

  const others = (skip) => sumNutrients(items.filter((i) => i !== skip).map((i) => nutrientsFor(i.food, i.grams)));
  for (let pass = 0; pass < 4; pass++) {
    for (const it of items) {
      const f = it.food;
      const solve = solveOf(it);
      if (!solve) continue;
      const per = f[solve];
      if (!(per > 0)) continue;
      const g = ((target[solve] - others(it)[solve]) / per) * 100;
      it.grams = clamp(g, it.minG ?? minFor(f), Math.min(it.maxG ?? Infinity, maxFor(f, scale)));
    }
  }

  // If calories are already covered, a calorie-filling item without its own minimum isn't needed.
  const filler = items.find((i) => solveOf(i) === 'kcal' && i.minG == null);
  if (filler && target.kcal - others(filler).kcal < filler.food.kcal * 0.05) items.splice(items.indexOf(filler), 1);

  for (const it of items) it.grams = roundPortion(it.food, it.grams);
  // Drop extra fat foods too small to bother with (e.g. ½ tbsp peanut butter).
  for (const it of [...items]) {
    if (solveOf(it) === 'kcal' && it.minG == null && nutrientsFor(it.food, it.grams).kcal < 45) items.splice(items.indexOf(it), 1);
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

const isVeryLowCarb = (diet) => (diet.carbMaxG || 999) <= 50;

function pickOption(rand, options) {
  const total = options.reduce((s, o) => s + o.w, 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const o of options) {
    r -= o.w;
    if (r <= 0) return o;
  }
  return options[options.length - 1];
}

// The person's own recipes that they chose to plan with become one-ingredient meals.
export function userMealTemplates(foods) {
  return foods
    .filter((f) => f.recipe && f.role !== 'other' && f.meals)
    .map((f) => {
      const serving = f.units?.[f.show] || f.units?.serving || 300;
      return {
        id: 'u_' + f.id,
        name: f.name,
        meals: f.meals,
        minutes: null,
        seasonings: [],
        steps: ['Your own recipe — serve the amount shown and add the sides listed.'],
        tags: ['your recipe'],
        user: true,
        ingredients: [{ foodId: f.id, g: serving, solve: f.role === 'protein' ? 'protein' : f.role === 'carb' ? 'carbs' : 'kcal', opt: false }],
      };
    });
}

// A meal-library entry turned into sized-able items for one person, or null if it can't work for them.
// Optional ingredients are dropped when the diet excludes them, the person won't eat them,
// or (on very-low-carb diets) they're a carb.
export function templateItems(tpl, { diet, disliked = new Set(), byId }) {
  const veryLowCarb = isVeryLowCarb(diet);
  const items = [];
  for (const ing of tpl.ingredients) {
    const food = byId.get(ing.foodId);
    const ok = food && dietAllows(diet, food) && !disliked.has(food.id) && !(veryLowCarb && food.role === 'carb' && ing.solve);
    if (!ok) {
      if (ing.opt) continue;
      return null;
    }
    const item = { food, base: ing.g, solve: ing.solve };
    if (ing.solve === 'protein') Object.assign(item, { minG: ing.g * 0.5, maxG: ing.g * 3 });
    else if (ing.solve === 'carbs') Object.assign(item, { minG: ing.g * 0.35, maxG: ing.g * 2.5 });
    else if (ing.solve === 'kcal') Object.assign(item, { minG: ing.g * 0.25, maxG: ing.g * 3 });
    items.push(item);
  }
  // Keto: skip meals that are carb-heavy even after the optional carbs drop out (yogurt + fruit, marinara + peppers).
  if (veryLowCarb) {
    const net = items.reduce((s, i) => { const n = nutrientsFor(i.food, i.base); return s + n.carbs - n.fiber; }, 0);
    if (net > 10) return null;
  }
  return items.length ? items : null;
}

// Meal-library options for one meal slot, weighted.
// With "only plan foods I like" on (the default), a meal's main protein must be one the person likes
// (if they've liked any proteins at all). Meals using more liked foods, and foods the diet prefers, come up more.
function templateOptions({ type, diet, profile, byId, templates, usedTpl = new Set(), usedProtein = new Set(), memberCheck }) {
  const liked = new Set(profile.liked || []);
  const disliked = new Set(profile.disliked || []);
  const onlyLiked = profile.onlyLiked !== false;
  const likesAnyProtein = [...liked].some((id) => byId.get(id)?.role === 'protein');
  const likesAnyCarb = [...liked].some((id) => byId.get(id)?.role === 'carb');
  const out = [];
  for (const tpl of templates) {
    if (!tpl.meals.includes(type) || usedTpl.has(tpl.id)) continue;
    const items = templateItems(tpl, { diet, disliked, byId });
    if (!items || (memberCheck && !memberCheck(tpl))) continue;
    const main = items.find((i) => i.solve === 'protein');
    if (onlyLiked && likesAnyProtein && main && !liked.has(main.food.id)) continue;
    let w = 1;
    const carb = items.find((i) => i.solve === 'carbs');
    if (likesAnyCarb && carb && !liked.has(carb.food.id)) w *= 0.4;
    w *= 1 + 0.4 * items.filter((i) => liked.has(i.food.id)).length;
    for (const i of items) {
      for (const t of i.food.tags) {
        if (diet.prefer.includes(t)) w *= 1.3;
        if (diet.limit.includes(t)) w *= 0.6;
      }
    }
    if (main && usedProtein.has(main.food.id)) w *= 0.15;
    if (tpl.user) w *= 2;
    out.push({ tpl, items, w });
  }
  return out;
}

// Minimum portions and rounding can leave a meal over its calories (small eaters, low-fat diets).
// Trim in order of what matters least for fat loss: calorie fillers, then fixed extras, then carbs, then protein last.
export function trimToTarget(items, target, tolerance = 1.05) {
  const kcalOf = (i) => nutrientsFor(i.food, i.grams).kcal;
  const groups = [
    { pick: (i) => solveOf(i) === 'kcal', keep: 0 },
    { pick: (i) => !solveOf(i) && i.food.role !== 'veg' && i.food.role !== 'protein', keep: 0.4 },
    { pick: (i) => solveOf(i) === 'carbs', keep: 0.4 },
    { pick: (i) => i.food.role === 'protein' || solveOf(i) === 'protein', keep: 0.75 },
  ];
  for (const g of groups) {
    const over = items.reduce((s, i) => s + kcalOf(i), 0) - target.kcal * tolerance;
    if (over <= 0) break;
    const members = items.filter(g.pick);
    const groupKcal = members.reduce((s, i) => s + kcalOf(i), 0);
    if (!groupKcal) continue;
    const cut = Math.min(over / groupKcal, 1 - g.keep);
    for (const it of members) {
      const grams = it.grams * (1 - cut);
      if (g.keep === 0 && nutrientsFor(it.food, grams).kcal < 30) items.splice(items.indexOf(it), 1);
      else it.grams = roundPortion(it.food, grams);
    }
  }
  return items;
}

// Library amounts are written for a ~500 kcal meal. Scale every non-vegetable ingredient (and its
// allowed range) toward this person's meal size first, so a 300 kcal snack-sized eater doesn't get
// a full avocado, and a 900 kcal meal isn't all chicken. Vegetables stay full-size: they're nearly free.
export function fitTemplate(items, target) {
  const baseKcal = items.reduce((s, i) => s + nutrientsFor(i.food, i.base ?? 0).kcal, 0);
  if (!baseKcal) return items;
  const factor = clamp(target.kcal / baseKcal, 0.5, 1.8);
  for (const it of items) {
    if (it.food.role === 'veg' || it.base == null) continue;
    it.base *= it.food.role === 'fruit' ? Math.min(factor, 1) : factor; // never more fruit than the recipe says

    if (it.minG != null) it.minG *= factor;
    if (it.maxG != null) it.maxG *= factor;
  }
  return items;
}

const union = (key, list) => [...new Set(list.flatMap((m) => m[key] || []))];
const combineDiets = (list) => ({
  id: 'combined',
  exclude: union('exclude', list.map((m) => m.diet)),
  prefer: union('prefer', list.map((m) => m.diet)),
  limit: union('limit', list.map((m) => m.diet)),
  macros: { fat: Math.max(...list.map((m) => m.diet.macros.fat)) },
});

// Picks a meal the household eats together: { template: id } from the meal library when one works for
// everyone, otherwise a list of food ids. planDay() sizes each person's portions to their own targets.
//   members: [{ profile, diet }]
// Every member's diet must allow the meal (optional ingredients drop out per person, e.g. keto skips the rice)
// and nobody may have marked a required ingredient "won't eat". Meals built on foods everyone likes are preferred.
export function pickSharedMeal({ members, foods, date, mealId, variant = 0 }) {
  const ids = members.map((m) => m.profile.id).sort().join(',');
  const rand = seededRandom(`shared|${ids}|${date}|${mealId}|${variant}`);
  const byId = new Map(foods.map((f) => [f.id, f]));
  const likedAll = members.map((m) => new Set(m.profile.liked || [])).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  const likedAny = union('liked', members.map((m) => m.profile));
  const disliked = union('disliked', members.map((m) => m.profile));
  const onlyLiked = members.every((m) => m.profile.onlyLiked !== false);
  const mealType = mealId === 'breakfast' ? 'b' : 'm';

  const templates = [...MEALS, ...userMealTemplates(foods)];
  const memberCheck = (tpl) => members.every((m) => templateItems(tpl, { diet: m.diet, disliked: new Set(disliked), byId }));
  const diet = combineDiets(members);
  for (const liked of [[...likedAll], likedAny]) {
    const opts = templateOptions({ type: mealType, diet: { ...diet, exclude: [] }, profile: { liked, disliked, onlyLiked }, byId, templates, memberCheck });
    const pick = pickOption(rand, opts);
    if (pick) return { template: pick.tpl.id };
  }

  // Fallback: build from parts.
  const picked = [];
  const pick = (role, group) => {
    if (!group.length) return;
    const d = combineDiets(group);
    const used = new Set(picked);
    let opts = candidates(foods, { role, mealType, diet: d, profile: { liked: [...likedAll], disliked, onlyLiked }, used });
    if (!opts.some((o) => likedAll.has(o.food.id))) {
      opts = candidates(foods, { role, mealType, diet: d, profile: { liked: likedAny, disliked, onlyLiked }, used });
    }
    const food = weightedPick(rand, opts.filter((o) => !used.has(o.food.id)));
    if (food) picked.push(food.id);
  };
  pick('protein', members);
  pick('carb', members.filter((m) => !isVeryLowCarb(m.diet)));
  pick(mealType === 'b' ? 'fruit' : 'veg', members);
  pick('fat', members);
  return picked;
}

// variant reshuffles the whole day; mealVariants ({ lunch: 2 }) reshuffles single meals.
// fixed forces a meal: { dinner: { template: id } } or { dinner: [foodIds] } (from pickSharedMeal()).
// useLibrary: false builds every meal from parts (the original planner).
export function planDay({ profile, diet, schedule, targets, foods, date, variant = 0, mealVariants = {}, fixed = {}, useLibrary = true }) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const templates = [...MEALS, ...userMealTemplates(foods)];
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const disliked = new Set(profile.disliked || []);
  const used = new Set(Object.values(fixed).filter(Array.isArray).flat());
  const usedTpl = new Set(Object.values(fixed).map((f) => f.template).filter(Boolean));
  const usedProtein = new Set();
  const veryLowCarb = isVeryLowCarb(diet);

  const meals = schedule.meals.map((slot) => {
    const rand = seededRandom(`${profile.id}|${date}|${variant}|${diet.id}|${schedule.id}|${slot.id}|${mealVariants[slot.id] || 0}`);
    const type = slot.type === 'snack' ? 's' : slot.id === 'breakfast' ? 'b' : 'm';
    const target = {
      kcal: targets.kcal * slot.share,
      protein: targets.protein * slot.share,
      carbs: targets.carbs * slot.share,
      fat: targets.fat * slot.share,
    };

    const shared = Boolean(fixed[slot.id]);
    let items = null;
    let tpl = null;
    if (shared && fixed[slot.id].template) {
      tpl = tplById.get(fixed[slot.id].template);
      items = tpl && templateItems(tpl, { diet, disliked, byId });
      if (!items) tpl = null;
    } else if (shared) {
      items = [];
      for (const id of fixed[slot.id]) {
        const food = byId.get(id);
        if (!food || !dietAllows(diet, food) || (veryLowCarb && food.role === 'carb')) continue;
        items.push({ food, grams: 0 });
      }
    }
    if (!items && useLibrary) {
      const pick = pickOption(rand, templateOptions({ type, diet, profile, byId, templates, usedTpl, usedProtein }));
      if (pick) ({ tpl, items } = pick);
    }
    if (!items) {
      items = [];
      let roles;
      if (type === 's') roles = veryLowCarb ? ['protein', 'fat'] : ['protein', rand() < 0.5 ? 'fruit' : 'fat'];
      else if (type === 'b') roles = veryLowCarb ? ['protein', 'veg', 'fat'] : ['protein', 'carb', 'fruit', 'fat'];
      else roles = veryLowCarb ? ['protein', 'veg', 'fat'] : ['protein', 'carb', 'veg', 'fat'];
      for (const role of roles) {
        const opts = candidates(foods, { role, mealType: type, diet, profile, used: new Set([...used, ...items.map((i) => i.food.id)]) });
        const food = weightedPick(rand, opts);
        if (food) items.push({ food, grams: 0 });
      }
    }
    if (tpl) fitTemplate(items, target);
    sizeMeal(items, target);

    const totalsOf = () => sumNutrients(items.map((i) => nutrientsFor(i.food, i.grams)));
    const addExtra = (role, filter = () => true) => {
      const inMeal = new Set(items.map((i) => i.food.id));
      const opts = candidates(foods, { role, mealType: type, diet, profile, used: inMeal })
        .filter((o) => !inMeal.has(o.food.id) && filter(o.food));
      const food = weightedPick(rand, opts);
      if (!food) return false;
      // In a shared meal, extras are just for this person; in a library meal they're served on the side.
      items.push({ food, grams: 0, personal: shared, side: Boolean(tpl) });
      sizeMeal(items, target);
      return true;
    };

    // Breakfast and snacks with a small-portion protein (eggs, yogurt) can fall short: add a lean booster.
    if (type !== 'm' && target.protein - totalsOf().protein > 10) addExtra('protein', (f) => f.tags.includes('lean'));
    // Lunch/dinner well short on protein (big eaters): add a lean protein side.
    if (type === 'm' && tpl && target.protein - totalsOf().protein > 15) addExtra('protein', (f) => f.tags.includes('lean'));
    // Portion caps can leave a meal well under its calories (common on keto): add up to three more fat foods.
    for (let i = 0; i < 3 && totalsOf().kcal < target.kcal * 0.9; i++) if (!addExtra('fat')) break;
    // Still short (e.g. paleo, where cheese, beans and grains are out): add a starch or fruit side.
    if (!veryLowCarb && totalsOf().kcal < target.kcal * 0.9) addExtra('carb') || addExtra('fruit');
    trimToTarget(items, target);

    items.forEach((i) => used.add(i.food.id));
    if (tpl) usedTpl.add(tpl.id);
    const main = items.find((i) => i.food.role === 'protein');
    if (main) usedProtein.add(main.food.id);
    const totals = sumNutrients(items.map((i) => nutrientsFor(i.food, i.grams)));
    const title = tpl ? tpl.name : mealTitle(items.filter((i) => !i.personal));
    const recipe = tpl ? { id: tpl.id, minutes: tpl.minutes, seasonings: tpl.seasonings, steps: tpl.steps, tags: tpl.tags, user: Boolean(tpl.user) } : null;
    return { id: slot.id, label: slot.label, title, recipe, items, target, totals, shared };
  });

  return { date, meals, totals: sumNutrients(meals.map((m) => m.totals)) };
}
