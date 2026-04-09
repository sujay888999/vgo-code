const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: 'api-platform-postgres',
    port: 5432,
    database: 'api_platform',
    user: 'postgres',
    password: 'YFUuq7o6-r_TdII6pIvd-6Wu2_5-XIV1',
  });

  await client.connect();

  // Update channel models array to use 'vgo-cs'
  await client.query(`
    UPDATE channels 
    SET models = '["vgo-cs"]'::jsonb
    WHERE name = 'local-ollama'
  `);
  console.log('Updated channel models array');

  // Update channel_model to use 'vgo-cs'
  await client.query(`
    UPDATE channel_models 
    SET model_name = 'vgo-cs'
    WHERE model_name = 'vgo-customer-service'
  `);
  console.log('Updated channel_model model_name');

  // Also update model catalog
  console.log('Done updating to vgo-cs');

  await client.end();
}

main().catch(console.error);
