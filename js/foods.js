// Built-in foods. Nutrition is per 100 g (cooked weight for meat, fish, grains, beans),
// rounded from USDA FoodData Central values.
//
// role   what the planner uses it for: protein | carb | veg | fruit | fat
// meals  b = breakfast, m = lunch/dinner, s = snack
// tags   used by diet rules (see diets.js)
// units  grams per unit, on top of g / oz / lb which every food has. `show` is the unit used to display plan portions.

const F = (id, name, role, meals, [kcal, protein, carbs, fat, fiber, sodium], tags, units = {}, show = 'g') => ({
  id, name, role, meals, kcal, protein, carbs, fat, fiber, sodium,
  tags: sodium >= 500 ? [...tags, 'salty'] : tags,
  units, show, builtin: true,
});

export const BUILTIN_FOODS = [
  // Proteins
  F('chicken_breast', 'Chicken breast (cooked)', 'protein', 'm', [165, 31, 0, 3.6, 0, 74], ['poultry', 'lean'], {}, 'oz'),
  F('chicken_thigh', 'Chicken thigh, skinless (cooked)', 'protein', 'm', [195, 24, 0, 10.9, 0, 88], ['poultry'], {}, 'oz'),
  F('ground_turkey', 'Ground turkey 93% lean (cooked)', 'protein', 'm', [176, 23, 0, 9, 0, 80], ['poultry', 'lean'], {}, 'oz'),
  F('ground_beef', 'Ground beef 90% lean (cooked)', 'protein', 'm', [217, 26, 0, 11.8, 0, 72], ['redmeat'], {}, 'oz'),
  F('sirloin', 'Sirloin steak (cooked)', 'protein', 'm', [207, 30, 0, 9, 0, 60], ['redmeat', 'lean'], {}, 'oz'),
  F('pork_tenderloin', 'Pork tenderloin (cooked)', 'protein', 'm', [143, 26, 0, 3.5, 0, 57], ['lean'], {}, 'oz'),
  F('salmon', 'Salmon (cooked)', 'protein', 'm', [206, 22, 0, 12.4, 0, 61], ['fish'], {}, 'oz'),
  F('tilapia', 'Tilapia (cooked)', 'protein', 'm', [128, 26, 0, 2.7, 0, 56], ['fish', 'lean'], {}, 'oz'),
  F('shrimp', 'Shrimp (cooked)', 'protein', 'm', [99, 24, 0.2, 0.3, 0, 111], ['fish', 'lean'], {}, 'oz'),
  F('tuna_can', 'Tuna, canned in water (drained)', 'protein', 'ms', [116, 25.5, 0, 0.8, 0, 338], ['fish', 'lean'], { can: 142 }, 'oz'),
  F('eggs', 'Eggs, whole', 'protein', 'b', [143, 12.6, 0.7, 9.5, 0, 142], ['egg'], { egg: 50 }, 'egg'),
  F('egg_whites', 'Egg whites', 'protein', 'b', [52, 11, 0.7, 0.2, 0, 166], ['egg', 'lean'], { cup: 243, 'egg white': 33 }, 'cup'),
  F('greek_yogurt', 'Greek yogurt, nonfat plain', 'protein', 'bs', [59, 10.3, 3.6, 0.4, 0, 36], ['dairy', 'lowfatdairy', 'lean'], { cup: 245 }, 'cup'),
  F('cottage_cheese', 'Cottage cheese, 2%', 'protein', 'bs', [81, 10.5, 4.8, 2.3, 0, 308], ['dairy', 'lowfatdairy', 'lean'], { cup: 226 }, 'cup'),
  F('whey', 'Whey protein powder', 'protein', 'bs', [390, 78, 8, 5, 0, 300], ['dairy', 'processed', 'lean'], { scoop: 31 }, 'scoop'),
  F('tofu', 'Tofu, firm', 'protein', 'm', [144, 17, 3, 8.7, 2.3, 14], ['legume', 'plant'], { cup: 252 }, 'oz'),
  F('turkey_deli', 'Deli turkey', 'protein', 'ms', [104, 17, 4, 2, 0, 1015], ['poultry', 'processed', 'lean'], { slice: 28 }, 'slice'),
  F('beef_jerky', 'Beef jerky', 'protein', 's', [410, 33, 11, 25.6, 1.8, 1785], ['redmeat', 'processed'], {}, 'oz'),

  // Carbs
  F('white_rice', 'White rice (cooked)', 'carb', 'm', [130, 2.7, 28.2, 0.3, 0.4, 1], ['grain', 'refinedgrain', 'starchy'], { cup: 158 }, 'cup'),
  F('brown_rice', 'Brown rice (cooked)', 'carb', 'm', [123, 2.7, 25.6, 1, 1.6, 4], ['grain', 'wholegrain', 'starchy'], { cup: 195 }, 'cup'),
  F('quinoa', 'Quinoa (cooked)', 'carb', 'm', [120, 4.4, 21.3, 1.9, 2.8, 7], ['grain', 'wholegrain', 'starchy'], { cup: 185 }, 'cup'),
  F('oats', 'Oats, rolled (dry)', 'carb', 'b', [379, 13.2, 67.7, 6.5, 10.1, 6], ['grain', 'wholegrain'], { cup: 81 }, 'cup'),
  F('ww_bread', 'Whole wheat bread', 'carb', 'bm', [252, 12.5, 43, 3.5, 6, 450], ['grain', 'wholegrain'], { slice: 32 }, 'slice'),
  F('ww_pasta', 'Whole wheat pasta (cooked)', 'carb', 'm', [149, 5.8, 30, 1.7, 3.9, 4], ['grain', 'wholegrain', 'starchy'], { cup: 140 }, 'cup'),
  F('corn_tortilla', 'Corn tortilla', 'carb', 'm', [218, 5.7, 44.6, 2.9, 6.3, 45], ['grain', 'wholegrain'], { tortilla: 26 }, 'tortilla'),
  F('ww_tortilla', 'Whole wheat tortilla (8")', 'carb', 'bm', [290, 9, 49, 7.5, 6, 650], ['grain', 'wholegrain'], { tortilla: 45 }, 'tortilla'),
  F('sweet_potato', 'Sweet potato (baked)', 'carb', 'm', [90, 2, 20.7, 0.2, 3.3, 36], ['starchy'], { potato: 130 }, 'g'),
  F('potato', 'Potato (baked)', 'carb', 'm', [93, 2.5, 21, 0.1, 2.2, 10], ['starchy'], { potato: 173 }, 'g'),
  F('black_beans', 'Black beans (cooked)', 'carb', 'm', [132, 8.9, 23.7, 0.5, 8.7, 1], ['legume', 'plant'], { cup: 172 }, 'cup'),
  F('lentils', 'Lentils (cooked)', 'carb', 'm', [116, 9, 20, 0.4, 7.9, 2], ['legume', 'plant'], { cup: 198 }, 'cup'),
  F('chickpeas', 'Chickpeas (cooked)', 'carb', 'm', [164, 8.9, 27.4, 2.6, 7.6, 7], ['legume', 'plant'], { cup: 164 }, 'cup'),
  F('rice_cakes', 'Rice cakes', 'carb', 's', [387, 8.2, 81.5, 2.8, 4.2, 29], ['grain', 'wholegrain'], { cake: 9 }, 'cake'),
  F('popcorn', 'Popcorn, air-popped', 'carb', 's', [387, 13, 78, 4.5, 14.5, 8], ['grain', 'wholegrain'], { cup: 8 }, 'cup'),

  // Fruit
  F('banana', 'Banana', 'fruit', 'bs', [89, 1.1, 22.8, 0.3, 2.6, 1], ['fruit'], { banana: 118 }, 'banana'),
  F('apple', 'Apple', 'fruit', 'bs', [52, 0.3, 13.8, 0.2, 2.4, 1], ['fruit'], { apple: 182 }, 'apple'),
  F('orange', 'Orange', 'fruit', 'bs', [47, 0.9, 11.8, 0.1, 2.4, 0], ['fruit'], { orange: 131 }, 'orange'),
  F('grapes', 'Grapes', 'fruit', 's', [69, 0.7, 18.1, 0.2, 0.9, 2], ['fruit'], { cup: 151 }, 'cup'),
  F('blueberries', 'Blueberries', 'fruit', 'bs', [57, 0.7, 14.5, 0.3, 2.4, 1], ['berry'], { cup: 148 }, 'cup'),
  F('strawberries', 'Strawberries', 'fruit', 'bs', [32, 0.7, 7.7, 0.3, 2, 1], ['berry'], { cup: 152 }, 'cup'),
  F('raspberries', 'Raspberries', 'fruit', 'bs', [52, 1.2, 11.9, 0.7, 6.5, 1], ['berry'], { cup: 123 }, 'cup'),

  // Vegetables
  F('broccoli', 'Broccoli (cooked)', 'veg', 'm', [35, 2.4, 7.2, 0.4, 3.3, 41], ['nonstarchy'], { cup: 156 }, 'cup'),
  F('spinach', 'Spinach (raw)', 'veg', 'bm', [23, 2.9, 3.6, 0.4, 2.2, 79], ['nonstarchy'], { cup: 30 }, 'cup'),
  F('salad_greens', 'Mixed salad greens', 'veg', 'm', [17, 1.2, 3.3, 0.2, 2.1, 28], ['nonstarchy'], { cup: 36 }, 'cup'),
  F('green_beans', 'Green beans (cooked)', 'veg', 'm', [35, 1.9, 7.9, 0.3, 3.2, 1], ['nonstarchy'], { cup: 125 }, 'cup'),
  F('bell_pepper', 'Bell pepper', 'veg', 'bms', [26, 1, 6, 0.3, 2.1, 4], ['nonstarchy'], { pepper: 119, cup: 92 }, 'cup'),
  F('zucchini', 'Zucchini (cooked)', 'veg', 'm', [15, 1.1, 2.7, 0.4, 1, 3], ['nonstarchy'], { cup: 180 }, 'cup'),
  F('asparagus', 'Asparagus (cooked)', 'veg', 'm', [22, 2.4, 4.1, 0.2, 2, 14], ['nonstarchy'], { cup: 180 }, 'cup'),
  F('cauliflower', 'Cauliflower (cooked)', 'veg', 'm', [23, 1.8, 4.1, 0.5, 2.3, 15], ['nonstarchy'], { cup: 124 }, 'cup'),
  F('carrots', 'Carrots (raw)', 'veg', 'ms', [41, 0.9, 9.6, 0.2, 2.8, 69], [], { carrot: 61, cup: 128 }, 'cup'),
  F('tomato', 'Tomato', 'veg', 'bm', [18, 0.9, 3.9, 0.2, 1.2, 5], ['nonstarchy'], { tomato: 123, cup: 180 }, 'cup'),
  F('cucumber', 'Cucumber', 'veg', 'ms', [15, 0.7, 3.6, 0.1, 0.5, 2], ['nonstarchy'], { cup: 104 }, 'cup'),
  F('mushrooms', 'Mushrooms', 'veg', 'bm', [22, 3.1, 3.3, 0.3, 1, 5], ['nonstarchy'], { cup: 70 }, 'cup'),
  F('onion', 'Onion', 'veg', 'bm', [40, 1.1, 9.3, 0.1, 1.7, 4], [], { onion: 110, cup: 160 }, 'cup'),

  // Fats
  F('olive_oil', 'Olive oil', 'fat', 'm', [884, 0, 0, 100, 0, 2], ['oliveoil'], { tbsp: 13.5, tsp: 4.5 }, 'tbsp'),
  F('avocado', 'Avocado', 'fat', 'bms', [160, 2, 8.5, 14.7, 6.7, 7], [], { avocado: 136 }, 'avocado'),
  F('almonds', 'Almonds', 'fat', 's', [579, 21.2, 21.6, 49.9, 12.5, 1], ['nuts'], { cup: 143 }, 'oz'),
  F('walnuts', 'Walnuts', 'fat', 'bs', [654, 15.2, 13.7, 65.2, 6.7, 2], ['nuts'], { cup: 117 }, 'oz'),
  F('peanut_butter', 'Peanut butter', 'fat', 'bs', [588, 25, 20, 50, 6, 17], ['legume', 'nuts'], { tbsp: 16 }, 'tbsp'),
  F('chia', 'Chia seeds', 'fat', 'b', [486, 16.5, 42.1, 30.7, 34.4, 16], ['nuts'], { tbsp: 12 }, 'tbsp'),
  F('cheddar', 'Cheddar cheese', 'fat', 'bms', [409, 23, 2.4, 34, 0, 653], ['dairy'], { slice: 28 }, 'oz'),
  F('mozzarella', 'Mozzarella, part-skim', 'fat', 'ms', [254, 24.3, 2.8, 15.9, 0, 619], ['dairy'], { stick: 28 }, 'oz'),
  F('feta', 'Feta cheese', 'fat', 'm', [264, 14.2, 4.1, 21.3, 0, 917], ['dairy'], {}, 'oz'),
  F('butter', 'Butter', 'fat', 'bm', [717, 0.9, 0.1, 81.1, 0, 643], ['dairy', 'butter'], { tbsp: 14 }, 'tbsp'),
  F('hummus', 'Hummus', 'fat', 'ms', [166, 7.9, 14.3, 9.6, 6, 379], ['legume', 'plant'], { tbsp: 15 }, 'tbsp'),
  F('dark_chocolate', 'Dark chocolate 70–85%', 'fat', 's', [598, 7.8, 45.9, 42.6, 10.9, 20], ['sugar'], {}, 'oz'),

  // Other (not planned automatically, but available to look up and log)
  F('milk_2', 'Milk, 2%', 'other', '', [50, 3.3, 4.8, 2, 0, 47], ['dairy'], { cup: 244 }, 'cup'),
  F('almond_milk', 'Almond milk, unsweetened', 'other', '', [15, 0.6, 0.6, 1.2, 0.2, 72], ['nuts'], { cup: 240 }, 'cup'),
  F('salsa', 'Salsa', 'other', '', [36, 1.5, 6.7, 0.2, 1.9, 430], [], { tbsp: 16 }, 'tbsp'),
  F('honey', 'Honey', 'other', '', [304, 0.3, 82.4, 0, 0.2, 4], ['sugar'], { tbsp: 21 }, 'tbsp'),
];

