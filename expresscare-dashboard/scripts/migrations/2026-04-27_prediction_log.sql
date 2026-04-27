-- prediction_log: append-only table of forecasts produced by realized_accuracy.py
-- and resolved against subsequent EDAS snapshots. Idempotent.

CREATE TABLE IF NOT EXISTS prediction_log (
  id                          SERIAL PRIMARY KEY,
  predicted_at                TIMESTAMPTZ NOT NULL,
  target_timestamp            TIMESTAMPTZ NOT NULL,
  hospital_code               TEXT NOT NULL,
  horizon_hours               INTEGER NOT NULL,
  predicted_score             DOUBLE PRECISION NOT NULL,
  current_score_at_prediction DOUBLE PRECISION,
  model_trained_at            TIMESTAMPTZ NOT NULL,
  actual_score                DOUBLE PRECISION,
  residual                    DOUBLE PRECISION,
  resolved_at                 TIMESTAMPTZ,
  UNIQUE (predicted_at, hospital_code, horizon_hours)
);

CREATE INDEX IF NOT EXISTS idx_prediction_log_target_unresolved
  ON prediction_log(target_timestamp) WHERE actual_score IS NULL;

CREATE INDEX IF NOT EXISTS idx_prediction_log_hospital_horizon
  ON prediction_log(hospital_code, horizon_hours, predicted_at DESC);
