import { Proof, MintKeys, OutputData } from "@cashu/cashu-ts";
import {
  ecdh,
  PublicKey,
  bytesToHex,
  blindMessage,
  BlindedMessage,
  createSilentOutput,
  randomKeyPair,
} from "../crypto";
import type { Wallet } from ".";
import { sumProofs } from "../utils";

export async function payCashuAddress(
  wallet: Wallet,
  proofs: Proof[],
  scan: PublicKey,
  spend: PublicKey,
  amount: number,
): Promise<{
  bobProofs: Array<Proof>;
  aliceChange: Array<Proof>;
  spentSecret: string;
}> {
  const amountToSpend = sumProofs(proofs);

  const { privkey: ephemeralPrivkey, pubkey: compressedPubkey } =
    randomKeyPair();

  // Creates outputs with Alice's pubkey as the secret
  const aliceFactory = (amount: number, keys: MintKeys): OutputData => {
    // TODO: this should be x-only so our special secret blends in with the other secrets
    const outputSecret = new TextEncoder().encode(bytesToHex(compressedPubkey));
    const { r, B_ } = blindMessage(outputSecret);
    return new OutputData(
      new BlindedMessage(amount, B_, keys.id).getSerializedBlindedMessage(),
      r,
      outputSecret,
    );
  };

  const {
    send: [specialProof],
  } = await wallet.send(amountToSpend, proofs, {
    outputData: { send: aliceFactory },
  });

  const ecdhShared = ecdh(ephemeralPrivkey, scan);

  let outputCounter = 0;
  const { keep: aliceChange, send: bobProofs } = await wallet.send(
    amount,
    [specialProof],
    {
      outputData: {
        send: (amount, keys) =>
          createSilentOutput(amount, keys, ecdhShared, spend, outputCounter++),
      },
    },
  );

  return { bobProofs, aliceChange, spentSecret: bytesToHex(compressedPubkey) };
}
