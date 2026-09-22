-- BudgetFlow V1 schema — run on DCISM MariaDB when available.
CREATE TABLE IF NOT EXISTS users (
  id                 CHAR(36) PRIMARY KEY,
  username           VARCHAR(32) NOT NULL UNIQUE,
  password_hash      VARCHAR(255) NOT NULL,
  gemini_api_key_enc VARBINARY(512) NULL,
  monthly_income     DECIMAL(12,2) NULL,
  hard_savings_goal  DECIMAL(12,2) NOT NULL DEFAULT 0,
  reminder_hour      TINYINT NOT NULL DEFAULT 19,
  onboarding_done    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL REFERENCES users(id),
  name        VARCHAR(48) NOT NULL,
  monthly_cap DECIMAL(12,2) NOT NULL,
  flexible    BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id            CHAR(36) PRIMARY KEY,
  user_id       CHAR(36) NOT NULL REFERENCES users(id),
  category_id   CHAR(36) NULL REFERENCES categories(id),
  amount        DECIMAL(12,2) NOT NULL,
  vendor        VARCHAR(120),
  note          VARCHAR(280),
  source        ENUM('chat','voice','receipt','guardian','scheduled') NOT NULL,
  raw_input     TEXT,
  recurring_id  CHAR(36) NULL REFERENCES recurring_payments(id),
  spent_at      TIMESTAMP NOT NULL,
  sts_before    DECIMAL(12,2) NOT NULL,
  sts_after     DECIMAL(12,2) NOT NULL,
  flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  refunded_from CHAR(36) NULL REFERENCES transactions(id),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, spent_at DESC)
);

CREATE TABLE IF NOT EXISTS trade_offs (
  id             CHAR(36) PRIMARY KEY,
  user_id        CHAR(36) NOT NULL REFERENCES users(id),
  transaction_id CHAR(36) NOT NULL REFERENCES transactions(id),
  overshoot      DECIMAL(12,2) NOT NULL,
  status         ENUM('auto','accepted','adjusted') NOT NULL DEFAULT 'auto',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_off_moves (
  id            CHAR(36) PRIMARY KEY,
  trade_off_id  CHAR(36) NOT NULL REFERENCES trade_offs(id),
  from_category CHAR(36) NOT NULL REFERENCES categories(id),
  amount        DECIMAL(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         CHAR(36) PRIMARY KEY,
  user_id    CHAR(36) NOT NULL REFERENCES users(id),
  role       ENUM('user','assistant') NOT NULL,
  kind       ENUM('text','log_card','tradeoff_card','clarify_chip','week_report','receipt_draft','nudge') NOT NULL DEFAULT 'text',
  payload    JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS guardian_links (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL REFERENCES users(id),
  token_hash  CHAR(64) NOT NULL UNIQUE,
  secret_code CHAR(8) NOT NULL,
  redeemed    BOOLEAN NOT NULL DEFAULT FALSE,
  last_viewed TIMESTAMP NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Money on a rhythm: transport on class days, a subscription on the 15th.
-- Posting is driven by the app on load, made idempotent by `last_posted_on`:
-- the engine posts every occurrence after that date up to today, then stamps it.
CREATE TABLE IF NOT EXISTS recurring_payments (
  id             CHAR(36) PRIMARY KEY,
  user_id        CHAR(36) NOT NULL REFERENCES users(id),
  name           VARCHAR(80) NOT NULL,
  category_id    CHAR(36) NULL REFERENCES categories(id),
  amount         DECIMAL(12,2) NOT NULL,
  cadence        ENUM('daily','weekly','monthly') NOT NULL,
  weekdays       VARCHAR(20) NOT NULL DEFAULT '',  -- weekly: "1,3,5"
  day_of_month   TINYINT NULL,                     -- monthly: 1-31, clamped
  start_date     DATE NOT NULL,
  end_date       DATE NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  last_posted_on DATE NULL,
  note           VARCHAR(280) NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, active)
);

-- Future purchases the user sets money aside for. Monthly set-asides are
-- reserved out of the flexible pool, so they can never be spent on impulse.
-- The invariant `fixed + savings + plans + flexible <= income` is enforced in
-- the app layer (src/lib/engine/plans.ts) before anything is written.
CREATE TABLE IF NOT EXISTS plans (
  id                CHAR(36) PRIMARY KEY,
  user_id           CHAR(36) NOT NULL REFERENCES users(id),
  name              VARCHAR(80) NOT NULL,
  target_amount     DECIMAL(12,2) NOT NULL,
  saved_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  monthly_set_aside DECIMAL(12,2) NOT NULL DEFAULT 0,
  target_date       DATE NULL,
  status            ENUM('active','done','paused') NOT NULL DEFAULT 'active',
  note              VARCHAR(280) NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, status)
);

CREATE TABLE IF NOT EXISTS day_stats (
  user_id       CHAR(36) NOT NULL,
  day           DATE NOT NULL,
  spent         DECIMAL(12,2) NOT NULL DEFAULT 0,
  sts_target    DECIMAL(12,2) NOT NULL DEFAULT 0,
  within_budget BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, day)
);
