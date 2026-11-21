# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Healthy Plate** is a personal healthy-eating app for a household. The users want to lose body fat while keeping muscle (some lift weights). It has to work on a **phone and a PC**, so it's an installable PWA: plain HTML/CSS and ES modules, with **no build step and no dependencies**.

What the owner asked for:
- **Multiple people.** Each has their own profile, stats, goal, diet, liked/disliked foods, log and weight history. Nothing about a person is hard-coded; it's all entered in the app.
- **Multiple proven diets**, chosen per person.
- **A daily plan for every meal**, built from foods that person likes.
- **Food lookup:** enter a food and quantity, see the nutrition.
- **Customizable** throughout.

## Commands

```bash
npm start                 # dev server at http://localhost:8080 (also prints a Wi-Fi URL for a phone)
npm test                  # all tests (node:test, no packages to install)
node --test --test-name-pattern="keto" tests/   # a single test by name
npm run icons             # regenerate icons/icon-192.png and icon-512.png
```

There is no lint or build. `.claude/launch.json` starts the same dev server for the Browser preview.

## Hosting

The live site is GitHub Pages, served from the `main` branch root of `Pvpros333/healthy-plate` at https://pvpros333.github.io/healthy-plate/. Pushing to `main` redeploys it. `.nojekyll` makes Pages serve the files as-is. All paths in `index.html`, `manifest.webmanifest` and `sw.js` are relative so the app works under the `/healthy-plate/` subpath; keep them relative.

## Architecture

The modules in `js/` are pure logic, except `app.js` (DOM) and `storage.js` / `usda.js` / `barcode.js` (browser APIs). Tests import the pure modules directly in Node.

- **`nutrition.js`**: the single source of the target math, plus `bodyFatNavy()` (U.S. Navy tape method; women need hips) and `composition()` (fat/lean split). Mifflin–St Jeor BMR × activity factor = TDEE, then a deficit by goal. The deficit is capped at 25% of TDEE and the target never drops below 1200 (women) / 1500 (men) kcal. Protein comes first (0.9 g/lb of goal weight if lifting ≥2 days, else 0.75). The diet's carb:fat ratio then splits the remaining calories.
- **`diets.js`**: diets are **data, not code paths**: a macro split, `exclude`/`prefer`/`limit` food tags, and optional caps (`carbMaxG`, `proteinMaxPct`, `sodiumMaxMg`). Meal **schedules**, including intermittent fasting 16:8, are separate from diets, so any diet works with any schedule. Each schedule meal has a `share` of the day's calories. To add a diet, add an entry and tag foods to match.
- **`foods.js`**: the built-in food list. Nutrition is **per 100 g** (cooked weight for meat, grains and beans). `role` (protein/carb/veg/fruit/fat/other) is how the planner uses a food; `meals` is `b`/`m`/`s` (breakfast, lunch/dinner, snack); `tags` drive diet rules; `units` maps unit names to grams and `show` is the unit plans display in. The `salty` tag is added automatically at ≥500 mg sodium per 100 g. Custom and USDA foods have the same shape and live in `state.customFoods`.
- **`meals.js`**: the meal library — real breakfasts, lunches/dinners and snacks with ingredient amounts (for a ~500 kcal serving), seasonings and steps. Ingredient flags: `P`/`C`/`F` = scaled to hit protein / carbs / remaining calories, `?` = optional (dropped when the diet excludes it, the person won't eat it, or it's a carb on keto). Every meal needs a `P` ingredient and steps (`tests/planner.test.js` checks this, and that every diet has enough meals of each type).
- **`planner.js`**: `planDay()` picks a library meal for each slot first (`templateOptions()` → `templateItems()`), then `fitTemplate()` scales non-vegetable amounts toward the person's meal size, `sizeMeal()` solves the P/C/F ingredients, sides are added if protein or calories are short, and `trimToTarget()` shrinks fats → extras → carbs → protein if the meal is still over. With "only plan foods I like" on, a meal's main protein must be liked. On keto, library meals over 10 g net carbs are skipped. The person's own recipes with a planning role join the library (`userMealTemplates()`). It falls back to building a meal from parts only when no library meal fits. Tests check a larger and a smaller eater across every diet × schedule; plans should stay within ~10% of calories.
- **Daily tools (Today / Progress):** gym-day calorie cycling (`cycleShift()`: +10% on `profile.gymDays`, the same taken back on rest days, off on keto; per-day overrides in `state.dayType`), water (`state.water[pid][date]` oz, goal from `waterGoal()`), habits (`state.habits[pid][date]` for manual ones; protein/calories/veg/water are computed from the log), and the weekly coach (`coachAdvice()`: needs 3 weigh-ins over 14+ days; suggests ±150 kcal stored as `profile.kcalAdjust`, or asks for more consistent logging first).
  - `planDay()` is **deterministic**. Each meal is seeded from profile + date + diet + schedule + meal + variant, so plans don't change on reload. "New plan" bumps `variant` and "Swap meal" bumps that meal's own variant (stored in `state.planVariants`). For each meal it picks foods by role, weighting liked foods (only liked foods when `onlyLiked` is on, the default) and diet prefer/limit tags. `sizeMeal()` then sizes portions: veg and fruit get a standard serving, protein foods solve for protein, carbs for carbs, and fat fills the remaining calories. Portion caps (`MAX_G`/`ROLE_MAX`) are scaled up for big meals.
  - **Shared household meals:** `pickSharedMeal()` picks one set of foods for the people who eat together. Foods must be allowed by everyone's diet and disliked by no one, and foods everyone likes are preferred. The result is passed to each person's `planDay()` as `fixed: { dinner: [ids] }`, so everyone eats the same foods sized to their own targets. Keto members drop the carb item. Extras added just for one person are flagged `personal`. Settings live in `state.household` (`meals`, and `members` where null means everyone). Shared swap variants are stored under `state.planVariants.__shared[date][mealId]`. Extra lean protein or fat items are added when caps leave a meal short, and portions are rounded to measurable amounts (whole eggs, ¼ cups, ½ oz).
