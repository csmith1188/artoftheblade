require('dotenv').config();
const dbHelpers = require('../server/db');

dbHelpers
  .initSchema()
  .then(() => {
    console.log('Database initialized, items seeded, and starter inventories ensured.');
    dbHelpers.db.close();
  })
  .catch((err) => {
    console.error('Error initializing database:', err);
    process.exitCode = 1;
    dbHelpers.db.close();
  });
