import { readFileSync, readdirSync } from 'node:fs';
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
    const directory = new URL('../../db/migrations/', import.meta.url);
    for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
      this.database.exec(readFileSync(new URL(name, directory), 'utf8'));
    }
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
