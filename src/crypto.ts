import { sha256 } from "@noble/hashes/sha256";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, randomBytes } from "@noble/curves/utils";
import type { WeierstrassPoint } from "@noble/curves/abstract/weierstrass";
import {
  MintKeys,
  OutputData,
  SerializedBlindedMessage,
} from "@cashu/cashu-ts";
import { bytesToNumber } from "@cashu/cashu-ts/crypto/util";
import { blindMessage } from "@cashu/cashu-ts/crypto/client";

export { secp256k1, bytesToHex };
export { blindMessage } from "@cashu/cashu-ts/crypto/client";

export type PublicKey = WeierstrassPoint<bigint>;
export type PrivateKey = Uint8Array;

export const deriveSilentSecrets = (
  sharedSecret: PrivateKey,
  spendPubkey: PublicKey,
  k: number,
): { secret: Uint8Array; blindingFactor: bigint } => {
  const tweak = hash("silent_output", sharedSecret, new Uint8Array([k]));
  const tweakPoint = fromPrivateKey(tweak);
  const outputPoint = pointAdd(spendPubkey, tweakPoint);
  const outputSecretBytes = hash("output", outputPoint.toBytes(true));
  const outputSecret = new TextEncoder().encode(bytesToHex(outputSecretBytes));
  const deterministicR = bytesToNumber(
    hash("blinder", outputSecretBytes, new Uint8Array([k])),
  );

  return {
    secret: outputSecret,
    blindingFactor: deterministicR,
  };
};

export const createSilentOutput = (
  amount: number,
  keys: MintKeys,
  sharedSecret: PrivateKey,
  spendPubkey: PublicKey,
  k: number,
): OutputData => {
  const { secret, blindingFactor } = deriveSilentSecrets(
    sharedSecret,
    spendPubkey,
    k,
  );
  const { r, B_ } = blindMessage(secret, blindingFactor);
  return new OutputData(
    new BlindedMessage(amount, B_, keys.id).getSerializedBlindedMessage(),
    r,
    secret,
  );
};

export function randomKeyPair(): { privkey: PrivateKey; pubkey: Uint8Array } {
  const privkey = randomBytes(32);
  const pubkey = fromPrivateKey(privkey).toBytes(true);
  return { privkey, pubkey };
}

export function generateSilentKeys() {
  const scanPrivkey = randomBytes(32);
  const spendPrivkey = randomBytes(32);
  const scanPubkey = fromPrivateKey(scanPrivkey);
  const spendPubkey = fromPrivateKey(spendPrivkey);
  return { scanPrivkey, scanPubkey, spendPrivkey, spendPubkey };
}

export function fromPrivateKey(privkey: PrivateKey): PublicKey {
  return secp256k1.Point.BASE.multiply(secp256k1.Point.Fn.fromBytes(privkey));
}

export function ecdh(privkey: PrivateKey, pubkey: PublicKey) {
  return secp256k1.getSharedSecret(privkey, pubkey.toHex(true), true);
}

function pointAdd(point1: PublicKey, point2: PublicKey): PublicKey {
  return point1.add(point2);
}

function hash(...inputs: (string | Uint8Array)[]) {
  const toHash = inputs
    .map((i) => (typeof i === "string" ? new TextEncoder().encode(i) : i))
    .reduce((prev, curr) => {
      const combo = new Uint8Array(prev.length + curr.length);
      combo.set(prev);
      combo.set(curr, prev.length);
      return combo;
    }, new Uint8Array());

  return sha256(toHash);
}

export class BlindedMessage {
  amount: number;
  B_: WeierstrassPoint<bigint>;
  id: string;

  constructor(amount: number, B_: WeierstrassPoint<bigint>, id: string) {
    this.amount = amount;
    this.B_ = B_;
    this.id = id;
  }

  getSerializedBlindedMessage(): SerializedBlindedMessage {
    return {
      amount: this.amount,
      B_: this.B_.toHex(true),
      id: this.id,
    };
  }
}
