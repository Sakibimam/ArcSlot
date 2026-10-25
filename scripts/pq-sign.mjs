/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- untyped Node test helper */
// SLH-DSA-SHA2-128s helper (FIPS 205) used by fork tests via vm.ffi and by tooling.
//   node scripts/pq-sign.mjs vk   <seedHex48>             -> 0x<32-byte verifying key>
//   node scripts/pq-sign.mjs sign <seedHex48> <msgHex>    -> 0x<7856-byte signature>
import { slh_dsa_sha2_128s as slh } from '@noble/post-quantum/slh-dsa.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

const strip = (h) => h.replace(/^0x/, '')
const [cmd, seedHex, msgHex] = process.argv.slice(2)
const keys = slh.keygen(hexToBytes(strip(seedHex)))
if (cmd === 'vk') process.stdout.write('0x' + bytesToHex(keys.publicKey))
else if (cmd === 'sign') process.stdout.write('0x' + bytesToHex(slh.sign(hexToBytes(strip(msgHex)), keys.secretKey)))
else { console.error('usage: vk <seed> | sign <seed> <msg>'); process.exit(1) }
