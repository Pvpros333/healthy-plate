// Diets are data, not code paths. The planner reads:
//   macros        share of calories (protein/carbs/fat, sums to 1) before the protein priority is applied
//   exclude       food tags that are never planned
//   prefer        food tags that are picked more often
//   limit         food tags that are picked less often
//   carbMaxG / proteinMaxPct / sodiumMaxMg   optional hard caps

export const DIETS = [
  {
    id: 'highprotein',
    name: 'High-Protein Balanced',
    summary: 'A steady calorie deficit with plenty of protein to keep muscle. Nothing is off-limits; processed food and sweets are kept rare.',
    why: 'Higher protein in a deficit keeps more lean mass and keeps you fuller. Well supported for people who lift.',
    macros: { protein: 0.35, carbs: 0.35, fat: 0.3 },
    exclude: [],
    prefer: ['lean'],
    limit: ['processed', 'sugar'],
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    summary: 'Fish, olive oil, beans, whole grains, vegetables, fruit and nuts. Red meat and processed food only now and then.',
    why: 'One of the most studied eating patterns for heart health and long-term weight control.',
    macros: { protein: 0.25, carbs: 0.45, fat: 0.3 },
    exclude: [],
    prefer: ['fish', 'legume', 'oliveoil', 'wholegrain', 'nuts'],
    limit: ['redmeat', 'processed', 'sugar', 'butter'],
  },
  {
    id: 'dash',
    name: 'DASH',
    summary: 'Lots of vegetables, fruit, whole grains and low-fat dairy; low in salt, red meat and sweets.',
    why: 'Designed to lower blood pressure; also works well for weight loss.',
    macros: { protein: 0.22, carbs: 0.53, fat: 0.25 },
    sodiumMaxMg: 1500,
    exclude: [],
    prefer: ['wholegrain', 'lowfatdairy', 'legume', 'nuts'],
    limit: ['redmeat', 'processed', 'sugar', 'salty', 'butter'],
  },
  {
    id: 'lowcarb',
    name: 'Low-Carb',
    summary: 'Around 100 g of carbs a day or less. Protein, vegetables and healthy fats fill the plate; no sugar or refined grains.',
    why: 'Helps many people control appetite and blood sugar while losing fat.',
    macros: { protein: 0.35, carbs: 0.2, fat: 0.45 },
    carbMaxG: 110,
    exclude: ['sugar', 'refinedgrain'],
    prefer: ['lean', 'nonstarchy'],
    limit: ['grain', 'starchy', 'fruit'],
  },
  {
    id: 'keto',
    name: 'Keto',
    summary: 'Very low carb (about 30 g net carbs a day), high fat, moderate protein. No grains, beans, starchy vegetables, sugar or most fruit.',
    why: 'Puts the body into ketosis; some people find it makes hunger much easier to manage.',
    macros: { protein: 0.25, carbs: 0.05, fat: 0.7 },
    carbMaxG: 30,
    proteinMaxPct: 0.3,
    exclude: ['grain', 'legume', 'starchy', 'fruit', 'sugar'],
    prefer: ['nonstarchy'],
    limit: ['lowfatdairy'],
  },
  {
    id: 'paleo',
    name: 'Paleo',
    summary: 'Meat, fish, eggs, vegetables, fruit, nuts and healthy oils. No grains, beans, dairy or processed food.',
    why: 'Cuts out most processed and high-calorie packaged foods, which makes a deficit easier.',
    macros: { protein: 0.3, carbs: 0.3, fat: 0.4 },
    exclude: ['grain', 'legume', 'dairy', 'processed', 'sugar'],
    prefer: ['lean', 'nonstarchy'],
    limit: [],
  },
];

// Meal schedules are chosen separately from the diet, so intermittent fasting works with any diet.
export const SCHEDULES = [
  {
    id: 'three_snack',
    name: '3 meals + 1 snack',
    meals: [
      { id: 'breakfast', label: 'Breakfast', share: 0.25 },
      { id: 'lunch', label: 'Lunch', share: 0.3 },
      { id: 'dinner', label: 'Dinner', share: 0.3 },
      { id: 'snack1', label: 'Snack', share: 0.15, type: 'snack' },
    ],
  },
  {
    id: 'three_two',
    name: '3 meals + 2 snacks',
    meals: [
      { id: 'breakfast', label: 'Breakfast', share: 0.22 },
      { id: 'snack1', label: 'Morning snack', share: 0.1, type: 'snack' },
      { id: 'lunch', label: 'Lunch', share: 0.27 },
      { id: 'snack2', label: 'Afternoon snack', share: 0.11, type: 'snack' },
      { id: 'dinner', label: 'Dinner', share: 0.3 },
    ],
  },
  {
    id: 'if168',
    name: 'Intermittent fasting 16:8 (eat noon–8 pm)',
    note: 'Eat only between noon and 8 pm. Water, black coffee and plain tea are fine while fasting.',
    meals: [
      { id: 'lunch', label: 'First meal (noon)', share: 0.4 },
      { id: 'snack1', label: 'Snack (3–4 pm)', share: 0.15, type: 'snack' },
      { id: 'dinner', label: 'Last meal (by 8 pm)', share: 0.45 },
    ],
  },
  {
    id: 'two',
    name: '2 meals (no snacks)',
    meals: [
      { id: 'lunch', label: 'Meal 1', share: 0.5 },
      { id: 'dinner', label: 'Meal 2', share: 0.5 },
    ],
  },
];

export function getDiet(id) {
  return DIETS.find((d) => d.id === id) || DIETS[0];
}

export function getSchedule(id) {
  return SCHEDULES.find((s) => s.id === id) || SCHEDULES[0];
}

export function dietAllows(diet, food) {
  return !food.tags.some((t) => diet.exclude.includes(t));
}
