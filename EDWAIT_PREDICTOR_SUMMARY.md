# ExpressCare Intelligence Grid — Feature Assessment

## 1. ED Predictive Model (LightGBM Census Forecasting)

**What it does:** Predicts each hospital's ED census score (1-4 capacity scale) at 1-hour and 4-hour horizons using a LightGBM model with 38 features. Renders a 24-hour forecast curve in the dashboard with uncertainty bands.

### What works well

- The model architecture is well-grounded in published ED forecasting literature. Current ED state dominates prediction (as every study confirms), with meaningful contributions from lag features, time-of-day patterns, and temperature.
- The autoregressive rollout for the 24h forecast curve produces clinically plausible trajectories — elevated hospitals decay toward baseline overnight, and the model captures the morning ramp-up pattern.
- The 1h MAE of 0.18 on a 1-4 scale translates to 90%+ exact-integer accuracy, which is strong for a model trained on only 7 days of data.
- The browser-side tree evaluator means predictions require no server round-trip — forecast updates instantly when you select a hospital.
- HSCRC volume baselines give the model hospital-specific context (is Sinai normally busy in April?) that pure time-series approaches miss.

### What needs polishing

- **Only 7 days of training data.** The model has never seen a weekend pattern repeat, a Monday morning surge, or any seasonal variation. Weekly and monthly features (dow_sin/cos, month_sin/cos, is_weekend) are essentially untrained. Accuracy will improve substantially after 30+ days of collection, and again after a full flu season cycle.
- **4h MAE of 0.36 is mediocre.** On a 1-4 scale, that's roughly one-third of a level off — fine for directional guidance but not precise enough for operational decisions like EMS diversion. The autoregressive rollout compounds errors beyond 4 hours, so the tail of the 24h forecast should be interpreted as a trend arrow, not a prediction.
- **Weather and flu features are weak.** Temperature contributes modestly (rank #9), but precipitation shows zero importance (not enough rainy days in the training window). Flu/ILI data doesn't overlap the EDAS collection period at all. Both will activate with more data, but right now the model is essentially a temporal autocorrelation engine with hospital identity.
- **The uncertainty bands are synthetic.** They're computed as `prediction +/- 1.28 * MAE * sqrt(hours)` — a parametric approximation, not learned uncertainty. The bands widen smoothly with horizon, which looks clean but doesn't capture the real error distribution (which is worse at shift-change hours like 11am and 5pm, and better overnight).
- **13.2% of hospitals don't report census scores.** The model handles these as NaN, but it means roughly 1 in 8 hospitals has no predictive capability. These are mostly smaller or specialized facilities, but it's a gap.
- **The model JSON files are 2.5 MB each.** Acceptable for now but adds to initial page load. Could be compressed or lazy-loaded after the first paint.

---

## 2. Hex Grid Heatmap (SDOH Demand Surface)

**What it does:** 38,322 H3 resolution-8 hex cells covering Maryland, each scored 0-100 based on health burden, social vulnerability, coverage gap, and population density. Rendered via deck.gl WebGL for smooth performance at 100K+ cells.

### What works well

- Resolution 8 (~0.3 mi edge) gives census-tract-level granularity — you can distinguish one Baltimore neighborhood from the next. This is the right resolution for site selection analysis.
- The deck.gl WebGL rendering handles 38K Maryland hexes at 60fps with no visible lag, even on zoom/pan. The old react-leaflet Polygon approach would have choked at 2K cells.
- The composite scoring formula (35% health burden, 25% SVI, 25% coverage gap, 15% population density) produces a visible and meaningful gradient across Maryland. Dense urban areas with high chronic disease prevalence (West Baltimore, East Baltimore, parts of PG County) light up appropriately.
- GeoHealth API integration brings real CDC PLACES health outcomes and Census SVI data per tract — not synthetic or modeled values.
- The hover tooltip shows all four component scores, letting users understand why a location scored high.

### What needs polishing

- **The scoring weights are arbitrary.** 35/25/25/15 was chosen based on intuition, not calibration against actual patient diversion data. The "right" weights depend on what you're optimizing for — maximum patient capture (weight population heavily) vs. maximum community health impact (weight health burden heavily) vs. maximum equity (weight SVI heavily). Ideally these weights would be adjustable by the user.
- **Coverage gap is a crude distance measure.** It's a linear function of straight-line distance to the nearest ExpressCare (2 mi = 0%, 15 mi = 100%). This ignores drive time, road networks, traffic patterns, and the presence of competitor urgent care locations. A hex 8 miles from ExpressCare but 2 miles from a Patient First is less of a gap than the score suggests.
- **No time-of-day variation.** The demand surface is static — it doesn't change based on whether it's 2pm on a Tuesday (commuters near workplaces) or 10pm on a Saturday (residents at home). Real demand patterns shift throughout the day. Mobile phone mobility data would address this but isn't currently integrated.
- **Out-of-state hexes are filtered but still generated.** 63K of the 101K scored hexes are outside Maryland. They're filtered from display but still fetched from Postgres (35 MB payload). Regenerating the hex grid with a tighter Maryland-only boundary would cut the data transfer in half and speed up initial load.
- **Health burden components aren't individually explorable.** The hex grid shows a composite score, but a user investigating diabetes hotspots versus mental health distress clusters can't filter or re-weight the map. Individual PLACES measures are available in the data but not exposed as toggleable layers.
- **SVI Choropleth mode exists but is basic.** It shows a single-color gradient for the SVI composite. The four SVI themes (socioeconomic, household/disability, minority/language, housing/transportation) are individually available in the data but not separately viewable.

---

## 3. ExpressCare Expansion Opportunities

**What it does:** Ranks the top 10 Maryland hex cells that score above 65 and are more than 8 miles from any existing ExpressCare location. Click to zoom to the location and see a breakdown of why it scored high.

### What works well

- The click-to-zoom-and-highlight interaction makes it easy to locate each opportunity on the map. The bright blue highlight hex with white border stands out clearly against the heatmap.
- The expanded detail panel shows all four scoring components with bars and descriptions, giving users the "why" behind each recommendation.
- The "?" help button on the header provides a clear, accessible explanation of the methodology for non-technical users.
- Filtering to Maryland-only (FIPS 24) eliminates the false positives from neighboring states.

### What needs polishing

- **The 8-mile threshold is arbitrary.** Why 8 miles and not 5 or 10? The right threshold depends on the market — urban areas might consider 3+ miles a gap, while rural western Maryland might tolerate 15+ miles. This should be configurable or at least contextually adjusted (tighter threshold in the Baltimore metro, wider in rural counties).
- **The score threshold of 65 is also arbitrary.** With the current data, it produces roughly 10 results, but that's coincidental. A principled threshold would be based on the score distribution (e.g., top decile) or a minimum viable patient capture volume.
- **No volume estimation.** The current list says "Near ExpressCare Urbana, 8.3mi away, Pop 4,200" but doesn't answer the key business question: how many patients per day could a new location here realistically capture? This requires integrating the HSCRC outpatient ED volume data (VOL_OUT) with a gravity model to estimate divertible patient flow — the exact capability described in the Spatial Demand Modeling Research doc that hasn't been built yet.
- **No competitor awareness.** The coverage gap component only measures distance to the nearest ExpressCare, ignoring Patient First, MedStar PromptCare, and other urgent care competitors. A hex might be far from ExpressCare but directly adjacent to a Patient First — making it a poor expansion opportunity despite the high gap score.
- **No drive-time analysis.** Straight-line distance is a poor proxy for access in Maryland's road network. The I-695 beltway, I-95 corridor, and Chesapeake Bay create situations where a location 5 miles away by air might be 20 minutes by car. OSRM or Google Maps drive-time isochrones would significantly improve accuracy.
- **No cannibalization analysis.** Opening a new ExpressCare location might capture patients from nearby existing locations rather than new patients. The expansion opportunity list doesn't model whether a new site would grow the pie or redistribute existing slices. The gravity model framework from the research doc would address this — it re-computes patient flow across all facilities when a new one is added.
- **Static ranking.** The list doesn't change based on current ED conditions. An area near a hospital currently at Census Level 4 (overcapacity) has more urgent diversion potential right now than the same area when the hospital is at Level 1. Dynamically weighting opportunities by real-time ED pressure would make the list actionable for same-day operational decisions, not just long-term strategic planning.
