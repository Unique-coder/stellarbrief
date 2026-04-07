import { Keypair } from "@stellar/stellar-sdk";

const keypair = Keypair.random();

console.log("=== New Stellar Testnet Keypair ===");
console.log(`Public Key:  ${keypair.publicKey()}`);
console.log(`Secret Key:  ${keypair.secret()}`);
console.log("");
console.log("Fund this account on testnet:");
console.log(
  `https://friendbot.stellar.org?addr=${keypair.publicKey()}`
);
console.log("");
console.log("Add to your .env file:");
console.log(`STELLAR_SECRET_KEY=${keypair.secret()}`);
