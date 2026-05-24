import localforage from 'localforage';
import initSqlJs, { type Database, type QueryExecResult, type SqlJsStatic } from 'sql.js';
import type {
  DashboardStatusFilter,
  FamilySummary,
  QuickFilters,
  SearchFilters,
  VoterRecord,
  VoterStatus
} from './types';

const STORAGE_KEY = 'voters-db-bytes';

const STATUS_ORDER: VoterStatus[] = ['Supporter', 'Leaning', 'Undecided', 'Opposition', 'Hostile', 'Unsurveyed'];

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function buildQuickFilterClauses(filters: QuickFilters): { clause: string; params: unknown[] }[] {
  const clauses: { clause: string; params: unknown[] }[] = [];

  if (filters.youth) {
    clauses.push({ clause: 'CAST(COALESCE(age, 0) AS INTEGER) BETWEEN 18 AND 35', params: [] });
  }

  if (filters.studentTeacher) {
    clauses.push({ clause: "(LOWER(COALESCE(profession, '')) LIKE ? OR LOWER(COALESCE(profession, '')) LIKE ?)", params: ['%student%', '%teacher%'] });
  }

  if (filters.male) {
    clauses.push({ clause: "CAST(substr(replace(COALESCE(cnic, ''), '-', ''), -1, 1) AS INTEGER) % 2 = 1", params: [] });
  }

  if (filters.female) {
    clauses.push({ clause: "CAST(substr(replace(COALESCE(cnic, ''), '-', ''), -1, 1) AS INTEGER) % 2 = 0", params: [] });
  }

  return clauses;
}

