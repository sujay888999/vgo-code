import { MigrationInterface, QueryRunner } from "typeorm";

export class AddModelProtocolAndCachePricing1711958400000
  implements MigrationInterface
{
  name = "AddModelProtocolAndCachePricing1711958400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_models"
      ADD COLUMN IF NOT EXISTS "protocol" character varying(20) NOT NULL DEFAULT 'auto'
    `);
    await queryRunner.query(`
      ALTER TABLE "channel_models"
      ADD COLUMN IF NOT EXISTS "cache_write_price" numeric(10,4) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "channel_models"
      ADD COLUMN IF NOT EXISTS "cache_read_price" numeric(10,4) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "channel_models"
      DROP COLUMN IF EXISTS "cache_read_price"
    `);
    await queryRunner.query(`
      ALTER TABLE "channel_models"
      DROP COLUMN IF EXISTS "cache_write_price"
    `);
    await queryRunner.query(`
      ALTER TABLE "channel_models"
      DROP COLUMN IF EXISTS "protocol"
    `);
  }
}
