const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT
        id,
        regexp_replace(cnic, '\\D', '', 'g') AS key,
        row_number() OVER (
          PARTITION BY regexp_replace(cnic, '\\D', '', 'g')
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM "Voter"
      WHERE cnic_key IS NULL
        AND length(regexp_replace(cnic, '\\D', '', 'g')) = 13
    )
    UPDATE "Voter" AS v
    SET cnic_key = ranked.key
    FROM ranked
    WHERE v.id = ranked.id
      AND ranked.rn = 1
      AND NOT EXISTS (
        SELECT 1 FROM "Voter" AS existing
        WHERE existing.cnic_key = ranked.key
      );
  `);

  const duplicates = await prisma.$queryRawUnsafe(`
    SELECT key, COUNT(*)::int AS count
    FROM (
      SELECT regexp_replace(cnic, '\\D', '', 'g') AS key
      FROM "Voter"
      WHERE length(regexp_replace(cnic, '\\D', '', 'g')) = 13
    ) AS normalized
    GROUP BY key
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, key ASC
    LIMIT 20;
  `);

  console.log(`Backfilled cnic_key on ${updated} voter rows.`);
  if (duplicates.length) {
    console.warn('Legacy duplicate CNICs still need manual review:');
    for (const row of duplicates) {
      console.warn(`  ${row.key}: ${row.count}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