function makeWhereClause(filters: SearchFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const query = normalize(filters.query);

  if (query) {
    const like = `%${escapeLike(query)}%`;
    clauses.push('(cnic LIKE ? ESCAPE \'\\\' OR serial_no LIKE ? ESCAPE \'\\\' OR name LIKE ? ESCAPE \'\\\' OR father_husband_name LIKE ? ESCAPE \'\\\')');
    params.push(like, like, like, like);
  }

  for (const clause of buildQuickFilterClauses(filters.quickFilters)) {
    clauses.push(clause.clause);
    params.push(...clause.params);
  }

  if (filters.dashboardStatus !== 'all') {
    clauses.push("LOWER(COALESCE(voter_status, '')) = LOWER(?)");
    params.push(filters.dashboardStatus);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

function rowsToObjects(result: QueryExecResult): Record<string, unknown>[] {
  return result.values.map((values) =>
    result.columns.reduce<Record<string, unknown>>((accumulator, column, index) => {
      accumulator[column] = values[index];
      return accumulator;
    }, {})
  );
}

export class OfflineVoterDatabase {
  private sqlPromise: Promise<SqlJsStatic> | null = null;
  private database: Database | null = null;
  private readyPromise: Promise<void> | null = null;

  private async getSql(): Promise<SqlJsStatic> {
    if (!this.sqlPromise) {
      this.sqlPromise = initSqlJs({
        locateFile: (file) => `/${file}`
      });
    }

    return this.sqlPromise;
  }

  private async persist(): Promise<void> {
    if (!this.database) {
      return;
    }

    const bytes = this.database.export();
    await localforage.setItem(STORAGE_KEY, bytes);
  }

  private createSchema(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS voters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_code TEXT NOT NULL,
        serial_no TEXT NOT NULL,
        name TEXT NOT NULL,
        father_husband_name TEXT NOT NULL,
        cnic TEXT NOT NULL,
        profession TEXT DEFAULT '',
        age INTEGER,
        address TEXT NOT NULL,
        inferred_family_id TEXT NOT NULL,
        voter_status TEXT NOT NULL DEFAULT 'Unsurveyed',
        is_on_duty INTEGER NOT NULL DEFAULT 0
      );
    `);

    db.run('CREATE INDEX IF NOT EXISTS idx_voters_block_address ON voters(block_code, address);');
    db.run('CREATE INDEX IF NOT EXISTS idx_voters_family ON voters(inferred_family_id);');
    db.run('CREATE INDEX IF NOT EXISTS idx_voters_name ON voters(name);');
    db.run('CREATE INDEX IF NOT EXISTS idx_voters_cnic ON voters(cnic);');
    db.run('CREATE INDEX IF NOT EXISTS idx_voters_serial ON voters(serial_no);');
    db.run('CREATE INDEX IF NOT EXISTS idx_voters_status ON voters(voter_status);');
  }

  private async loadDatabaseFromBytes(bytes: Uint8Array | null): Promise<void> {
    const sql = await this.getSql();
    this.database = bytes ? new sql.Database(bytes) : new sql.Database();
    this.createSchema(this.database);
  }

  async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        const stored = await localforage.getItem<ArrayBuffer | Uint8Array>(STORAGE_KEY);
        const bytes = stored instanceof Uint8Array ? stored : stored ? new Uint8Array(stored) : null;
        await this.loadDatabaseFromBytes(bytes);
        if (!bytes) {
          await this.persist();
        }
      })();
    }

    return this.readyPromise;
  }

  async replaceFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<void> {
    const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await this.loadDatabaseFromBytes(buffer);
    await this.persist();
  }

  async importFile(file: File): Promise<void> {
    const bytes = await file.arrayBuffer();
    await this.replaceFromBytes(bytes);
  }

  async exportBytes(): Promise<Uint8Array> {
    await this.ensureReady();
    if (!this.database) {
      throw new Error('Database is not available.');
    }

    return this.database.export();
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ensureReady();
    if (!this.database) {
      return [];
    }

    const statement = this.database.prepare(sql);
    statement.bind(params);
    const rows: T[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    statement.free();
    return rows;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.ensureReady();
    if (!this.database) {
      throw new Error('Database is not available.');
    }

    const statement = this.database.prepare(sql);
    statement.bind(params);
    while (statement.step()) {
      // Intentionally exhaust the statement so sql.js applies the mutation.
    }
    statement.free();
    await this.persist();
  }

  async executeBatch(sqlStatements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.ensureReady();
    if (!this.database) {
      throw new Error('Database is not available.');
    }

    this.database.run('BEGIN;');
    try {
      for (const statement of sqlStatements) {
        const prepared = this.database.prepare(statement.sql);
        prepared.bind(statement.params ?? []);
        while (prepared.step()) {
          // Mutation is committed by sql.js when the statement is stepped.
        }
        prepared.free();
      }
      this.database.run('COMMIT;');
      await this.persist();
    } catch (error) {
      this.database.run('ROLLBACK;');
      throw error;
    }
  }

  async updateVoterStatus(id: number, voterStatus: VoterStatus): Promise<void> {
    await this.execute('UPDATE voters SET voter_status = ? WHERE id = ?', [voterStatus, id]);
  }

  async updateVoterName(id: number, name: string): Promise<void> {
    await this.execute('UPDATE voters SET name = ? WHERE id = ?', [name, id]);
  }

  async markDutyStaff(ids: number[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) {
      return;
    }

    const placeholders = uniqueIds.map(() => '?').join(',');
    await this.execute(`UPDATE voters SET is_on_duty = 1 WHERE id IN (${placeholders})`, uniqueIds);
  }

  async getVoterById(id: number): Promise<VoterRecord | null> {
    const rows = await this.query<VoterRecord>('SELECT * FROM voters WHERE id = ? LIMIT 1', [id]);
    return rows[0] ?? null;
  }

  async getFamilySummaries(filters: SearchFilters): Promise<FamilySummary[]> {
    const { where, params } = makeWhereClause(filters);
    const rows = await this.query<FamilySummary>(
      `
        SELECT
          inferred_family_id,
          block_code,
          address,
          COUNT(*) AS total_votes,
          SUM(CASE WHEN LOWER(voter_status) = 'supporter' THEN 1 ELSE 0 END) AS supporters,
          SUM(CASE WHEN LOWER(voter_status) = 'leaning' THEN 1 ELSE 0 END) AS leaning,
          SUM(CASE WHEN LOWER(voter_status) = 'undecided' THEN 1 ELSE 0 END) AS undecided,
          SUM(CASE WHEN LOWER(voter_status) = 'opposition' THEN 1 ELSE 0 END) AS opposition,
          SUM(CASE WHEN LOWER(voter_status) = 'hostile' THEN 1 ELSE 0 END) AS hostile,
          SUM(CASE WHEN LOWER(voter_status) = 'unsurveyed' THEN 1 ELSE 0 END) AS unsurveyed
        FROM voters
        ${where}
        GROUP BY inferred_family_id, block_code, address
        ORDER BY total_votes DESC, address ASC, inferred_family_id ASC
        LIMIT 5000
      `,
      params
    );

    return rows;
  }

  async getFamilyMembers(familyId: string): Promise<VoterRecord[]> {
    return this.query<VoterRecord>(
      `
        SELECT *
        FROM voters
        WHERE inferred_family_id = ?
        ORDER BY CAST(serial_no AS INTEGER) ASC, id ASC
      `,
      [familyId]
    );
  }

  async getDashboardCounts(filters: SearchFilters): Promise<Record<string, number>> {
    const { where, params } = makeWhereClause(filters);
    const rows = await this.query<Record<string, unknown>>(
      `
        SELECT
          SUM(CASE WHEN LOWER(voter_status) = 'supporter' THEN 1 ELSE 0 END) AS supporter,
          SUM(CASE WHEN LOWER(voter_status) = 'leaning' THEN 1 ELSE 0 END) AS leaning,
          SUM(CASE WHEN LOWER(voter_status) = 'undecided' THEN 1 ELSE 0 END) AS undecided,
          SUM(CASE WHEN LOWER(voter_status) = 'opposition' THEN 1 ELSE 0 END) AS opposition,
          SUM(CASE WHEN LOWER(voter_status) = 'hostile' THEN 1 ELSE 0 END) AS hostile,
          SUM(CASE WHEN LOWER(voter_status) = 'unsurveyed' THEN 1 ELSE 0 END) AS unsurveyed,
          COUNT(*) AS total
        FROM voters
        ${where}
      `,
      params
    );

    const row = rows[0] ?? {};
    return {
      supporter: Number(row.supporter ?? 0),
      leaning: Number(row.leaning ?? 0),
      undecided: Number(row.undecided ?? 0),
      opposition: Number(row.opposition ?? 0),
      hostile: Number(row.hostile ?? 0),
      unsurveyed: Number(row.unsurveyed ?? 0),
      total: Number(row.total ?? 0)
    };
  }

  async searchVoters(filters: SearchFilters, limit = 5000): Promise<VoterRecord[]> {
    const { where, params } = makeWhereClause(filters);
    return this.query<VoterRecord>(
      `
        SELECT *
        FROM voters
        ${where}
        ORDER BY block_code ASC, address ASC, inferred_family_id ASC, CAST(serial_no AS INTEGER) ASC, id ASC
        LIMIT ${limit}
      `,
      params
    );
  }

  async getUndecidedTargets(): Promise<VoterRecord[]> {
    return this.query<VoterRecord>(
      `
        SELECT *
        FROM voters
        WHERE LOWER(voter_status) IN ('undecided', 'unsurveyed')
        ORDER BY address ASC, block_code ASC, CAST(serial_no AS INTEGER) ASC, id ASC
      `
    );
  }

  async getDutyStaffTargets(): Promise<VoterRecord[]> {
    return this.query<VoterRecord>(
      `
        SELECT *
        FROM voters
        WHERE is_on_duty = 1
        ORDER BY address ASC, block_code ASC, CAST(serial_no AS INTEGER) ASC, id ASC
      `
    );
  }

  async getFamilyInfluenceRows(): Promise<Array<FamilySummary & { head_name: string }>> {
    const families = await this.getFamilySummaries({ query: '', dashboardStatus: 'all', quickFilters: { youth: false, studentTeacher: false, male: false, female: false } });
    const rows: Array<FamilySummary & { head_name: string }> = [];

    for (const family of families) {
      const members = await this.getFamilyMembers(family.inferred_family_id);
      const head = members.find((member) => this.isHouseholdHead(member, members)) ?? members[0];
      rows.push({ ...family, head_name: head?.name ?? '' });
    }

    return rows.sort((left, right) => right.total_votes - left.total_votes);
  }

  isHouseholdHead(candidate: VoterRecord, familyMembers: VoterRecord[]): boolean {
    const candidateName = normalize(candidate.name).toLowerCase();
    const matchedAsRelative = familyMembers.some((member) => normalize(member.father_husband_name).toLowerCase() === candidateName);
    return !matchedAsRelative;
  }

  getStatusOrder(): VoterStatus[] {
    return [...STATUS_ORDER];
  }
}

export const offlineVoterDatabase = new OfflineVoterDatabase();
