# ED Wait Time & Volume Predictive Modeling — Research Reference

## Purpose

This document summarizes published research on predicting emergency department wait times, patient volumes, and crowding using machine learning and time series methods. Use these findings to inform the design of the predictive model for the ExpressCare Intelligence Grid dashboard.

---

## Key Findings Across Studies

### What Predicts ED Wait Times and Volume

The literature consistently identifies these feature categories, ranked by importance:

1. **Current ED state (most predictive)**: Current census/occupancy, number of patients waiting, number of boarding patients, average ESI acuity. Studies that include real-time ED state features outperform those using only external features.

2. **Temporal / calendar features**: Day of week is the single strongest calendar predictor across nearly all studies. Hour of day drives intra-day patterns. Month captures seasonal trends. Holidays and weekends behave distinctly. Multiple studies encode these cyclically (sin/cos transforms) for ML models.

3. **Weather**: Temperature and precipitation show modest but consistent predictive value for daily volumes. Effect varies by climate — strong in temperate regions (relevant to Maryland), weaker in tropical climates. One study found weather captured seasonality trends more than direct causal effects.

4. **Flu/respiratory illness rates**: Seasonal ILI (influenza-like illness) rates correlate with ED volume spikes, especially in winter months. Weekly CDC FluView data is commonly used.

5. **Patient arrival mode**: EMS arrivals are associated with higher acuity and longer processing times. The number of arriving ambulances is a leading indicator of ED congestion.

### Best Performing Algorithms

| Algorithm | Strengths | Common Use Case |
|-----------|-----------|-----------------|
| **XGBoost / LightGBM** | Best overall accuracy in most comparative studies. Handles mixed features, fast to train, interpretable via feature importance. | Daily/hourly volume prediction, wait time classification |
| **Random Forest** | Good accuracy with less tuning. Reasonable tradeoff between accuracy and computational efficiency. | Daily volume forecasting, feature selection |
| **SARIMA / SARIMAX** | Strong for pure time series with clear seasonality. Performs well at hourly occupancy forecasting 1-4 hours ahead. Transparent and well-understood. | Hourly ED occupancy, short-horizon forecasting |
| **LSTM (Long Short-Term Memory)** | Captures complex nonlinear temporal dependencies. Better for moderate-term (7-day) forecasts. | Hourly arrival forecasting, multi-day horizon |
| **Ensemble methods** | Combining multiple models (e.g., stacking XGBoost + LSTM) generally outperforms any single model. | Production systems requiring maximum accuracy |
| **Neural Network Autoregression (NNAR)** | Combines neural network flexibility with autoregressive structure. Effective at capturing nonlinear seasonal patterns. | Daily arrival forecasting with engineered features |

**Key insight**: Complex deep learning models (Med2Vec, LSTM) do not consistently outperform simpler gradient-boosted tree models on relatively low-dimensional ED data. XGBoost and LightGBM are the pragmatic choice for a prototype.

### Feature Engineering Patterns That Improve Accuracy

**Queue-based / state features** (from Celesti et al., 2021 — Italian EDs):
- Number of patients currently waiting by triage level
- Number of patients currently in treatment
- Time since last arrival
- Running average of wait times over past N hours
These "state of the system" features significantly improved prediction accuracy over patient-characteristic features alone.

**Temporal feature engineering** (from multiple studies):
- Hour of day encoded as sin/cos: `sin(2π × hour/24)`, `cos(2π × hour/24)`
- Day of week encoded as sin/cos: `sin(2π × day/7)`, `cos(2π × day/7)`
- Month encoded similarly
- `is_weekend` binary flag
- `is_holiday` binary flag
- `hours_since_shift_change` (shift changes at 7am, 3pm, 11pm are common congestion points)

**Lag features** (from XGBoost studies):
- Patient volume at T-1h, T-2h, T-4h, T-8h, T-24h (same hour yesterday)
- Rolling mean over past 3, 7, 24 hours
- Rolling standard deviation (captures volatility)
- Same hour, same day of week from previous weeks

