import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

class TestStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestStatement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

export class TestD1Database {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    const migration = readFileSync(
      new URL('../../db/migrations/0001_initial.sql', import.meta.url),
      'utf8',
    );
    this.database.exec(migration);
  }

  prepare(sql) {
    return new TestStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
