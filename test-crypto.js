const crypto = require('crypto');
const fs = require('fs');

// Read our client crypto.js
const clientCryptoCode = fs.readFileSync('./public/js/crypto.js', 'utf8');

// Evaluate StreamingSHA256 in Node sandbox
const evalScope = {};
const scriptFunc = new Function('window', clientCryptoCode);
scriptFunc(evalScope);
const StreamingSHA256 = evalScope.StreamingSHA256;

console.log('Testing StreamingSHA256 vs Node crypto...');

const testVectors = [
  "",
  "Hello WebRTC P2P Dropper!",
  "The quick brown fox jumps over the lazy dog",
  "a".repeat(1000),
  "b".repeat(65536), // Exactly 1 chunk
  "c".repeat(131072) // 2 chunks
];

let allPassed = true;
for (const str of testVectors) {
  const buf = Buffer.from(str);
  
  // Node native SHA-256
  const nodeHash = crypto.createHash('sha256').update(buf).digest('hex');

  // Our StreamingSHA256
  const hasher = new StreamingSHA256();
  // Feed in varied slice sizes
  let offset = 0;
  const sliceSize = 37; // deliberate odd slice size to test boundary edge cases
  while (offset < buf.length) {
    const end = Math.min(offset + sliceSize, buf.length);
    hasher.update(new Uint8Array(buf.subarray(offset, end)));
    offset = end;
  }
  const customHash = hasher.digest();

  if (nodeHash === customHash) {
    console.log(`✓ Match for length ${buf.length}: ${customHash.slice(0, 16)}...`);
  } else {
    console.error(`❌ Mismatch for length ${buf.length}!`);
    console.error(`  Node:   ${nodeHash}`);
    console.error(`  Custom: ${customHash}`);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\n🎉 ALL CRYPTO SHA-256 TEST VECTORS PASSED PERFECTLY!\n');
} else {
  process.exit(1);
}
