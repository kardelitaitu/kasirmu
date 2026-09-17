-- Phase 3 residual: persist tip and service-charge on the sale. The POS
-- frontend collects both in the payment total but the backend cart never
-- knew about them, so the recorded sale total understated collected
-- revenue. New columns default to 0 for existing rows.
ALTER TABLE sales ADD COLUMN tip_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN service_charge_minor INTEGER NOT NULL DEFAULT 0;