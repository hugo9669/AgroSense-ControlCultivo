-- Esquema del DWH (Postgres). Idempotente: lo aplica Postgres al crear el volumen
-- y el ETL cada vez que arranca (por si el volumen ya existia).

-- Lecturas ya limpias (fuera de rango fisico o atipicas -> NULL)
CREATE TABLE IF NOT EXISTS lectura_limpia (
  entity_id     TEXT        NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  temperature   DOUBLE PRECISION,
  humidity      DOUBLE PRECISION,
  luminosity    DOUBLE PRECISION,
  soil_moisture DOUBLE PRECISION,
  es_imputado   BOOLEAN     DEFAULT FALSE,
  PRIMARY KEY (entity_id, ts)
);

ALTER TABLE lectura_limpia ADD COLUMN IF NOT EXISTS es_imputado BOOLEAN DEFAULT FALSE;

-- Agregado horario (alimenta graficas del front, la IA y Grafana)
CREATE TABLE IF NOT EXISTS resumen_horario (
  entity_id TEXT        NOT NULL,
  hora      TIMESTAMPTZ NOT NULL,
  temp_avg DOUBLE PRECISION,
  temp_min DOUBLE PRECISION,
  temp_max DOUBLE PRECISION,
  hum_avg  DOUBLE PRECISION,
  lux_avg  DOUBLE PRECISION,
  soil_avg DOUBLE PRECISION,
  n INT,
  PRIMARY KEY (entity_id, hora)
);

-- Agregado diario
CREATE TABLE IF NOT EXISTS resumen_diario (
  entity_id TEXT NOT NULL,
  dia       DATE NOT NULL,
  temp_avg DOUBLE PRECISION,
  temp_min DOUBLE PRECISION,
  temp_max DOUBLE PRECISION,
  hum_avg  DOUBLE PRECISION,
  hum_min  DOUBLE PRECISION,
  hum_max  DOUBLE PRECISION,
  lux_avg  DOUBLE PRECISION,
  lux_max  DOUBLE PRECISION,
  soil_avg DOUBLE PRECISION,
  soil_min DOUBLE PRECISION,
  n INT,
  PRIMARY KEY (entity_id, dia)
);

-- Advertencias (warning) y errores (error) detectados por el ETL
CREATE TABLE IF NOT EXISTS alerta (
  id        BIGSERIAL PRIMARY KEY,
  entity_id TEXT        NOT NULL,
  ts        TIMESTAMPTZ NOT NULL,
  severidad TEXT        NOT NULL CHECK (severidad IN ('warning', 'error')),
  variable  TEXT,
  tipo      TEXT        NOT NULL,
  mensaje   TEXT        NOT NULL,
  UNIQUE (entity_id, ts, tipo)
);

ALTER TABLE alerta ADD COLUMN IF NOT EXISTS variable TEXT;

CREATE INDEX IF NOT EXISTS alerta_ts_idx      ON alerta (ts DESC);
CREATE INDEX IF NOT EXISTS alerta_entidad_idx ON alerta (entity_id, tipo, ts DESC);
