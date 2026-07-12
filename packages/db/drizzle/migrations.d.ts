// drizzle-kit generate (driver: durable-sqlite) が出力する migrations.js の手書き型宣言。
// drizzle-orm/durable-sqlite/migrator の migrate() に渡すためだけの形。
interface DurableSqliteMigrations {
  journal: {
    version: string;
    dialect: string;
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  migrations: Record<string, string>;
}
declare const migrations: DurableSqliteMigrations;
export default migrations;
