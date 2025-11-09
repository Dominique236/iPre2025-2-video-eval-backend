'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const sqlPath = path.resolve(process.cwd(), 'migrations', '001_create_tables.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    return queryInterface.sequelize.query(sql);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop tables in reverse dependency order
    const downSql = `
      DROP TABLE IF EXISTS evaluations;
      DROP TABLE IF EXISTS transcript_segments;
      DROP TABLE IF EXISTS video_chunks;
      DROP TABLE IF EXISTS videos;
      DROP TABLE IF EXISTS rubric_criteria;
      DROP TABLE IF EXISTS rubrics;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS workspaces;
    `;
    return queryInterface.sequelize.query(downSql);
  }
};