**Weather features**:
- Daily max temperature, min temperature
- Precipitation (binary flag or continuous)
- Humidity
- Weather forecast for next 24h (enables forward-looking predictions)

---

## Relevant Studies

### 1. Wang et al. (2025) — "Interpretable ML models for prolonged ED wait time prediction"
- **Source**: BMC Health Services Research, March 2025
- **URL**: https://bmchealthservres.biomedcentral.com/articles/10.1186/s12913-025-12535-w
- **Method**: Compared 5 ML algorithms (Logistic Regression, Random Forest, XGBoost, ANN, SVM) for classifying wait times as <30 min vs ≥30 min
- **Data**: Single-center retrospective, ESI level 3 patients, 173,856 visits
- **Key finding**: ED crowding status and patient arrival mode were the top predictors. All 5 models performed comparably (65-75% accuracy range). Emphasis on minimizing false negative rate (failing to predict a long wait) for clinical safety.
- **Relevance**: Confirms ED crowding status (analogous to EDAS census score) is the most important feature. Their focus on interpretability via SHAP values is a good pattern to follow.

### 2. Wang et al. (2025) — "Evaluating fairness of ML prediction with XGBoost"
- **Source**: PLOS Digital Health, March 2025
- **URL**: https://journals.plos.org/digitalhealth/article?id=10.1371/journal.pdig.0000751
- **Method**: XGBoost for prolonged wait time prediction with fairness evaluation across demographics
- **Data**: Same dataset as above (173,856 visits)
- **Key finding**: XGBoost showed moderate predictive accuracy but revealed disparities across sex, race/ethnicity, and insurance status. Female, Hispanic, and uninsured patients had higher rates of prolonged waits.
- **Relevance**: Important consideration if model is ever used for patient-facing predictions. Fairness evaluation should be part of model validation.

### 3. Celesti et al. (2021) — "Real-time prediction of waiting times using ML"
- **Source**: International Journal of Forecasting, 2021
- **URL**: https://www.sciencedirect.com/science/article/abs/pii/S0169207021001692
- **Method**: Compared Lasso, Random Forest, SVR, ANN, Ensemble. Introduced novel queue-based predictors capturing current ED state.
- **Data**: Two large Italian EDs, real operational data
- **Key finding**: Ensemble method was most accurate. Queue-based features (current number waiting, current processing rates) dramatically improved predictions over patient characteristics alone. Proposed a simulated real-time forecasting system that updates predictions with each new patient arrival.
- **Relevance**: Directly applicable architecture — their "current state of the system" features map to our EDAS real-time inputs (census score, EMS units, dwell times). Their real-time simulation approach is exactly what the dashboard does.

### 4. JMIR (2025) — "AI Framework for Predicting ED Overcrowding"
- **Source**: JMIR Medical Informatics, September 2025
- **URL**: https://medinform.jmir.org/2025/1/e73960
- **Method**: 11 ML algorithms including deep learning (TSiTPlus, XCMPlus) for predicting ED waiting room occupancy count
- **Data**: US hospital ED, internal metrics + external features
- **Prediction horizons**: Hourly (6 hours ahead) and daily (24 hours ahead)
- **Key finding**: TSiTPlus best for hourly prediction (MAE 4.19 patients). XCMPlus best for daily (MAE 2.00). Accuracy varied by hour — worst at 8 PM (peak), best at 11 PM (low volume). Extreme cases (high-volume periods) had significantly higher error.
- **Relevance**: Demonstrates that 6-hour and 24-hour prediction horizons are feasible. Error increases during peaks — our model should communicate uncertainty at high-demand periods. Mean waiting count was 18.11 with SD 9.77.

