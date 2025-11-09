// Sequelize CLI config (CommonJS) - use .cjs because project is ESM
// Load environment variables from .env when running via npx sequelize-cli
try { require('dotenv').config({ override: true }); } catch (e) { /* ignore if dotenv not installed */ }

const envOr = (v) => (typeof v === 'string' ? v.trim() : v);

module.exports = {
  development: {
    username: envOr(process.env.DB_USERNAME),
    password: envOr(process.env.DB_PASSWORD),
    database: envOr(process.env.DB_NAME),
    host: envOr(process.env.DB_HOST),
    port: envOr(process.env.DB_PORT) ? Number(envOr(process.env.DB_PORT)) : undefined,
    dialect: envOr(process.env.DB_DIALECT) || 'postgres',
    logging: String(envOr(process.env.SEQUELIZE_LOGGING || 'false')) === 'true'
  },
  test: {
    username: envOr(process.env.DB_USERNAME),
    password: envOr(process.env.DB_PASSWORD),
    database: envOr(process.env.DB_NAME),
    host: envOr(process.env.DB_HOST),
    port: envOr(process.env.DB_PORT) ? Number(envOr(process.env.DB_PORT)) : undefined,
    dialect: envOr(process.env.DB_DIALECT) || 'postgres',
    logging: String(envOr(process.env.SEQUELIZE_LOGGING || 'false')) === 'true'
  },
  production: {
    username: envOr(process.env.DB_USERNAME),
    password: envOr(process.env.DB_PASSWORD),
    database: envOr(process.env.DB_NAME),
    host: envOr(process.env.DB_HOST),
    port: envOr(process.env.DB_PORT) ? Number(envOr(process.env.DB_PORT)) : undefined,
    dialect: envOr(process.env.DB_DIALECT) || 'postgres',
    logging: String(envOr(process.env.SEQUELIZE_LOGGING || 'false')) === 'true'
  }
};
