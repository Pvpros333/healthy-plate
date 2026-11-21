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
  // kcalAdjust comes from the Progress coach (e.g. −150 after a plateau); the floor still applies.
  const target = Math.max(maintenance - deficit + (profile.kcalAdjust || 0), calorieFloor(profile.sex));
  return Math.round(target / 10) * 10;
}

// Gym-day calorie cycling: ~10% more food (as carbs) on training days, the same amount taken
// back across rest days, so the weekly total is unchanged. Off for very-low-carb diets.
export function cycleShift(profile, diet, dayType) {
  const gymDays = (profile.gymDays || []).length;
  if (!profile.cycleCalories || !dayType || gymDays === 0 || gymDays === 7 || (diet.carbMaxG || 999) <= 50) return 0;
  const bonus = Math.round((calorieTarget(profile) * 0.1) / 10) * 10;
  return dayType === 'gym' ? bonus : -Math.round((bonus * gymDays) / (7 - gymDays) / 10) * 10;
}

// Protein priority for keeping muscle in a deficit: grams per lb of goal weight
// (goal weight is a better stand-in for lean mass than current weight when someone carries extra fat).
export function proteinTarget(profile) {
  const base = profile.goalWeightLb && profile.goalWeightLb < profile.weightLb ? profile.goalWeightLb : profile.weightLb;
  const perLb = (profile.liftDays ?? 0) >= 2 ? 0.9 : 0.75;
  return Math.round(base * perLb);
}

// Full daily targets for a profile on a diet. dayType ('gym' | 'rest') applies calorie cycling if it's on.
export function dailyTargets(profile, diet, dayType = null) {
  const base = calorieTarget(profile);
  const kcal = Math.max(base + cycleShift(profile, diet, dayType), calorieFloor(profile.sex));
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
    baseKcal: base,
    shift: kcal - base,
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

// Daily water goal in fl oz: about half your body weight (lb), within 64–128 oz.
export function waterGoal(profile) {
  return Math.min(128, Math.max(64, Math.round((profile.weightLb || 0) / 2 / 8) * 8));
}

// Least-squares slope of weight over time, in lb per week. points: [{ date: 'YYYY-MM-DD', lb }]
export function weeklyRate(points) {
  if (points.length < 2) return null;
  const xs = points.map((p) => Date.parse(p.date) / 864e5 / 7);
  const ys = points.map((p) => p.lb);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : null;
}

// Weekly coach. Looks at the last 4 weeks of weigh-ins, waist and how consistently food was logged,
// and suggests a calorie change only when it's warranted.
//   weights: [{ date, lb, waist? }] sorted; loggedDays: days with food logged in the last 14; today: 'YYYY-MM-DD'
// Returns { status, title, detail, adjust } where adjust is a suggested kcal change (or 0).
export function coachAdvice(profile, weights, loggedDays, today) {
  const cutoff = new Date(Date.parse(today) - 28 * 864e5).toISOString().slice(0, 10);
  const recent = weights.filter((w) => w.lb && w.date >= cutoff && w.date <= today);
  const span = recent.length ? (Date.parse(recent[recent.length - 1].date) - Date.parse(recent[0].date)) / 864e5 : 0;
  if (recent.length < 3 || span < 14) {
    return { status: 'wait', title: 'Keep weighing in', detail: 'Weigh in at least once a week. After two weeks and three weigh-ins the coach can tell whether your calories need adjusting.', adjust: 0 };
  }
  const rate = weeklyRate(recent);
  const waists = weights.filter((w) => w.waist && w.date >= cutoff);
  const waistDrop = waists.length >= 2 ? waists[0].waist - waists[waists.length - 1].waist : 0;
  const pct = (-rate / profile.weightLb) * 100; // % body weight lost per week
  const rateText = `${rate <= 0 ? 'losing' : 'gaining'} ${Math.abs(rate).toFixed(1)} lb/week over the last ${Math.round(span / 7)} weeks`;

  if (profile.goal === 'maintain') {
    if (Math.abs(rate) <= 0.5) return { status: 'good', title: 'Holding steady', detail: `You're ${rateText} — right where maintenance should be.`, adjust: 0 };
    return { status: 'adjust', title: rate < 0 ? 'Weight is drifting down' : 'Weight is drifting up', detail: `You're ${rateText}.`, adjust: rate < 0 ? 150 : -150 };
  }
  if (pct > 1.0) {
    return { status: 'adjust', title: 'Losing faster than ideal', detail: `You're ${rateText} (${pct.toFixed(1)}% of body weight a week). Faster than about 1% a week tends to cost muscle and energy. Eating a little more protects your gym progress.`, adjust: 150 };
  }
  const stalled = profile.goal === 'recomp' ? rate > 0.25 && waistDrop < 0.25 : rate > -0.25 && waistDrop < 0.5;
  if (stalled) {
    if (loggedDays < 10) {
      return { status: 'log', title: 'Progress has slowed — log more first', detail: `You're ${rateText}, but food was logged on only ${loggedDays} of the last 14 days. Unlogged bites, drinks and weekends are the most common reason for a stall. Log every day for two weeks before cutting calories.`, adjust: 0 };
    }
    return { status: 'adjust', title: 'Plateau — time for a small adjustment', detail: `You're ${rateText} and your waist hasn't dropped, even with consistent logging. A small cut restarts progress without hurting your workouts.`, adjust: -150 };
  }
  if (profile.goal === 'recomp' && waistDrop >= 0.25) {
    return { status: 'good', title: 'Recomp is working', detail: `Weight is about steady but your waist is down ${waistDrop.toFixed(1)}". That's fat loss while you build muscle.`, adjust: 0 };
  }
  return { status: 'good', title: 'Right on track', detail: `You're ${rateText}${waistDrop > 0 ? ` and your waist is down ${waistDrop.toFixed(1)}"` : ''}. Keep doing exactly what you're doing.`, adjust: 0 };
}
