import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  CashuWallet,
  CashuMint,
  type MintKeyset,
  type MintKeys,
  type GetInfoResponse,
  type Proof,
  SerializedBlindedSignature,
  OutputData,
} from "@cashu/cashu-ts";
import { WalletDatabase } from "./db";
import {
  fromPrivateKey,
  bytesToHex,
  type PublicKey,
  generateSilentKeys,
} from "../crypto";
import { payCashuAddress } from "./pay";
import { fetchSpentSecrets, scanForPayments } from "./scan";
import { logger, parseCashuAddress, sumProofs } from "../utils";

export type WalletConfig = {
  mintUrl?: string;
  dbPath?: string;
};

export type SilentPaymentKeys = {
  scan_privkey: Uint8Array;
  scan_pubkey: PublicKey;
  spend_privkey: Uint8Array;
  spend_pubkey: PublicKey;
};

export class Wallet extends CashuWallet {
  private database: WalletDatabase;
  private mintUrl: string;

  constructor(
    mint: CashuMint,
    options: any,
    database: WalletDatabase,
    mintUrl: string,
  ) {
    super(mint, options);
    this.database = database;
    this.mintUrl = mintUrl;
  }

  static async create(config?: WalletConfig): Promise<Wallet> {
    const dbPath = config?.dbPath || "./cashu-wallet.db";
    const defaultMintUrl = config?.mintUrl || "http://localhost:8085";

    const database = new WalletDatabase(dbPath);

    let cachedMnemonic = await database.getMnemonic();

    if (!cachedMnemonic) {
      const newMnemonic = bip39.generateMnemonic(wordlist);
      await database.saveMnemonic(newMnemonic);
      cachedMnemonic = newMnemonic;
    }

    const seed = bip39.mnemonicToSeedSync(cachedMnemonic);
    const mint = new CashuMint(defaultMintUrl);

    let keysets: MintKeyset[];
    let allKeys: MintKeys[];
    let mintInfo: GetInfoResponse;

    const cachedData = await database.getCachedMintData(defaultMintUrl);

    if (cachedData) {
      console.log("Using cached mint data");
      keysets = cachedData.keysets;
      allKeys = cachedData.keys;
      mintInfo = cachedData.mintInfo;
    } else {
      console.log("Fetching fresh mint data");
      const keysetResponse = await mint.getKeySets();
      keysets = keysetResponse.keysets;

      const [keysResults, mintInfoResult] = await Promise.all([
        Promise.all(
          keysets.map(async (k) => (await mint.getKeys(k.id)).keysets[0]),
        ),
        mint.getInfo(),
      ]);

      allKeys = keysResults;
      mintInfo = mintInfoResult;

      await database.cacheMintData(defaultMintUrl, {
        keysets,
        keys: allKeys,
        mintInfo,
      });
      console.log("Cached fresh mint data");
    }

    const wallet = new Wallet(
      mint,
      {
        bip39seed: seed,
        keys: allKeys,
        keysets: keysets,
        mintInfo: mintInfo,
        unit: "sat",
        denominationTarget: 1,
      },
      database,
      defaultMintUrl,
    );

    // to force setting the keyset ID
    await wallet.loadMint();

    return wallet;
  }

  async getBalance(): Promise<number> {
    return await this.database.getBalance();
  }

  async addProofs(proofs: Proof[]): Promise<void> {
    return await this.database.addProofs(proofs);
  }

  async getStoredProofs(): Promise<Proof[]> {
    return await this.database.getProofs();
  }

  async removeProofs(secrets: string[]): Promise<void> {
    return await this.database.removeProofs(secrets);
  }

  async getSilentPaymentKeys(): Promise<SilentPaymentKeys> {
    let keys = await this.database.getSilentPaymentKeys();

    if (!keys) {
      // Generate new keys
      const { scanPrivkey, scanPubkey, spendPrivkey, spendPubkey } =
        generateSilentKeys();

      const keysToStore = {
        scan_privkey: bytesToHex(scanPrivkey),
        scan_pubkey: scanPubkey.toHex(true),
        spend_privkey: bytesToHex(spendPrivkey),
        spend_pubkey: spendPubkey.toHex(true),
      };

      await this.database.saveSilentPaymentKeys(keysToStore);

      return {
        scan_privkey: scanPrivkey,
        scan_pubkey: scanPubkey,
        spend_privkey: spendPrivkey,
        spend_pubkey: spendPubkey,
      };
    }

    // Convert stored hex strings back to proper types
    const scan_privkey = new Uint8Array(Buffer.from(keys.scan_privkey, "hex"));
    const spend_privkey = new Uint8Array(
      Buffer.from(keys.spend_privkey, "hex"),
    );
    const scan_pubkey = fromPrivateKey(scan_privkey);
    const spend_pubkey = fromPrivateKey(spend_privkey);

    return {
      scan_privkey,
      scan_pubkey,
      spend_privkey,
      spend_pubkey,
    };
  }

