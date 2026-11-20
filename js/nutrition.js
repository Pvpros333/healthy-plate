// Calorie and macro target math. Every screen and the planner use these numbers.

export const LB_PER_KG = 2.20462;
export const CM_PER_IN = 2.54;

export const ACTIVITY_LEVELS = [
  { id: 'sedentary', label: 'Mostly sitting (desk job, little exercise)', factor: 1.2 },
  { id: 'light', label: 'Light (exercise 1–3 days/week)', factor: 1.375 },
  { id: 'moderate', label: 'Moderate (exercise 3–5 days/week)', factor: 1.55 },
  { id: 'very', label: 'Very active (hard exercise 6–7 days/week)', factor: 1.725 },
];

export const GOALS = [
  { id: 'lose', label: 'Lose fat' },
  { id: 'recomp', label: 'Lose fat slowly, build muscle (recomp)' },
  { id: 'maintain', label: 'Maintain weight' },
];

// Mifflin–St Jeor resting calories.
export function bmr({ sex, weightLb, heightIn, age }) {
  const kg = weightLb / LB_PER_KG;
  const cm = heightIn * CM_PER_IN;
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return Math.round(sex === 'female' ? base - 161 : base + 5);
}

export function tdee(profile) {
  const level = ACTIVITY_LEVELS.find((a) => a.id === profile.activity) || ACTIVITY_LEVELS[1];
  return Math.round(bmr(profile) * level.factor);
}

export function calorieFloor(sex) {
  return sex === 'female' ? 1200 : 1500;
}

// Daily calorie target. The deficit is capped at 25% of TDEE and never goes below the floor.
export function calorieTarget(profile) {
  const maintenance = tdee(profile);
  let deficit = 0;
  if (profile.goal === 'lose') deficit = (profile.lossRate ?? 1) * 500;
  else if (profile.goal === 'recomp') deficit = maintenance * 0.1;
  deficit = Math.min(deficit, maintenance * 0.25);
  const target = Math.max(maintenance - deficit, calorieFloor(profile.sex));
  return Math.round(target / 10) * 10;
}

// Protein priority for keeping muscle in a deficit: grams per lb of goal weight
// (goal weight is a better stand-in for lean mass than current weight when someone carries extra fat).
export function proteinTarget(profile) {
  const base = profile.goalWeightLb && profile.goalWeightLb < profile.weightLb ? profile.goalWeightLb : profile.weightLb;
  const perLb = (profile.liftDays ?? 0) >= 2 ? 0.9 : 0.75;
  return Math.round(base * perLb);
}

// Full daily targets for a profile on a diet.
export function dailyTargets(profile, diet) {
  const kcal = calorieTarget(profile);
  let protein = Math.max(proteinTarget(profile), Math.round((kcal * diet.macros.protein) / 4));
  if (diet.proteinMaxPct) protein = Math.min(protein, Math.round((kcal * diet.proteinMaxPct) / 4));
  const remaining = Math.max(kcal - protein * 4, 0);
  const cShare = diet.macros.carbs / (diet.macros.carbs + diet.macros.fat);
  let carbs = Math.round((remaining * cShare) / 4);
  if (diet.carbMaxG) carbs = Math.min(carbs, diet.carbMaxG);
  const fat = Math.round((remaining - carbs * 4) / 9);
  return {
    kcal,
    protein,
    carbs,
    fat,
    fiber: profile.sex === 'female' ? 25 : 38,
    sodium: diet.sodiumMaxMg || 2300,
    bmr: bmr(profile),
    tdee: tdee(profile),
  };
}

export function sumNutrients(items) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 };
  for (const n of items) for (const k in t) t[k] += n[k] || 0;
  return t;
}

// U.S. Navy tape-measure body-fat estimate (inches). Typically within ±3–4% of a DEXA scan;
// the trend over time is more reliable than any single reading.
// Women need a hip measurement. Returns null when measurements are missing or impossible.
export function bodyFatNavy({ sex, heightIn, waist, neck, hip }) {
  if (!heightIn || !waist || !neck) return null;
  let bf;
  if (sex === 'female') {
    if (!hip || waist + hip - neck <= 0) return null;
    bf = 163.205 * Math.log10(waist + hip - neck) - 97.684 * Math.log10(heightIn) - 78.387;
  } else {
    if (waist - neck <= 0) return null;
    bf = 86.01 * Math.log10(waist - neck) - 70.041 * Math.log10(heightIn) + 36.76;
  }
  return bf > 2 && bf < 70 ? Math.round(bf * 10) / 10 : null;
}

// Splits body weight into fat and lean mass (lb) from a body-fat %.
export function composition(weightLb, bfPct) {
  if (!weightLb || bfPct == null) return null;
  const fat = (weightLb * bfPct) / 100;
  return { fat, lean: weightLb - fat };
}
