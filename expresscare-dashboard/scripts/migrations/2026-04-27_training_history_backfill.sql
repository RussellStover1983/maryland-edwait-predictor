-- training_history backfill: insert one row representing the manual 4/17 retrain
-- so the table has a baseline data point even before the next cron-driven retrain.
--
-- Safe to run after the next weekly_refresh.py invocation has created the table.
-- Re-running is harmless: the timestamp+trigger combination acts as a logical key,
-- and the WHERE NOT EXISTS guard makes this idempotent.

INSERT INTO training_history (
    trained_at, trigger, train_rows, test_rows, feature_count,
    mae_1h, rmse_1h,
    mae_4h, rmse_4h,
    train_date_min, train_date_max, test_date_min, test_date_max,
    hospital_count, notes
)
SELECT
    '2026-04-17 13:06:08+00'::timestamptz,
    'manual',
    98675, 24669, 38,
    0.2488812923106965, 0.4635975520944871,
    0.5081087956948972, 0.7279009933091165,
    '2026-04-07 17:00:17+00'::timestamptz, '2026-04-15 22:13:06+00'::timestamptz,
    '2026-04-15 22:13:06+00'::timestamptz, '2026-04-17 12:13:50+00'::timestamptz,
    82,
    'Backfilled from training_meta artifact at plan-write time'
WHERE NOT EXISTS (
    SELECT 1 FROM training_history
    WHERE trained_at = '2026-04-17 13:06:08+00'::timestamptz
);
