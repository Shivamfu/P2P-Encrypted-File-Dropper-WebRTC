/**
 * Cryptographic utilities for client-side SHA-256 hashing and integrity verification.
 * Uses native Web Crypto API (SubtleCrypto) with streaming fallback for massive files.
 */

class CryptoUtils {
  /**
   * Convert an ArrayBuffer or Uint8Array to a lowercase hex string
   * @param {ArrayBuffer|Uint8Array} buffer
   * @returns {string}
   */
  static bufferToHex(buffer) {
    const byteArray = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const hexParts = [];
    for (let i = 0; i < byteArray.length; i++) {
      const hex = byteArray[i].toString(16).padStart(2, '0');
      hexParts.push(hex);
    }
    return hexParts.join('');
  }

  /**
   * Compute SHA-256 hash using native Web Crypto API
   * @param {ArrayBuffer} buffer
   * @returns {Promise<string>} Hex-encoded SHA-256 hash
   */
  static async computeBufferSha256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return this.bufferToHex(hashBuffer);
  }

  /**
   * Compute SHA-256 hash of a File or Blob with streaming slicing
   * For files < 100MB, uses high-speed hardware SubtleCrypto.
   * For files >= 100MB, slices and processes with chunked array buffer.
   * @param {Blob|File} blob
   * @param {Function} [onProgress] - Optional progress callback (percent: number)
   * @returns {Promise<string>} Hex-encoded SHA-256 hash
   */
  static async computeBlobSha256(blob, onProgress = null) {
    // If under 150MB, subtleCrypto is blazing fast (hardware accelerated)
    if (blob.size < 150 * 1024 * 1024) {
      if (onProgress) onProgress(20);
      const buffer = await blob.arrayBuffer();
      if (onProgress) onProgress(75);
      const hash = await this.computeBufferSha256(buffer);
      if (onProgress) onProgress(100);
      return hash;
    }

    // For large files (> 150MB), use streaming chunked reader
    const streamHasher = new StreamingSHA256();
    const sliceSize = 4 * 1024 * 1024; // 4MB chunks
    const totalSlices = Math.ceil(blob.size / sliceSize);

    for (let i = 0; i < totalSlices; i++) {
      const start = i * sliceSize;
      const end = Math.min(start + sliceSize, blob.size);
      const slice = blob.slice(start, end);
      const buf = await slice.arrayBuffer();
      streamHasher.update(new Uint8Array(buf));

      if (onProgress) {
        onProgress(Math.round(((i + 1) / totalSlices) * 100));
      }
    }

    return streamHasher.digest();
  }

  /**
   * Truncate hash for compact UI display (e.g., e3b0c442...a98f)
   * @param {string} hash
   * @param {number} prefixLen
   * @param {number} suffixLen
   * @returns {string}
   */
  static truncateHash(hash, prefixLen = 8, suffixLen = 8) {
    if (!hash || hash.length <= prefixLen + suffixLen) return hash || '';
    return `${hash.slice(0, prefixLen)}...${hash.slice(-suffixLen)}`;
  }

  /**
   * Verify if two SHA-256 hashes match exactly
   * @param {string} hashA
   * @param {string} hashB
   * @returns {boolean}
   */
  static verifyHashes(hashA, hashB) {
    if (!hashA || !hashB) return false;
    return hashA.trim().toLowerCase() === hashB.trim().toLowerCase();
  }
}

/**
 * Pure JavaScript streaming SHA-256 implementation
 * Guarantees zero memory spikes when hashing multi-gigabyte files.
 */
class StreamingSHA256 {
  constructor() {
    this.K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    this.H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.totalBytes = 0;
    this.W = new Uint32Array(64);
  }

  update(chunk) {
    this.totalBytes += chunk.length;
    let offset = 0;

    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength;
      if (chunk.length >= needed) {
        this.buffer.set(chunk.subarray(0, needed), this.bufferLength);
        this.processBlock(this.buffer, 0);
        this.bufferLength = 0;
        offset = needed;
      } else {
        this.buffer.set(chunk, this.bufferLength);
        this.bufferLength += chunk.length;
        return;
      }
    }

    while (offset + 64 <= chunk.length) {
      this.processBlock(chunk, offset);
      offset += 64;
    }

    const remaining = chunk.length - offset;
    if (remaining > 0) {
      this.buffer.set(chunk.subarray(offset), 0);
      this.bufferLength = remaining;
    }
  }

  processBlock(data, offset) {
    const W = this.W;
    for (let i = 0; i < 16; i++) {
      const idx = offset + i * 4;
      W[i] = ((data[idx] << 24) | (data[idx + 1] << 16) | (data[idx + 2] << 8) | data[idx + 3]) >>> 0;
    }

    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const w2 = W[i - 2];
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this.H;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + this.K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.H[0] = (this.H[0] + a) >>> 0;
    this.H[1] = (this.H[1] + b) >>> 0;
    this.H[2] = (this.H[2] + c) >>> 0;
    this.H[3] = (this.H[3] + d) >>> 0;
    this.H[4] = (this.H[4] + e) >>> 0;
    this.H[5] = (this.H[5] + f) >>> 0;
    this.H[6] = (this.H[6] + g) >>> 0;
    this.H[7] = (this.H[7] + h) >>> 0;
  }

  digest() {
    const totalBits = this.totalBytes * 8;
    this.buffer[this.bufferLength] = 0x80;
    this.bufferLength++;

    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength, 64);
      this.processBlock(this.buffer, 0);
      this.buffer.fill(0, 0, 56);
    } else {
      this.buffer.fill(0, this.bufferLength, 56);
    }

    // 64-bit big endian length
    const hiBits = Math.floor(totalBits / 0x100000000);
    const loBits = totalBits >>> 0;

    this.buffer[56] = (hiBits >>> 24) & 0xff;
    this.buffer[57] = (hiBits >>> 16) & 0xff;
    this.buffer[58] = (hiBits >>> 8) & 0xff;
    this.buffer[59] = hiBits & 0xff;
    this.buffer[60] = (loBits >>> 24) & 0xff;
    this.buffer[61] = (loBits >>> 16) & 0xff;
    this.buffer[62] = (loBits >>> 8) & 0xff;
    this.buffer[63] = loBits & 0xff;

    this.processBlock(this.buffer, 0);

    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += this.H[i].toString(16).padStart(8, '0');
    }
    return hex;
  }
}

window.CryptoUtils = CryptoUtils;
window.StreamingSHA256 = StreamingSHA256;
