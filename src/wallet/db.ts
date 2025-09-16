import { Database } from "sqlite3";
import type {
  MintKeyset,
  MintKeys,
  GetInfoResponse,
  Proof,
} from "@cashu/cashu-ts";

type CachedMintData = {
  keysets: MintKeyset[];
  keys: MintKeys[];
  mintInfo: GetInfoResponse;
  cachedAt: number;
};

const CACHE_EXPIRY_MS = 1 * 60 * 60 * 1000;

export type { CachedMintData };

class WalletDatabase {
  private db: Database;

  constructor(dbPath: string = "./cashu-wallet.db") {
    this.db = new Database(dbPath);
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
  
        CREATE TABLE IF NOT EXISTS mint_keysets (
          id TEXT PRIMARY KEY,
          unit TEXT NOT NULL,
          active BOOLEAN NOT NULL,
          input_fee_ppk INTEGER,
          mint_url TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        );
  
        CREATE TABLE IF NOT EXISTS mint_keys (
          id TEXT PRIMARY KEY,
          unit TEXT NOT NULL,
          final_expiry INTEGER,
          keys TEXT NOT NULL,
          mint_url TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        );
  
        CREATE TABLE IF NOT EXISTS mint_info (
          mint_url TEXT PRIMARY KEY,
          mint_info_json TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS proofs (
          id TEXT PRIMARY KEY,
          amount INTEGER NOT NULL,
          secret TEXT NOT NULL,
          C TEXT NOT NULL,
          keyset_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS silent_payment_keys (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          scan_privkey TEXT NOT NULL,
          scan_pubkey TEXT NOT NULL,
          spend_privkey TEXT NOT NULL,
          spend_pubkey TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
  }

  async getCachedMintData(mintUrl: string): Promise<CachedMintData | null> {
    const now = Date.now();
    const cutoff = now - CACHE_EXPIRY_MS;

    return new Promise((resolve, reject) => {
      // Get mint info
      this.db.get<{
        mint_info_json: string;
        cached_at: number;
      }>(
        "SELECT mint_info_json, cached_at FROM mint_info WHERE mint_url = ? AND cached_at > ?",
        [mintUrl, cutoff],
        (err, mintInfoRow) => {
          if (err) {
            reject(err);
            return;
          }
          if (!mintInfoRow) {
            resolve(null);
            return;
          }

          // Get keysets
          this.db.all<{
            id: string;
            unit: string;
            active: boolean;
            input_fee_ppk?: number;
          }>(
            "SELECT id, unit, active, input_fee_ppk FROM mint_keysets WHERE mint_url = ? AND cached_at > ?",
            [mintUrl, cutoff],
            (err, keysetRows) => {
              if (err) {
                reject(err);
                return;
              }

              // Get keys
              this.db.all<{
                id: string;
                unit: string;
                final_expiry?: number;
                keys: string;
              }>(
                "SELECT id, unit, final_expiry, keys FROM mint_keys WHERE mint_url = ? AND cached_at > ?",
                [mintUrl, cutoff],
                (err, keyRows) => {
                  if (err) {
                    reject(err);
                    return;
                  }

                  try {
                    const mintInfo: GetInfoResponse = JSON.parse(
                      mintInfoRow.mint_info_json,
                    );

                    const keysets: MintKeyset[] = keysetRows.map((row) => ({
                      id: row.id,
                      unit: row.unit,
                      active: row.active,
                      ...(row.input_fee_ppk !== null &&
                        row.input_fee_ppk !== undefined && {
                          input_fee_ppk: row.input_fee_ppk,
                        }),
                    }));

                    const keys: MintKeys[] = keyRows.map((row) => ({
                      id: row.id,
                      unit: row.unit,
                      ...(row.final_expiry !== null &&
                        row.final_expiry !== undefined && {
                          final_expiry: row.final_expiry,
                        }),
                      keys: JSON.parse(row.keys),
                    }));

                    resolve({
                      keysets,
                      keys,
                      mintInfo,
                      cachedAt: mintInfoRow.cached_at,
                    });
                  } catch (parseErr) {
                    reject(parseErr);
                  }
                },
              );
            },
          );
        },
      );
    });
  }

  async cacheMintData(
    mintUrl: string,
    data: {
      keysets: MintKeyset[];
      keys: MintKeys[];
      mintInfo: GetInfoResponse;
    },
  ): Promise<void> {
    const now = Date.now();

    return new Promise((resolve) => {
      this.db.serialize(() => {
        // Clear existing cache for this mint
        this.db.run("DELETE FROM mint_keysets WHERE mint_url = ?", [mintUrl]);
        this.db.run("DELETE FROM mint_keys WHERE mint_url = ?", [mintUrl]);
        this.db.run("DELETE FROM mint_info WHERE mint_url = ?", [mintUrl]);

        // Cache mint info
        this.db.run(
          `INSERT INTO mint_info (mint_url, mint_info_json, cached_at) 
             VALUES (?, ?, ?)`,
          [mintUrl, JSON.stringify(data.mintInfo), now],
        );

        // Cache keysets
        const keysetStmt = this.db.prepare(
          "INSERT INTO mint_keysets (id, unit, active, input_fee_ppk, mint_url, cached_at) VALUES (?, ?, ?, ?, ?, ?)",
        );
        data.keysets.forEach((keyset) => {
          keysetStmt.run([
            keyset.id,
            keyset.unit,
            keyset.active,
            keyset.input_fee_ppk,
            mintUrl,
            now,
          ]);
        });
        keysetStmt.finalize();

        // Cache keys
        const keysStmt = this.db.prepare(
          "INSERT INTO mint_keys (id, unit, final_expiry, keys, mint_url, cached_at) VALUES (?, ?, ?, ?, ?, ?)",
        );
        data.keys.forEach((keyData) => {
          keysStmt.run([
            keyData.id,
            keyData.unit,
            keyData.final_expiry,
            JSON.stringify(keyData.keys),
            mintUrl,
            now,
          ]);
        });
        keysStmt.finalize();

        resolve();
      });
    });
  }

  async clearMintCache(mintUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(
          "DELETE FROM mint_keysets WHERE mint_url = ?",
          [mintUrl],
          (err) => {
            if (err) reject(err);
          },
        );
        this.db.run(
          "DELETE FROM mint_keys WHERE mint_url = ?",
          [mintUrl],
          (err) => {
            if (err) reject(err);
          },
        );
        this.db.run(
          "DELETE FROM mint_info WHERE mint_url = ?",
          [mintUrl],
          (err) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });
    });
  }

