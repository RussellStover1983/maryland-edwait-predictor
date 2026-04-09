# Spatial Demand & Facility Location Modeling — Research Reference

## Purpose

This document summarizes published research on spatial demand prediction, gravity models, patient flow routing, and facility location optimization as applied to healthcare — specifically emergency departments and urgent care. These methods inform how to predict demand at any geographic point and model where patients will seek care, which directly supports the ExpressCare site selection use case.

---

## The Three-Layer Model

The research literature treats this problem as three connected layers:

### Layer 1: Demand Surface — "How much demand exists at this location at this time?"
Predict the intensity of healthcare demand at any arbitrary point in space, varying over time. This is the hex grid heatmap in the dashboard.

### Layer 2: Patient Choice / Flow Routing — "Where will people at this location go for care?"
Given demand at a point, predict the probability distribution of where those patients will seek care across all available facilities. This is the gravity model / catchment model.

### Layer 3: Facility Location Optimization — "Where should we place a new facility to capture the most unmet demand?"
Given the demand surface and the patient choice model, find the optimal location for a new facility that maximizes demand captured (or minimizes total patient travel time, or maximizes equity of access). This is the site selection engine.

---

## Layer 1: Spatial Demand Estimation

### Key Methods

**Kernel Density Estimation (KDE)**: Creates a continuous demand surface from point observations (e.g., geocoded ED visits). Simple, interpretable, widely used in public health mapping. Limitation: purely spatial, doesn't incorporate temporal or demographic predictors.

**Machine Learning on Grid Cells**: The approach we're using — assign demand scores to hex cells based on population, health burden, SVI, and temporal features. LightGBM and XGBoost are effective here (see ED predictive modeling research doc).

**Mobile Phone Data for Demand Estimation** (Leitch & Wei, 2024 — Erie County, NY): Used large-scale mobile phone location data to estimate healthcare demand at fine spatial resolution, capturing actual population presence (not just residential census counts). This addresses the weakness of census-based models: people aren't always at home when they need care. Rush hour commuters generate demand near their workplaces, not their residences.

**Relevance for us**: Our hex grid uses census tract population as a demand proxy. For a production system, anonymized mobile location data (from SafeGraph, Placer.ai, or similar) would significantly improve demand estimation by showing where people actually are at different times of day.

---

## Layer 2: Gravity Models and Patient Choice

### The Gravity Model (Huff Model)

The foundational framework, introduced by David Huff in 1964. The probability that a consumer at location i patronizes facility j is:

```
P(i→j) = Attractiveness(j) / Distance(i,j)^β
          ─────────────────────────────────────
          Σ [Attractiveness(k) / Distance(i,k)^β]  for all facilities k
```

Where:
- **Attractiveness** = some measure of facility quality/size (beds, services, reputation, wait time)
- **Distance** = travel time or distance
- **β** = distance decay parameter (how much distance matters — higher β means people strongly prefer closer facilities)

This is exactly the flood/terrain analogy: demand (water) flows toward facilities (basins) in proportion to their attractiveness, modulated by the friction of distance.

### Key Study: Gravity Model for Emergency Departments (2025, Scientific Reports)

**Citation**: "A gravity model for emergency departments" — Nature Scientific Reports, June 2025
**URL**: https://www.nature.com/articles/s41598-025-99840-w

Extended the classic gravity model with two novel factors for ED choice:
1. **Hospital size** (capacity, beds)
2. **Patient severity** (acuity level)

Achieved **98.77% accuracy** in predicting overall hospital utilization and **98.02%** in predicting patient flows between cities and hospitals.

**Key insight**: More severe patients are willing to travel farther to reach a higher-capability hospital. Low-acuity patients (the ones ExpressCare would capture) are much more distance-sensitive — they go to the closest option. This means the distance decay parameter β should vary by acuity.

**Relevance**: This directly supports the ExpressCare thesis. Low-acuity patients (the ExpressCare target population) have high distance sensitivity. Placing an ExpressCare location close to a population center captures demand that would otherwise flow to the nearest ED, even if that ED is further away, because the ED's "attractiveness" for low-acuity needs is low (long waits, higher costs, inappropriate setting).

### Competitive Gravity Model Refinement (Drezner & Zerom, 2024)

**Citation**: "A refinement of the gravity model for competitive facility location" — Computational Management Science
**URL**: https://link.springer.com/article/10.1007/s10287-023-00484-w

Found that **the rate at which patronage declines with distance varies by facility attractiveness**. More attractive facilities retain patients from longer distances; less attractive facilities lose patients quickly as distance increases.

Translated to urgent care: An ExpressCare with a 10-minute wait retains patients from a wider catchment than one with a 45-minute wait. When modeling demand capture for a new location, the wait time (attractiveness) and distance interact — they're not independent.

