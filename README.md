# P2P Encrypted File Dropper (WebRTC)

A direct browser-to-browser encrypted file transfer tool that eliminates cloud storage entirely.

---

## ⚡ Core Architecture & Mechanisms

```
+-------------------------------------------------------------+
|                      Signaling Phase                         |
|   [Device A (Host)]  <--- WebSocket --->  [Device B (Peer)]  |
|         |          (SDP Offer/Answer & ICE)      |          |
+---------|----------------------------------------|-----------+
          |                                        |
          v                                        v
+-------------------------------------------------------------+
|               Direct WebRTC Peer Connection                 |
|   [Device A (Host)] <===================> [Device B (Peer)] |
|         |          DTLS-SRTP Encrypted           |          |
|         |           DataChannel Stream           |          |
|         |                                        |          |
|    1. Computes SHA-256                     2. Streams Chunks|
|    2. Streams 64KB chunks                   in memory       |
|    3. Flow control backpressure            3. Reassembles   |
|                                            4. Verifies hash |
|                                               (SHA-256)     |
+-------------------------------------------------------------+
```

### 1. Zero Cloud Storage & Minimal Signaling
- The Node.js server serves **only** as a minimal signaling broker for exchanging WebRTC session descriptions (SDP Offer/Answer) and ICE candidates.
- **Files NEVER touch the server or any intermediary cloud storage**.
- Once the direct WebRTC DataChannel opens, the WebSocket signaling connection is idle.

### 2. Device Pairing (Short Room Code & QR Scan)
- **6-character Room Code**: Host creates a session and receives an easy-to-type room code (e.g. `8FK72A`).
- **QR Scan**: High-resolution scannable QR code generated locally (pointing to `http://<LAN-IP>:3030/?room=CODE`). Smartphone cameras automatically parse the link and join the room instantly.
- **Direct Link**: 1-click "Copy Join Link" with pre-filled room parameters.

### 3. Chunked Streaming with Backpressure Flow Control
- Files are sliced into **64 KB chunks** (`ArrayBuffer`) and streamed over the `RTCDataChannel`.
- **Backpressure Handling**: Uses `bufferedAmountLowThreshold` (512 KB). If the WebRTC socket buffer exceeds the threshold, the sender pauses chunk streaming until `onbufferedamountlow` triggers, preventing memory bloat and connection drops on large multi-hundred megabyte or multi-gigabyte transfers.

### 4. Local SHA-256 Cryptographic Hash Validation
- **Sender**: Pre-computes the SHA-256 hash of the selected file using the browser's native **Web Crypto API** (`crypto.subtle.digest`) or streaming slicing before transfer starts.
- **Receiver**: As chunks arrive and are reassembled into the target `Blob`, the receiver independently computes the SHA-256 checksum on the reconstructed bytes.
- **Integrity Validation**: Compares Sender SHA-256 vs Receiver SHA-256. If bit-exact, renders a glowing green **"✓ SHA-256 Verified: 100% Bit-Exact Match"** badge.

### 5. DTLS-SRTP Native Encryption
- WebRTC DataChannels are mandatorily encrypted at the transport layer using **DTLS** (Datagram Transport Layer Security) with ephemeral asymmetric keys generated per session, preventing eavesdropping and Man-In-The-Middle (MITM) attacks.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Modern web browser (Chrome, Edge, Firefox, Safari)

### Installation & Launch
```bash
# Install dependencies
npm install

# Start signaling server
npm start
```

The server will automatically display your access endpoints:
```
======================================================
🚀 P2P Encrypted File Dropper Signaling Server
======================================================
Local Access:    http://localhost:3030
LAN (Mobile/P2P): http://192.168.1.5:3030
Signaling WS:    ws://localhost:3030
======================================================
```

### Transferring Files Between Two Devices
1. **Device A (Host)**: Open `http://localhost:3030` (or `http://<LAN-IP>:3030`), click **"Create Pairing Room"**.
2. **Device B (Receiver)**: 
   - Point smartphone camera at the QR code on Device A's screen, OR
   - Open browser on Device B and enter the 6-character room code.
3. Once connected, the interface indicates **"Direct P2P Link Established (DTLS-SRTP Encrypted)"**.
4. Drag and drop any file or click to browse.
5. Click **"Stream via Direct WebRTC"**.
6. Device B displays real-time progress, speed (MB/s), ETA, and upon receipt automatically computes and validates the SHA-256 checksum before unlocking the **"Download File"** button.

---

## 🧪 Testing

Run the automated test suite verifying signaling room pairing and cryptographic SHA-256 bit-level accuracy across chunk boundaries:

```bash
npm test
```
