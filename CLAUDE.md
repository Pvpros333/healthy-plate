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

The modules in `js/` are pure logic, except `app.js` (DOM) and `storage.js` / `usda.js` (browser APIs). Tests import the pure modules directly in Node.

- **`nutrition.js`**: the single source of the target math. Mifflin–St Jeor BMR × activity factor = TDEE, then a deficit by goal. The deficit is capped at 25% of TDEE and the target never drops below 1200 (women) / 1500 (men) kcal. Protein comes first (0.9 g/lb of goal weight if lifting ≥2 days, else 0.75). The diet's carb:fat ratio then splits the remaining calories.
- **`diets.js`**: diets are **data, not code paths**: a macro split, `exclude`/`prefer`/`limit` food tags, and optional caps (`carbMaxG`, `proteinMaxPct`, `sodiumMaxMg`). Meal **schedules**, including intermittent fasting 16:8, are separate from diets, so any diet works with any schedule. Each schedule meal has a `share` of the day's calories. To add a diet, add an entry and tag foods to match.
- **`foods.js`**: the built-in food list. Nutrition is **per 100 g** (cooked weight for meat, grains and beans). `role` (protein/carb/veg/fruit/fat/other) is how the planner uses a food; `meals` is `b`/`m`/`s` (breakfast, lunch/dinner, snack); `tags` drive diet rules; `units` maps unit names to grams and `show` is the unit plans display in. The `salty` tag is added automatically at ≥500 mg sodium per 100 g. Custom and USDA foods have the same shape and live in `state.customFoods`.
- **`planner.js`**: `planDay()` is **deterministic**. Each meal is seeded from profile + date + diet + schedule + meal + variant, so plans don't change on reload. "New plan" bumps `variant` and "Swap meal" bumps that meal's own variant (stored in `state.planVariants`). For each meal it picks foods by role, weighting liked foods (only liked foods when `onlyLiked` is on, the default) and diet prefer/limit tags. `sizeMeal()` then sizes portions: veg and fruit get a standard serving, protein foods solve for protein, carbs for carbs, and fat fills the remaining calories. Portion caps (`MAX_G`/`ROLE_MAX`) are scaled up for big meals. Extra lean protein or fat items are added when caps leave a meal short, and portions are rounded to measurable amounts (whole eggs, ¼ cups, ½ oz).
- **`storage.js`**: all state is one JSON object in `localStorage` (`healthyplate.v1`). Logs entries store `foodId` + grams, so any food that gets logged must exist in built-ins or `customFoods`; `logFood` copies USDA results into `customFoods` for this reason. Each device has its own data. Moving between phone and PC is done with Backup/Restore (JSON file) on the Profile screen.
- **`usda.js`**: USDA FoodData Central search (Foundation, SR Legacy, Branded). It maps nutrient numbers 208/203/205/204/291/307 to per-100 g values. It uses `DEMO_KEY` unless the user saves their own key.
- **`app.js`**: renders each tab as an HTML string into `#view`. Clicks go through one delegated handler keyed by `data-action` (see the `actions` object). Forms are handled in one `submit` listener by form id. The lookup results and the food modal update sub-elements in place so the input keeps focus.
- **`sw.js`**: network-first service worker with a cache fallback for offline use. **Add any new app file to `SHELL`.**

## Things to keep true

- Plans must never use a food the diet excludes or the person marked "won't eat". `tests/planner.test.js` checks every diet × schedule for this, for calories within 15% of target, and for keto net carbs.
- Keep health guardrails (the calorie floor, the deficit cap, and the "not medical advice" notes) when changing target math or adding diets.
- Escape user-entered text with `esc()` when building HTML.