### Data-Guided Gravity Model (2024, Networks and Spatial Economics)

**Citation**: "Data-Guided Gravity Model for Competitive Facility Location"
**URL**: https://link.springer.com/article/10.1007/s11067-024-09623-5

Introduced a non-parametric (data-driven) approach to specifying the gravity model instead of assuming a fixed functional form. As data volume grows, data-guided approaches outperform parameterized models because they can capture local variations in patient behavior that a single β parameter misses.

**Relevance**: With enough EDAS collection history + ExpressCare wait time data, we could train a data-guided gravity model that learns the actual distance-decay pattern for Maryland patients rather than assuming one.

---

## Layer 2.5: Floating Catchment Area (FCA) Methods

The Two-Step Floating Catchment Area (2SFCA) method is the dominant approach in healthcare access research. It's essentially a gravity model operationalized for GIS analysis.

### How 2SFCA Works

**Step 1**: For each facility, compute a supply-to-demand ratio by summing the population within a travel time threshold, weighted by distance decay.

**Step 2**: For each population point, sum the ratios of all facilities within the threshold. The result is a spatial accessibility score — higher scores mean better access.

### Key Study: FCA Metrics Predict Actual Utilization Patterns (Delamater et al., 2019)

**Citation**: "Using floating catchment area metrics to predict health care utilization patterns" — BMC Health Services Research
**URL**: https://pmc.ncbi.nlm.nih.gov/articles/PMC6399985/

Tested whether FCA metrics could predict where patients actually go for care (not just theoretical accessibility, but real utilization patterns). Used 1 million+ inpatient visits in Michigan.

**Results**: The Three-Step FCA (3SFCA) and Modified 2SFCA (M2SFCA) correctly predicted the destination hospital for **74% of hospital visits**. These methods were also robust to changes in distance decay parameters.