  async getCashuAddress(): Promise<string> {
    const keys = await this.getSilentPaymentKeys();
    // Format: mintUrl:scanPubkey:spendPubkey
    return `${this.mintUrl}:${keys.scan_pubkey.toHex(
      true,
    )}:${keys.spend_pubkey.toHex(true)}`;
  }

  async payCashuAddress(
    address: string,
    amount: number,
  ): Promise<{
    bobProofs: Array<Proof>;
    aliceChange: Array<Proof>;
    spentSecret: string;
  }> {
    const proofs = await this.getStoredProofs();
    const { send: proofsToSpend } = this.selectProofsToSend(proofs, amount);

    const { mintUrl, scanPubkey, spendPubkey } = parseCashuAddress(address);

    if (mintUrl !== this.mintUrl) {
      throw new Error(
        `Paying to a different mint is not implemented. Your mint: ${this.mintUrl}, Target mint: ${mintUrl}`,
      );
    }

    const result = await payCashuAddress(
      this,
      proofsToSpend,
      scanPubkey,
      spendPubkey,
      amount,
    );

    const spentSecrets = proofsToSpend.map((p) => p.secret);
    await this.removeProofs(spentSecrets);

    if (result.aliceChange.length > 0) {
      await this.addProofs(result.aliceChange);
    }

    return result;
  }

  async scanForPayments(): Promise<string[]> {
    const keys = await this.getSilentPaymentKeys();
    const spentSecrets = await fetchSpentSecrets(this.mintUrl);
    const restoredProofs = await scanForPayments(this, keys, spentSecrets);

    logger.info(`Found ₿${sumProofs(restoredProofs)}`);

    if (restoredProofs.length === 0) {
      logger.info(`No unspent proofs found`);
      return [];
    }

    const wallet = await getWallet();
    const { send: swappedProofs } = await wallet.swap(
      sumProofs(restoredProofs),
      restoredProofs,
    );

    logger.info(`Swapped ₿${sumProofs(swappedProofs)}`);

    await this.addProofs(swappedProofs);
    return swappedProofs.map((p) => p.secret);
  }

  /**
   * Restores proofs by getting the blinded signatures from the mint.
   *
   * @param outputData the output data to restore outputs from
   * @param keysetId the keyset id used to deterministically create the output data
   */
  async restoreFromOutputData(
    outputData: { send: OutputData[]; keep: OutputData[] },
    keysetId: string,
  ): Promise<
    { send: Proof[]; keep: Proof[] } | { send: Proof[]; keep: Proof[] }
  > {
    const keys = await this.getKeys(keysetId);
    const allOutputData = [...outputData.send, ...outputData.keep];

    const { outputs, signatures } = await this.mint.restore({
      outputs: allOutputData.map((d) => d.blindedMessage),
    });

    const signatureMap: { [sig: string]: SerializedBlindedSignature } = {};
    outputs.forEach((o, i) => {
      signatureMap[o.B_] = signatures[i];
    });

    const restoredProofs: Proof[] = [];

    for (let i = 0; i < allOutputData.length; i++) {
      const matchingSig = signatureMap[allOutputData[i].blindedMessage.B_];
      if (matchingSig) {
        allOutputData[i].blindedMessage.amount = matchingSig.amount;
        restoredProofs.push(allOutputData[i].toProof(matchingSig, keys));
      }
    }

    const textDecoder = new TextDecoder();
    return {
      send: restoredProofs.filter((proof) =>
        outputData.send.some(
          (s) => textDecoder.decode(s.secret) === proof.secret,
        ),
      ),
      keep: restoredProofs.filter((proof) =>
        outputData.keep.some(
          (s) => textDecoder.decode(s.secret) === proof.secret,
        ),
      ),
    };
  }

  closeDatabase(): void {
    this.database.close();
  }
}

let walletInstance: Wallet | null = null;
let walletPromise: Promise<Wallet> | null = null;

export async function getWallet(config?: WalletConfig): Promise<Wallet> {
  if (walletInstance) {
    return walletInstance;
  }

  if (walletPromise) {
    return walletPromise;
  }

  walletPromise = Wallet.create(config);
  walletInstance = await walletPromise;

  return walletInstance;
}

export default { Wallet };
