-- reminderweb 库的建表语句（唯一权威：go-rewrite/docs/mysql-schema-cloud.md 的 `reminderweb` 节）。
--
-- 服务迁移（//go:embed）与 tools/migrate-sqlite-to-mysql 建表共用本文件，两者不得各写一份。
-- 表名、列名、列类型、索引与引擎/字符集/排序规则与云库逐字一致；仅加 `IF NOT EXISTS`
-- 以保证空库自建与重复执行幂等（SHOW CREATE TABLE 的输出不受影响）。
-- `schema_version` 是迁移台账表，不属于业务表，不写入任何业务数据。
-- 禁止在此加入 DROP / TRUNCATE / 重建表语句。

CREATE TABLE IF NOT EXISTS `audit` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `at` bigint NOT NULL,
  `actor` longtext NOT NULL,
  `action` longtext NOT NULL,
  `detail` longtext,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `images` (
  `name` varchar(256) NOT NULL,
  `bytes` longblob NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `meta` (
  `key` varchar(256) NOT NULL,
  `value` longtext NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `reminders` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `payload` longtext NOT NULL,
  `updated_at` bigint NOT NULL,
  `deleted` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `token_hash` varchar(256) NOT NULL,
  `username` longtext NOT NULL,
  `created_at` bigint NOT NULL,
  `expires_at` bigint NOT NULL,
  PRIMARY KEY (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  `k` varchar(256) NOT NULL,
  `payload` longtext NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `tags` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `payload` longtext NOT NULL,
  `updated_at` bigint NOT NULL,
  `deleted` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `username` varchar(256) NOT NULL,
  `salt` longtext NOT NULL,
  `hash` longtext NOT NULL,
  `created_at` bigint NOT NULL,
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `schema_version` (
  `version` bigint NOT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
