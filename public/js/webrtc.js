/**
 * WebRTC P2P Manager with RTCDataChannel streaming, backpressure flow control,
 * and chunked file transfer protocol.
 */

class WebRTCManager {
  constructor(options = {}) {
    this.options = Object.assign({
      chunkSize: 64 * 1024, // 64 KB per chunk
      bufferThreshold: 512 * 1024, // 512 KB backpressure threshold
      stunServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    }, options);

    this.ws = null;
    this.pc = null;
    this.dataChannel = null;
    this.isInitiator = false;
    this.roomId = null;
    this.peerId = null;
    this.iceCandidateQueue = [];

    // Active transfers
    this.activeSendingTransfer = null;
    this.activeReceivingTransfer = null;

    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onPeerReady = options.onPeerReady || (() => {});
    this.onPeerLeft = options.onPeerLeft || (() => {});
    this.onTransferProgress = options.onTransferProgress || (() => {});
    this.onFileReceived = options.onFileReceived || (() => {});
    this.onError = options.onError || (() => {});
    this.onChannelOpen = options.onChannelOpen || (() => {});
    this.onChannelClose = options.onChannelClose || (() => {});
  }

  /**
   * Connect to the WebSocket signaling server
   */
  connectSignaling() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.onStatusChange({ state: 'connected-signaling', message: 'Connected to signaling server' });
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleSignalingMessage(msg);
      } catch (err) {
        console.error('Failed to parse signaling message:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.error('Signaling WebSocket error:', err);
      this.onError('Signaling server connection error.');
    };

    this.ws.onclose = () => {
      this.onStatusChange({ state: 'disconnected', message: 'Disconnected from signaling server' });
    };
  }

  sendSignaling(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * Create a new room
   */
  createRoom() {
    this.sendSignaling('create-room');
  }

  /**
   * Join an existing room by code
   */
  joinRoom(roomId) {
    this.sendSignaling('join-room', { roomId });
  }

  /**
   * Handle messages from the signaling server
   */
  async handleSignalingMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'room-created': {
        this.roomId = payload.roomId;
        this.peerId = payload.peerId;
        this.isInitiator = true;
        this.onStatusChange({
          state: 'waiting-for-peer',
          roomId: this.roomId,
          message: `Room ${this.roomId} created. Waiting for peer...`
        });
        break;
      }

      case 'room-joined': {
        this.roomId = payload.roomId;
        this.peerId = payload.peerId;
        this.isInitiator = false;
        this.onStatusChange({
          state: 'joined-room',
          roomId: this.roomId,
          message: `Joined room ${this.roomId}. Initializing P2P...`
        });
        break;
      }

      case 'peer-ready': {
        this.onStatusChange({
          state: 'peer-paired',
          message: 'Peer discovered! Establishing encrypted WebRTC DataChannel...'
        });
        await this.setupPeerConnection();

        if (this.isInitiator) {
          // Initiator creates DataChannel and generates Offer
          this.createDataChannel();
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.sendSignaling('signal', { type: 'offer', sdp: this.pc.localDescription });
        }
        break;
      }

      case 'signal': {
        await this.handleSignalData(payload);
        break;
      }

      case 'peer-disconnected': {
        this.closePeerConnection();
        this.onPeerLeft();
        this.onStatusChange({
          state: 'peer-disconnected',
          message: 'Remote peer disconnected.'
        });
        break;
      }

      case 'error': {
        this.onError(payload.message || 'Unknown signaling error.');
        break;
      }
    }
  }

  /**
   * Setup RTCPeerConnection instance
   */
  async setupPeerConnection() {
    this.closePeerConnection();

    this.pc = new RTCPeerConnection({
      iceServers: this.options.stunServers
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling('signal', {
          type: 'candidate',
          candidate: event.candidate
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc ? this.pc.connectionState : 'closed';
      if (state === 'connected') {
        this.onStatusChange({
          state: 'p2p-connected',
          message: 'Direct P2P Link Established (DTLS-SRTP Encrypted)'
        });
      } else if (state === 'disconnected' || state === 'failed') {
        this.onStatusChange({
          state: 'p2p-disconnected',
          message: 'P2P Connection lost or failed.'
        });
      }
    };

    // If receiver, handle incoming DataChannel
    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  /**
   * Initiator creates DataChannel
   */
  createDataChannel() {
    if (!this.pc) return;
    const channel = this.pc.createDataChannel('encrypted-file-channel', {
      ordered: true
    });
    this.setupDataChannel(channel);
  }

  /**
   * Configure RTCDataChannel handlers
   */
  setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = this.options.bufferThreshold;

    const onChannelReady = () => {
      this.onChannelOpen();
      this.onStatusChange({
        state: 'ready-to-transfer',
        message: 'Secure DataChannel ready for encrypted file transfer'
      });
    };

    if (this.dataChannel.readyState === 'open') {
      onChannelReady();
    } else {
      this.dataChannel.onopen = onChannelReady;
    }

    this.dataChannel.onclose = () => {
      this.onChannelClose();
    };

    this.dataChannel.onerror = (err) => {
      console.error('DataChannel error:', err);
      this.onError('DataChannel transfer error occurred.');
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };
  }

  /**
   * Handle WebRTC SDP Offer/Answer and ICE Candidates
   */
  async handleSignalData(data) {
    if (data.type === 'candidate') {
      if (this.pc && this.pc.remoteDescription && this.pc.remoteDescription.type) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      } else {
        this.iceCandidateQueue.push(data.candidate);
      }
      return;
    }

    if (!this.pc) {
      await this.setupPeerConnection();
    }

    if (data.type === 'offer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await this.drainQueuedCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignaling('signal', { type: 'answer', sdp: this.pc.localDescription });

    } else if (data.type === 'answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await this.drainQueuedCandidates();
    }
  }

  async drainQueuedCandidates() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Error adding queued ICE candidate:', e);
      }
    }
  }

  /**
   * Send a file over the DataChannel with backpressure flow control
   * @param {File} file
   * @param {string} precomputedSha256
   * @param {Function} [onStatus]
   */
  async sendFile(file, precomputedSha256, onStatus = null) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('WebRTC DataChannel is not open.');
    }

    const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const chunkSize = this.options.chunkSize;
    const totalChunks = Math.ceil(file.size / chunkSize);

    this.activeSendingTransfer = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      sha256: precomputedSha256,
      cancelled: false
    };

    // 1. Send File Metadata Header
    const metadata = {
      type: 'file-metadata',
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      sha256: precomputedSha256,
      totalChunks,
      chunkSize
    };

    this.dataChannel.send(JSON.stringify(metadata));

    // 2. Stream Chunks with backpressure flow control
    const startTime = performance.now();
    let lastTime = startTime;
    let bytesSent = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (this.activeSendingTransfer.cancelled) {
        this.dataChannel.send(JSON.stringify({ type: 'file-cancel', fileId }));
        return false;
      }

      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const slice = file.slice(start, end);
      const arrayBuffer = await slice.arrayBuffer();

      // Check backpressure on RTCDataChannel buffer
      while (this.dataChannel.bufferedAmount > this.dataChannel.bufferedAmountLowThreshold) {
        await new Promise((resolve) => {
          this.dataChannel.onbufferedamountlow = () => {
            this.dataChannel.onbufferedamountlow = null;
            resolve();
          };
        });
      }

      // Send binary chunk
      this.dataChannel.send(arrayBuffer);
      bytesSent += arrayBuffer.byteLength;

      // Rate and Progress Calculation
      const now = performance.now();
      if (now - lastTime >= 100 || chunkIndex === totalChunks - 1) {
        const elapsedSec = (now - startTime) / 1000;
        const speedMBps = elapsedSec > 0 ? (bytesSent / (1024 * 1024)) / elapsedSec : 0;
        const percent = Math.min(100, Math.round((bytesSent / file.size) * 100));
        const remainingBytes = file.size - bytesSent;
        const etaSeconds = speedMBps > 0 ? (remainingBytes / (1024 * 1024)) / speedMBps : 0;

        this.onTransferProgress({
          direction: 'send',
          fileId,
          fileName: file.name,
          bytesTransferred: bytesSent,
          totalBytes: file.size,
          percent,
          speedMBps,
          etaSeconds,
          currentChunk: chunkIndex + 1,
          totalChunks
        });

        lastTime = now;
      }
    }

    // 3. Send Completion Signal
    this.dataChannel.send(JSON.stringify({
      type: 'file-end',
      fileId,
      sha256: precomputedSha256
    }));

    this.activeSendingTransfer = null;
    return true;
  }

  /**
   * Cancel an ongoing sending transfer
   */
  cancelSending() {
    if (this.activeSendingTransfer) {
      this.activeSendingTransfer.cancelled = true;
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify({
          type: 'file-cancel',
          fileId: this.activeSendingTransfer.fileId
        }));
      }
      this.activeSendingTransfer = null;
    }
  }

  /**
   * Handle incoming DataChannel messages (control JSON or binary chunks)
   */
  async handleDataChannelMessage(data) {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        await this.handleControlMessage(msg);
      } catch (e) {
        console.error('Invalid control message JSON:', e);
      }
    } else if (data instanceof ArrayBuffer) {
      this.handleBinaryChunk(data);
    } else if (data instanceof Blob) {
      const buffer = await data.arrayBuffer();
      this.handleBinaryChunk(buffer);
    }
  }

  /**
   * Handle incoming control JSON messages
   */
  async handleControlMessage(msg) {
    switch (msg.type) {
      case 'file-metadata': {
        this.activeReceivingTransfer = {
          fileId: msg.fileId,
          fileName: msg.name,
          fileSize: msg.size,
          mimeType: msg.mimeType,
          senderSha256: msg.sha256,
          totalChunks: msg.totalChunks,
          chunkSize: msg.chunkSize,
          receivedChunks: [],
          bytesReceived: 0,
          startTime: performance.now(),
          lastTime: performance.now()
        };

        this.onTransferProgress({
          direction: 'receive',
          fileId: msg.fileId,
          fileName: msg.name,
          bytesTransferred: 0,
          totalBytes: msg.size,
          percent: 0,
          speedMBps: 0,
          etaSeconds: 0,
          currentChunk: 0,
          totalChunks: msg.totalChunks
        });
        break;
      }

      case 'file-end': {
        if (!this.activeReceivingTransfer || this.activeReceivingTransfer.fileId !== msg.fileId) {
          return;
        }

        const t = this.activeReceivingTransfer;
        const reconstructedBlob = new Blob(t.receivedChunks, { type: t.mimeType || 'application/octet-stream' });
        
        // Notify verification in progress
        this.onTransferProgress({
          direction: 'receive',
          fileId: t.fileId,
          fileName: t.fileName,
          bytesTransferred: t.fileSize,
          totalBytes: t.fileSize,
          percent: 100,
          verifying: true,
          currentChunk: t.totalChunks,
          totalChunks: t.totalChunks
        });

        // Compute local SHA-256 hash using Web Crypto API
        const receiverSha256 = await window.CryptoUtils.computeBlobSha256(reconstructedBlob);
        const isVerified = window.CryptoUtils.verifyHashes(t.senderSha256, receiverSha256);

        const objectUrl = URL.createObjectURL(reconstructedBlob);

        this.onFileReceived({
          fileId: t.fileId,
          fileName: t.fileName,
          fileSize: t.fileSize,
          mimeType: t.mimeType,
          blob: reconstructedBlob,
          downloadUrl: objectUrl,
          senderSha256: t.senderSha256,
          receiverSha256: receiverSha256,
          isVerified: isVerified
        });

        this.activeReceivingTransfer = null;
        break;
      }

      case 'file-cancel': {
        if (this.activeReceivingTransfer && this.activeReceivingTransfer.fileId === msg.fileId) {
          this.activeReceivingTransfer = null;
          this.onError('File transfer was cancelled by sender.');
        }
        break;
      }
    }
  }

  /**
   * Handle incoming binary ArrayBuffer chunk
   */
  handleBinaryChunk(arrayBuffer) {
    const t = this.activeReceivingTransfer;
    if (!t) return;

    t.receivedChunks.push(arrayBuffer);
    t.bytesReceived += arrayBuffer.byteLength;

    const now = performance.now();
    if (now - t.lastTime >= 100 || t.receivedChunks.length === t.totalChunks) {
      const elapsedSec = (now - t.startTime) / 1000;
      const speedMBps = elapsedSec > 0 ? (t.bytesReceived / (1024 * 1024)) / elapsedSec : 0;
      const percent = Math.min(100, Math.round((t.bytesReceived / t.fileSize) * 100));
      const remainingBytes = t.fileSize - t.bytesReceived;
      const etaSeconds = speedMBps > 0 ? (remainingBytes / (1024 * 1024)) / speedMBps : 0;

      this.onTransferProgress({
        direction: 'receive',
        fileId: t.fileId,
        fileName: t.fileName,
        bytesTransferred: t.bytesReceived,
        totalBytes: t.fileSize,
        percent,
        speedMBps,
        etaSeconds,
        currentChunk: t.receivedChunks.length,
        totalChunks: t.totalChunks
      });

      t.lastTime = now;
    }
  }

  /**
   * Disconnect and clean up WebRTC
   */
  closePeerConnection() {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (e) {}
      this.dataChannel = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch (e) {}
      this.pc = null;
    }

    this.activeSendingTransfer = null;
    this.activeReceivingTransfer = null;
    this.iceCandidateQueue = [];
  }

  /**
   * Leave room and close all connections
   */
  disconnect() {
    this.closePeerConnection();
    if (this.ws) {
      this.sendSignaling('leave-room');
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.roomId = null;
    this.peerId = null;
    this.isInitiator = false;
  }
}

window.WebRTCManager = WebRTCManager;
