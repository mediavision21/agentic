DROP MATERIALIZED VIEW IF EXISTS macro.nordic;

CREATE MATERIALIZED VIEW macro.nordic AS
SELECT * FROM macro.nordic_base
UNION 
SELECT * FROM macro.nordic_avg