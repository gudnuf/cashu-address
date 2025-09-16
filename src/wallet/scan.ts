import type { Proof } from "@cashu/cashu-ts";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { Wallet, SilentPaymentKeys } from ".";
import { ecdh, createSilentOutput } from "../crypto";
import { logger, proofToY } from "../utils";

type SpentSecretsResponse = {
  secrets: string[];
};

export async function fetchSpentSecrets(mintUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${mintUrl}/v1/spent-secrets`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch spent secrets: ${response.status} ${response.statusText}`,
      );
    }
    const data: SpentSecretsResponse = await response.json();
    logger.info(`Fetched ${data.secrets.length} spent secrets`);
    return data.secrets;
  } catch (error) {
    logger.error("Error fetching spent secrets:", error);
    throw error;
  }
}

export async function scanForPayments(
  wallet: Wallet,
  silentKeys: SilentPaymentKeys,
  spentSecrets: Array<string>,
): Promise<Proof[]> {
  const keys = await wallet.getKeys();
  const restoredProofs: Proof[] = [];

  for (const secret of spentSecrets) {
    if (secret.length !== 66) {
      continue;
    }

    const ephemeralPoint = secp256k1.Point.fromHex(secret);
    const ecdhShared = ecdh(silentKeys.scan_privkey, ephemeralPoint);

    const maxOutputsToScan = 8;
    const potentialOutputData = Array.from(
      { length: maxOutputsToScan },
      (_, k) =>
        createSilentOutput(0, keys, ecdhShared, silentKeys.spend_pubkey, k),
    );

    logger.info(`Checking ${potentialOutputData.length} potential output data`);

    const { send: proofs } = await wallet.restoreFromOutputData(
      { send: potentialOutputData, keep: [] },
      wallet.keysetId,
    );

    //validate not spent
    const proofStates = await wallet.checkProofsStates(proofs);
    const unspent = proofStates.filter((p) => p.state === "UNSPENT");
    const unspentProofs = proofs
      .map((proof) => {
        const Y = proofToY(proof);
        const matchingState = unspent.find((p) => p.Y === Y);
        if (matchingState) return proof;
        return undefined;
      })
      .filter((p) => p !== undefined);
    restoredProofs.push(...unspentProofs);
  }

  return restoredProofs;
}