**Critical finding**: FCA methods work best for **non-emergency settings**. For true emergencies, the "closest hospital" model is more accurate (people go to the nearest ED when it's life-threatening). For low-acuity visits (the urgent care population), FCA/gravity models are superior because patients are making a choice among options.

**Relevance**: This is the theoretical validation for the entire dashboard concept. For the low-acuity population that ExpressCare serves, a gravity/FCA model with current wait times as the attractiveness variable will accurately predict patient flow patterns. And since EDAS gives us real-time capacity data, we can dynamically update the attractiveness variable — something no previous study has done.

### Systematic Review of Gravity Models for Healthcare Access (2023)

**Citation**: "Gravity models for potential spatial healthcare access measurement: a systematic methodological review" — International Journal of Health Geographics
**URL**: https://ij-healthgeographics.biomedcentral.com/articles/10.1186/s12942-023-00358-z

Reviewed 43 methodological papers and 346 empirical applications. Key findings:

- The 2SFCA family dominates empirical research
- Major methodological advances include: variable catchment sizes (rural patients travel farther), multiple transportation modes, time-dependent access (facilities have hours of operation), subgroup-specific access (different populations have different travel patterns), and provider competition
- **Insurance network constraints** are an underexplored factor — the Supply-Demand Adjusted 2SFCA (SDA-2SFCA) model incorporates insurance acceptance, which is directly relevant since ExpressCare accepts specific insurance plans

### Supply-Demand Adjusted 2SFCA (SDA-2SFCA)

**Citation**: "Supply-demand adjusted two-steps floating catchment area model" — Social Science & Medicine, 2022
**URL**: https://www.sciencedirect.com/science/article/abs/pii/S0277953622000302

Enhanced the 2SFCA by incorporating:
- Insurance plans accepted by providers (not all patients can access all providers)
- Age and gender-adjusted demand (elderly and females have higher healthcare utilization)

Applied to Cook County, IL with a 15-mile catchment buffer.

**Relevance**: ExpressCare accepts specific insurance plans. A patient whose insurance isn't accepted by ExpressCare will not divert there regardless of distance or wait time. Any production model needs an insurance filter on the demand routing.

---

## Layer 3: Facility Location Optimization

### The p-Median Problem

"Where should we place p new facilities to minimize total weighted distance between demand points and their nearest facility?"

This is the classic formulation. For ExpressCare: "Given our existing 40 locations, where should location #41 go to minimize the average distance an underserved Maryland resident travels to reach urgent care?"

Solvable with integer linear programming for small problems. For larger problems (thousands of candidate sites), heuristic methods or deep reinforcement learning are used.

### Key Study: Integrated Spatial Analysis + Optimization (Leitch & Wei, 2024)

**Citation**: "Improving spatial access to healthcare facilities: an integrated approach with spatial analysis and optimization modeling" — Annals of Operations Research
**URL**: https://link.springer.com/article/10.1007/s10479-024-06028-y

Developed a complete framework for Erie County, NY that:
1. Estimated healthcare demand from mobile phone data using ML
2. Calibrated travel time decay from human mobility patterns
3. Calculated spatial accessibility scores (2SFCA)
4. Optimized hospital locations using efficiency AND equity criteria

Used both **Rawlsian criterion** (maximize coverage of the least-covered area) and **Gini coefficient** (minimize inequality in coverage between areas).

**Key finding**: It's possible to greatly improve fairness by giving up only a small amount of total coverage. The efficiency-equity tradeoff is less severe than assumed.

**Relevance**: This is the most complete template for what we're building. Replace "hospitals" with "urgent care centers," use our hex grid demand surface instead of mobile phone data, use EDAS + GeoHealth for the accessibility calculation, and the optimization framework maps directly.

### Deep Reinforcement Learning for Facility Location (SpoNet, 2024)

**Citation**: "SpoNet: solve spatial optimization problem using deep reinforcement learning" — International Journal of Digital Earth
**URL**: https://www.tandfonline.com/doi/full/10.1080/17538947.2023.2299211

Used deep RL to solve p-Median, p-Center, and Maximum Covering Location Problems. The model learns to place facilities by iteratively improving placement through a Markov Decision Process.

**Advantage**: Scales to thousands of demand points where exact solvers time out. For 5,000 demand points, the RL model produces solutions in seconds where Gurobi (a commercial solver) fails to solve within an hour.

**Relevance**: If we expand beyond "where should location #41 go" to "redesign the entire 40-location network for optimal coverage," RL-based approaches would be needed. Overkill for the prototype but interesting for a production product.

### Spatial Optimization with Hierarchical Facilities (2025, PMC)

**Citation**: "Spatial optimization of hierarchical healthcare facilities driven by multi-source data" — Frontiers in Public Health
**URL**: https://pmc.ncbi.nlm.nih.gov/articles/PMC12331506/

Optimized the spatial allocation of healthcare facilities at multiple tiers (community clinics → district hospitals → tertiary centers). Used Location Allocation models in GIS to match supply points to demand points.

**Relevance**: ExpressCare operates in a hierarchy: ExpressCare locations → LifeBridge EDs → LifeBridge specialty/inpatient. The hierarchical model captures the routing logic: low-acuity goes to ExpressCare, moderate goes to the ED, severe goes to trauma centers. Optimizing the network requires modeling all tiers simultaneously.

---

## How This All Connects to Our Dashboard

### Current State (what we've built)

| Layer | Implementation | Data Source |
|-------|---------------|-------------|
| Demand Surface | Hex grid with SDOH-based Wait Burden Score | GeoHealth API (CDC PLACES, SVI, Census) |
| Real-time Capacity | Hospital markers colored by census level | EDAS live API |
| Temporal Prediction | ML model forecasting ED census 8-24h ahead | EDAS collector + weather + flu + calendar |

### Next Evolution (gravity model + optimization)

| Layer | Implementation | Data Source |
|-------|---------------|-------------|
| Demand Surface | Same hex grid, enhanced with time-of-day population mobility | Census + (future: mobile location data) |
| Patient Choice Model | Gravity/FCA model predicting flow from each hex to each facility | EDAS (capacity = attractiveness), travel time (OSRM or Google), insurance acceptance |
| Flow Visualization | Animated arcs on the map showing predicted patient flow from high-demand hexes to facilities | Gravity model output |
| "What-if" Site Selection | "Drop a pin → show how demand flow would change if ExpressCare opened here" | Gravity model re-run with new facility added |
| Optimal Location Finder | "Given the current network, where does location #41 capture the most demand?" | p-Median optimization over hex grid |

### The Key Insight from the Literature

The single most important finding across all these studies: **for non-emergency, low-acuity care (the ExpressCare population), gravity/FCA models accurately predict where patients will go — and the dominant factors are distance and current wait time/capacity.**

Since EDAS gives us real-time capacity for every ED in Maryland, and we can measure distance from any point to every facility, we have the two most important inputs for a gravity model that updates in real-time. No previous study has combined real-time ED capacity feeds with a gravity model for urgent care site selection. That's the novel contribution.

---

## Recommended Reading Priority

If you're going to read three papers, read these:

1. **Gravity model for EDs** (2025, Nature) — Proves the gravity model works for ED patient flow at 98%+ accuracy, and shows that severity modulates distance sensitivity
2. **FCA metrics predict utilization** (2019, BMC) — Validates that FCA/gravity methods predict where patients actually go (74% accuracy) and work best for non-emergency settings
3. **Integrated spatial analysis + optimization** (2024, Annals OR) — The complete framework template: demand estimation → accessibility scoring → location optimization with equity constraints