- **Progress tab:** check-ins are stored in `state.weights[pid]` as `{ date, lb?, waist?, neck?, hip? }`, one per day (the name `weights` is kept for older backups). A new weight updates `profile.weightLb`, so targets follow it. Charts are hand-built inline SVG with one series and one axis each; colors are `--chart-line` (#2f7d4f light, #47a86e dark), both checked with the dataviz palette validator.
- **`recipes.js`**: a recipe is saved as an ordinary custom food (per 100 g, computed from the summed ingredient weights) plus a `recipe` field (`servings`, `servingName`, `ingredients: [{ foodId, qty, unit, grams }]`) so it can be edited. One serving = total grams ÷ servings, exposed as the unit `serving` and the recipe's own serving name. Ingredients found through USDA or a barcode are copied into `customFoods` when the recipe is saved. Editing a recipe keeps its id, so past log entries pick up the new nutrition. The recipe editor (`ui.tab === 'recipe'`, draft in `ui.recipe`) updates rows and totals in place to keep input focus.
- **`barcode.js`**: barcode lookup tries Open Food Facts first, then USDA Branded matched on `gtinUpc`. Scanned foods get id `off_<code>` and a `barcode` field, so a re-scan finds the saved copy. The camera uses the native `BarcodeDetector` when it supports EAN-13 (Chrome on Android); otherwise it loads ZXing 0.21.3 from jsDelivr on demand (iPhone Safari). Closing the modal stops the camera. Typing the number in by hand always works.
- **`storage.js`**: all state is one JSON object in `localStorage` (`healthyplate.v1`). Logs entries store `foodId` + grams, so any food that gets logged must exist in built-ins or `customFoods`; `logFood` copies USDA results into `customFoods` for this reason. Each device has its own data. Moving between phone and PC is done with Backup/Restore (JSON file) on the Profile screen.
- **`usda.js`**: USDA FoodData Central search (Foundation, SR Legacy, Branded). It maps nutrient numbers 208/203/205/204/291/307 to per-100 g values. It uses `DEMO_KEY` unless the user saves their own key.
- **`app.js`**: renders each tab as an HTML string into `#view`. Clicks go through one delegated handler keyed by `data-action` (see the `actions` object). Forms are handled in one `submit` listener by form id. The lookup results and the food modal update sub-elements in place so the input keeps focus.
- **`sw.js`**: network-first service worker with a cache fallback for offline use. **Add any new app file to `SHELL`.**

## Things to keep true

- Plans must never use a food the diet excludes or the person marked "won't eat". `tests/planner.test.js` checks every diet × schedule for this, for calories within 15% of target, and for keto net carbs.
- Keep health guardrails (the calorie floor, the deficit cap, and the "not medical advice" notes) when changing target math or adding diets.
- Escape user-entered text with `esc()` when building HTML.