export const COMMON_UNITS = { g: 1, oz: 28.3495, lb: 453.592 };

export function unitsFor(food) {
  return { ...COMMON_UNITS, ...(food.units || {}) };
}

export function toGrams(food, qty, unit) {
  const u = unitsFor(food)[unit];
  return u ? qty * u : qty;
}

// Nutrition for a given weight of a food.
export function nutrientsFor(food, grams) {
  const r = grams / 100;
  return {
    kcal: food.kcal * r,
    protein: food.protein * r,
    carbs: food.carbs * r,
    fat: food.fat * r,
    fiber: (food.fiber || 0) * r,
    sodium: (food.sodium || 0) * r,
  };
}

// "1.5 cups (237 g)" style label for a weight of food.
export function formatPortion(food, grams) {
  const unit = food.show && food.show !== 'g' ? food.show : null;
  const g = `${Math.round(grams)} g`;
  if (!unit) return g;
  const per = unitsFor(food)[unit];
  const n = grams / per;
  const nice = n >= 10 ? Math.round(n) : Math.round(n * 4) / 4;
  if (!nice) return g;
  const frac = (x) => {
    const whole = Math.floor(x);
    const rest = x - whole;
    const map = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
    if (!rest) return String(whole);
    return (whole ? whole : '') + (map[rest] || rest.toFixed(2));
  };
  const noPlural = ['oz', 'g', 'lb', 'tbsp', 'tsp'];
  const plural = nice > 1 && !noPlural.includes(unit) ? (/(h|o)$/.test(unit) ? unit + 'es' : unit + 's') : unit;
  return `${frac(nice)} ${plural} (${g})`;
}

// Convert a nutrition label (values per serving) into a per-100 g food.
// role/meals let a custom food be used by the meal planner.
export function foodFromLabel({ name, servingG, kcal, protein, carbs, fat, fiber = 0, sodium = 0, servingName, role = 'other', meals = '' }) {
  const k = 100 / servingG;
  const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    id, name, role, meals,
    kcal: kcal * k, protein: protein * k, carbs: carbs * k, fat: fat * k, fiber: fiber * k, sodium: sodium * k,
    tags: [], units: servingName ? { [servingName]: servingG } : { serving: servingG },
    show: servingName || 'serving', custom: true,
  };
}
