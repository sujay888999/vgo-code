import dataSource from "./data-source";

async function main() {
  await dataSource.initialize();
  try {
    const migrations = await dataSource.runMigrations();
    console.log(
      `[migrations] completed: ${migrations.map((item) => item.name).join(", ") || "none"}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error("[migrations] failed", error);
  process.exit(1);
});