### 5. Cheng et al. (2021) — "Forecasting ED hourly occupancy using SARIMAX"
- **Source**: American Journal of Emergency Medicine, 2021
- **URL**: https://www.sciencedirect.com/science/article/abs/pii/S0735675721003600
- **Method**: Novel 24-SARIMAX model (separate model for each hour of day) with current ED occupancy, average ESI, and boarding patients as external regressors
- **Data**: 65,132 ED visits at a large US academic medical center, calendar year 2012
- **Key finding**: SARIMAX outperformed rolling average at predicting 1-4 hour ahead ED occupancy. Current occupancy was the dominant predictor. Model provided well-calibrated prediction intervals.
- **Relevance**: Validates the mean-reversion approach — current occupancy is the anchor, and the model learns how it reverts over 1-4 hours. Their per-hour model structure (separate model for each hour) is worth considering vs. a single model with hour as a feature. Prediction intervals are valuable for uncertainty communication.

### 6. Sudarshan et al. (2021) — "ED patient arrivals forecasting with weather and calendar"
- **Source**: Computers in Biology and Medicine, August 2021
- **URL**: https://pubmed.ncbi.nlm.nih.gov/34166880/
- **Method**: Compared Random Forest, LSTM, CNN with calendar + meteorological features
- **Data**: Single hospital ED, multi-year daily data
- **Key finding**: CNN best for short-term (3-day) forecasting (MAPE 9.24%). LSTM best for 7-day horizon (MAPE 8.91%). Weather forecast data improved predictions over weather history alone. For current-day prediction, LSTM achieved MAPE of 8.04%.
- **Relevance**: Confirms that including weather forecast (not just current weather) improves forward-looking predictions. Our model should use Open-Meteo forecast data for the next 24 hours, not just current conditions.

### 7. BMC Medical Informatics (2024) — "Enhanced forecasting with feature engineering"
- **Source**: BMC Medical Informatics and Decision Making, December 2024
- **URL**: https://bmcmedinformdecismak.biomedcentral.com/articles/10.1186/s12911-024-02788-6
- **Method**: 6 ML algorithms (including LightGBM, SVM-RBF, NNAR) across 11 EDs in 3 countries, 7-day and 45-day horizons
- **Data**: Multi-site, multi-country, daily arrivals
- **Key finding**: LightGBM and NNAR consistently top performers across sites. Feature-engineered variables from timestamps (lag features, rolling averages, cyclical encodings) were critical. LightGBM is first-reported for ED arrival prediction in this study.
- **Relevance**: Multi-site validation of LightGBM. Confirms our algorithm choice. Feature engineering matters more than algorithm selection.

### 8. Cureus / PMC (2025) — "XGBoost with temporal feature engineering"
- **Source**: PMC, 2025
- **URL**: https://pmc.ncbi.nlm.nih.gov/articles/PMC12273526/
- **Method**: XGBoost regression with engineered temporal features (day of week, month, week of year, quarter, weekend flag, lag values, rolling averages)
- **Data**: Synthetic hospital data (3 hospitals, 300 days each) from Kaggle
- **Key finding**: XGBoost with temporal features markedly outperformed naive baselines (lag-1, constant mean, 3-day rolling mean). Noted key limitation: absence of external predictors (weather, holidays, public health alerts).
- **Relevance**: Even on synthetic data, temporal feature engineering + XGBoost significantly beats naive approaches. Our model has the advantage of real external features (EDAS, weather, flu).

### 9. Nature Scientific Data (2022) — "MIMIC-IV-ED benchmark"
- **Source**: Nature Scientific Data, October 2022
- **URL**: https://www.nature.com/articles/s41597-022-01782-9
- **Data**: MIMIC-IV-ED database — 400,000+ ED visits from 2011-2019, publicly available
- **Key finding**: Simpler ML models (XGBoost, LightGBM) performed as well as or better than complex deep learning (Med2Vec, LSTM) on ED prediction tasks. Overly complex models don't improve performance on relatively low-dimensional ED data.
- **Relevance**: Reinforces that LightGBM/XGBoost is the right choice over deep learning for our use case. We should not over-engineer the model architecture.

