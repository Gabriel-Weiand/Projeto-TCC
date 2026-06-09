import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

const isTest = process.env.NODE_ENV === 'test'

const dbConfig = defineConfig({
  connection: 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        // Banco isolado em testes — evita lock com `npm run dev` no mesmo arquivo
        filename: app.tmpPath(isTest ? 'test.sqlite3' : 'db.sqlite3'),
        ...(isTest ? { timeout: 10_000 } : {}),
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      ...(isTest
        ? {
            pool: {
              afterCreate(
                conn: { pragma: (statement: string) => unknown },
                done: (err?: Error | null) => void
              ) {
                conn.pragma('journal_mode = WAL')
                conn.pragma('busy_timeout = 10000')
                done()
              },
            },
          }
        : {}),
    },
  },
})

export default dbConfig