  async getMnemonic(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      this.db.get<{ value: string }>(
        'SELECT value FROM config WHERE key = "mnemonic"',
        (err, row) => {
          if (err) reject(err);
          else if (!row) {
            resolve(null);
          } else {
            resolve(row.value);
          }
        },
      );
    });
  }

  async saveMnemonic(mnemonic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        "INSERT INTO config (key, value) VALUES (?, ?)",
        ["mnemonic", mnemonic],
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  async addProofs(proofs: Proof[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const stmt = this.db.prepare(
          "INSERT OR REPLACE INTO proofs (id, amount, secret, C, keyset_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        );

        const now = Date.now();
        for (const proof of proofs) {
          stmt.run([
            proof.id,
            proof.amount,
            proof.secret,
            proof.C,
            proof.id, // Using proof.id as keyset_id for now
            now,
          ]);
        }

        stmt.finalize((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async getProofs(): Promise<Proof[]> {
    return new Promise((resolve, reject) => {
      this.db.all<{
        id: string;
        amount: number;
        secret: string;
        C: string;
        keyset_id: string;
      }>(
        "SELECT id, amount, secret, C, keyset_id FROM proofs ORDER BY created_at DESC",
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const proofs: Proof[] = rows.map((row) => ({
            id: row.id,
            amount: row.amount,
            secret: row.secret,
            C: row.C,
          }));

          resolve(proofs);
        },
      );
    });
  }

  async getBalance(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.get<{ total: number }>(
        "SELECT SUM(amount) as total FROM proofs",
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row?.total || 0);
        },
      );
    });
  }

  async getSilentPaymentKeys(): Promise<{
    scan_privkey: string;
    scan_pubkey: string;
    spend_privkey: string;
    spend_pubkey: string;
  } | null> {
    return new Promise((resolve, reject) => {
      this.db.get<{
        scan_privkey: string;
        scan_pubkey: string;
        spend_privkey: string;
        spend_pubkey: string;
      }>(
        "SELECT scan_privkey, scan_pubkey, spend_privkey, spend_pubkey FROM silent_payment_keys WHERE id = 1",
        (err, row) => {
          if (err) reject(err);
          else if (!row) {
            resolve(null);
          } else {
            resolve(row);
          }
        },
      );
    });
  }

  async saveSilentPaymentKeys(keys: {
    scan_privkey: string;
    scan_pubkey: string;
    spend_privkey: string;
    spend_pubkey: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      this.db.run(
        "INSERT OR REPLACE INTO silent_payment_keys (id, scan_privkey, scan_pubkey, spend_privkey, spend_pubkey, created_at) VALUES (1, ?, ?, ?, ?, ?)",
        [
          keys.scan_privkey,
          keys.scan_pubkey,
          keys.spend_privkey,
          keys.spend_pubkey,
          now,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  async removeProofs(secrets: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (secrets.length === 0) {
        resolve();
        return;
      }

      const placeholders = secrets.map(() => "?").join(",");
      this.db.run(
        `DELETE FROM proofs WHERE secret IN (${placeholders})`,
        secrets,
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  close(): void {
    this.db.close();
  }
}

export { WalletDatabase };
