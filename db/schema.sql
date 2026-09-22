-- BudgetFlow V1 schema. Idempotent: safe to run again at any time.
--
-- Two portability notes baked into this file:
-- 1. Foreign keys are declared as named table-level constraints rather than
--    inline column REFERENCES, and the statements are ordered so every
--    referenced table exists first (recurring_payments before transactions).
--    Inline REFERENCES is silently ignored by MySQL and rejected by some
--    MariaDB builds when the target table does not exist yet.
-- 2. No explicit CHARSET/COLLATE: tables inherit the server/database default,
--    which keeps every FK column pair on an identical collation (mismatched
--    collations are the other common errno 150).

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
  user_id     CHAR(36) NOT NULL,
  name        VARCHAR(48) NOT NULL,
  monthly_cap DECIMAL(12,2) NOT NULL,
  flexible    BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_cat_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS recurring_payments (
  id             CHAR(36) PRIMARY KEY,
  user_id        CHAR(36) NOT NULL,
  name           VARCHAR(80) NOT NULL,
  category_id    CHAR(36) NULL,
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
  INDEX idx_user (user_id, active),
  CONSTRAINT fk_rec_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_rec_cat FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id            CHAR(36) PRIMARY KEY,
  user_id       CHAR(36) NOT NULL,
  category_id   CHAR(36) NULL,
  amount        DECIMAL(12,2) NOT NULL,
  vendor        VARCHAR(120),
  note          VARCHAR(280),
  source        ENUM('chat','voice','receipt','guardian','scheduled') NOT NULL,
  raw_input     TEXT,
  recurring_id  CHAR(36) NULL,
  spent_at      TIMESTAMP NOT NULL,
  sts_before    DECIMAL(12,2) NOT NULL,
  sts_after     DECIMAL(12,2) NOT NULL,
  flagged       BOOLEAN NOT NULL DEFAULT FALSE,
  refunded_from CHAR(36) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, spent_at DESC),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_tx_cat FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_tx_rec FOREIGN KEY (recurring_id) REFERENCES recurring_payments(id),
  CONSTRAINT fk_tx_refund FOREIGN KEY (refunded_from) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS trade_offs (
  id             CHAR(36) PRIMARY KEY,
  user_id        CHAR(36) NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  overshoot      DECIMAL(12,2) NOT NULL,
  status         ENUM('auto','accepted','adjusted') NOT NULL DEFAULT 'auto',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_to_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_to_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS trade_off_moves (
  id            CHAR(36) PRIMARY KEY,
  trade_off_id  CHAR(36) NOT NULL,
  from_category CHAR(36) NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_tom_to FOREIGN KEY (trade_off_id) REFERENCES trade_offs(id),
  CONSTRAINT fk_tom_cat FOREIGN KEY (from_category) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         CHAR(36) PRIMARY KEY,
  user_id    CHAR(36) NOT NULL,
  role       ENUM('user','assistant') NOT NULL,
  kind       ENUM('text','log_card','tradeoff_card','clarify_chip','week_report','receipt_draft','nudge') NOT NULL DEFAULT 'text',
  payload    JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, created_at),
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS guardian_links (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  secret_code CHAR(8) NOT NULL,
  redeemed    BOOLEAN NOT NULL DEFAULT FALSE,
  last_viewed TIMESTAMP NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_guard_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Future purchases the user sets money aside for. Monthly set-asides are
-- reserved out of the flexible pool, so they can never be spent on impulse.
-- The invariant `fixed + savings + plans + flexible <= income` is enforced in
-- the app layer (src/lib/engine/plans.ts) before anything is written.
CREATE TABLE IF NOT EXISTS plans (
  id                CHAR(36) PRIMARY KEY,
  user_id           CHAR(36) NOT NULL,
  name              VARCHAR(80) NOT NULL,
  target_amount     DECIMAL(12,2) NOT NULL,
  saved_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  monthly_set_aside DECIMAL(12,2) NOT NULL DEFAULT 0,
  target_date       DATE NULL,
  status            ENUM('active','done','paused') NOT NULL DEFAULT 'active',
  note              VARCHAR(280) NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, status),
  CONSTRAINT fk_plan_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS day_stats (
  user_id       CHAR(36) NOT NULL,
  day           DATE NOT NULL,
  spent         DECIMAL(12,2) NOT NULL DEFAULT 0,
  sts_target    DECIMAL(12,2) NOT NULL DEFAULT 0,
  within_budget BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, day)
);
