declare module 'sql.js' {
  export interface Database {
    run(sql: string): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
  }

  export interface Statement {
    bind(params?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface SqlJsStatic {
    Database: new (bytes?: Uint8Array) => Database;
  }

  export default function initSqlJs(options?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