### 10. Exhaustive Review — Araz et al. / PMC (2020)
- **Source**: PMC, 2020
- **URL**: https://pmc.ncbi.nlm.nih.gov/articles/PMC7738299/
- **Summary**: Comprehensive review of 102 papers on statistical forecasting in hospital EDs, covering 9 application themes including patient demand, crowding, wait time, and resource utilization.
- **Key findings**: Time series models dominate (27% of all studies). SARIMA is the most widely used. Regression and hybrid approaches are underexplored. Most studies use daily or monthly granularity; hourly forecasting is less common but growing. Weather and calendar variables are the most common external predictors.
- **Relevance**: Confirms our approach is well-grounded in literature. Hourly forecasting with ML + external features is an active research area with room for contribution.

---

## Recommended Model Architecture for This Project

Based on the literature, the following architecture is well-supported:

### Algorithm: LightGBM (gradient boosted trees)
- Consistently top-performing across multiple studies and ED sites
- Handles mixed feature types natively
- Fast training, exportable to JSON for frontend evaluation
- Interpretable via feature importance (SHAP values)

### Features (ordered by expected importance):

**Real-time ED state (from EDAS — highest impact):**
- `ed_census_score` (1-4, current capacity level)
- `num_ems_units` (ambulances at ED)
- `num_units_enroute` (ambulances inbound — leading indicator)
- `max_dwell_time` (longest EMS unit stay — proxy for congestion severity)
- `any_alert_active` (yellow/red/reroute — binary)
- `deviation_from_baseline` (current score minus expected for this hour/day — the mean reversion signal)

**Lag features (derived from EDAS collection history):**
- Census score at T-1h, T-2h, T-4h, T-8h, T-24h
- Rolling mean census score over past 3h, 6h, 12h
- Same hour yesterday, same hour same weekday last week
- Rate of change over past 2 hours (trending up or down)

**Temporal / calendar:**
- Hour of day (sin/cos encoded)
- Day of week (sin/cos encoded)
- Month (sin/cos encoded)
- `is_weekend`, `is_holiday`
- `hours_until_shift_change` (shift changes at 7am, 3pm, 11pm)
- `hours_since_midnight` (linear for within-day position)

**Environmental:**
- Temperature (current and forecast for prediction horizon)
- Precipitation (current and forecast)
- Weekly flu/ILI rate from CDC FluView

**Hospital identity:**
- Hospital code (label encoded)
- Hospital system (LifeBridge, Hopkins, UMMS, MedStar, Other)
- Historical baseline volume for this hospital × month

### Target Variable
- `ed_census_score` at time T+h (h = 1, 2, 4, 8, 12, 24 hours ahead)
- Either treat as regression (1.0-4.0 continuous) or multiclass classification (4 classes)
- Regression is likely better since census scores have ordinal meaning

### Training Approach
- Time-based train/test split (never random — preserves temporal ordering)
- Walk-forward validation for time series integrity
- Hyperparameter tuning via cross-validation with time-series-aware folds
- Evaluate with MAE, RMSE, and calibration plots
- Feature importance via SHAP to validate that the model is learning sensible relationships

### Mean Reversion Behavior
The model should naturally learn mean reversion from the data:
- When current census score is elevated relative to the historical baseline for this hour/day, the `deviation_from_baseline` feature will be positive
- The lag features will show the recent trajectory
- The temporal features tell the model whether demand is likely to increase (approaching peak hours) or decrease (approaching evening)
- The model learns the decay rate from observed historical patterns — how quickly elevated readings typically resolve, conditioned on time of day, day of week, and external factors

This is the core insight: the model doesn't need an explicit mean-reversion formula. It learns the reversion dynamics from the feature structure, particularly `deviation_from_baseline` + temporal features + lag features.
