/**
 * Main Frontend Application Controller for P2P Encrypted File Dropper
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const lanIpTag = document.getElementById('lan-ip-tag');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const soundIcon = document.getElementById('sound-icon');

  // Pairing UI
  const pairingCard = document.getElementById('pairing-card');
  const tabCreate = document.getElementById('tab-create');
  const tabJoin = document.getElementById('tab-join');
  const paneCreate = document.getElementById('pane-create');
  const paneJoin = document.getElementById('pane-join');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const roomCodeBox = document.getElementById('room-code-box');
  const roomDigits = document.getElementById('room-digits');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const qrBox = document.getElementById('qr-box');
  const joinInput = document.getElementById('join-input');
  const btnJoinRoom = document.getElementById('btn-join-room');

  // Connected Peer Banner
  const peerActiveBanner = document.getElementById('peer-active-banner');
  const peerIdLabel = document.getElementById('peer-id-label');
  const btnDisconnect = document.getElementById('btn-disconnect');

  // File Transfer UI
  const transferCard = document.getElementById('transfer-card');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const filePreview = document.getElementById('file-preview');
  const fileNameDisplay = document.getElementById('file-name-display');
  const fileSizeDisplay = document.getElementById('file-size-display');
  const fileHashDisplay = document.getElementById('file-hash-display');
  const btnSendFile = document.getElementById('btn-send-file');
  const btnClearFile = document.getElementById('btn-clear-file');

  // Active Transfer Dashboard
  const transferDashboard = document.getElementById('transfer-dashboard');
  const transferDirectionBadge = document.getElementById('transfer-direction-badge');
  const transferFileName = document.getElementById('transfer-file-name');
  const progressBar = document.getElementById('progress-bar');
  const statPercent = document.getElementById('stat-percent');
  const statSpeed = document.getElementById('stat-speed');
  const statBytes = document.getElementById('stat-bytes');
  const statEta = document.getElementById('stat-eta');
  const btnCancelTransfer = document.getElementById('btn-cancel-transfer');

  // Received Files Section
  const receivedSection = document.getElementById('received-section');
  const receivedList = document.getElementById('received-list');
  const toastContainer = document.getElementById('toast-container');

  // Initialize Audio & WebRTC
  const sound = new window.SoundEffects();
  updateSoundIcon();

  soundToggleBtn.addEventListener('click', () => {
    sound.toggleMute();
    updateSoundIcon();
    showToast(sound.isMuted() ? 'Audio muted' : 'Audio enabled');
  });

  function updateSoundIcon() {
    if (sound.isMuted()) {
      soundIcon.innerHTML = `<path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6m0-6l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
    } else {
      soundIcon.innerHTML = `<path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
    }
  }

  // Network Info
  let networkInfo = { localUrl: window.location.origin, networkUrl: window.location.origin };
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      networkInfo = await res.json();
      lanIpTag.textContent = `LAN: ${networkInfo.networkUrl}`;
    }
  } catch (e) {
    console.warn('Network info unavailable:', e);
  }

  // State
  let selectedFile = null;
  let selectedFileSha256 = null;

  // Initialize WebRTC
  const webrtc = new window.WebRTCManager({
    onStatusChange: (status) => {
      handleStatusChange(status);
    },
    onChannelOpen: () => {
      sound.playConnect();
      showToast('P2P DataChannel open and encrypted!');
      peerActiveBanner.style.display = 'flex';
      peerIdLabel.textContent = `Peer: ${webrtc.peerId || 'Connected'}`;
      pairingCard.style.display = 'none';
      transferCard.style.display = 'block';
    },
    onChannelClose: () => {
      showToast('DataChannel closed.');
      peerActiveBanner.style.display = 'none';
      transferCard.style.display = 'none';
      pairingCard.style.display = 'block';
    },
    onPeerLeft: () => {
      sound.playError();
      showToast('Remote peer disconnected.');
      peerActiveBanner.style.display = 'none';
      transferCard.style.display = 'none';
      pairingCard.style.display = 'block';
      hideTransferDashboard();
    },
    onTransferProgress: (progress) => {
      updateTransferDashboard(progress);
    },
    onFileReceived: (fileData) => {
      sound.playSuccess();
      hideTransferDashboard();
      addReceivedFileCard(fileData);
      showToast(`Received: ${fileData.fileName} (${formatBytes(fileData.fileSize)})`);
    },
    onError: (errMsg) => {
      sound.playError();
      showToast(errMsg, 'error');
    }
  });

  // Connect to Signaling Server
  webrtc.connectSignaling();

  // Status Change Handler
  function handleStatusChange(status) {
    const pulse = statusIndicator.querySelector('.pulse-circle');
    statusText.textContent = status.message || status.state;

    if (status.state === 'p2p-connected' || status.state === 'ready-to-transfer') {
      pulse.className = 'pulse-circle connected';
    } else if (status.state === 'disconnected' || status.state === 'peer-disconnected') {
      pulse.className = 'pulse-circle disconnected';
    } else {
      pulse.className = 'pulse-circle';
    }

    if (status.state === 'waiting-for-peer') {
      displayRoomCode(status.roomId);
    }
  }

  // Check URL parameters for ?room=CODE
  const urlParams = new URLSearchParams(window.location.search);
  const roomFromUrl = urlParams.get('room');
  if (roomFromUrl) {
    // Switch to Join Tab automatically
    selectTab('join');
    joinInput.value = roomFromUrl.toUpperCase();
    setTimeout(() => {
      joinRoomByCode(roomFromUrl);
    }, 500);
  }

  // Pairing Tab Switching
  tabCreate.addEventListener('click', () => selectTab('create'));
  tabJoin.addEventListener('click', () => selectTab('join'));

  function selectTab(tab) {
    if (tab === 'create') {
      tabCreate.classList.add('active');
      tabJoin.classList.remove('active');
      paneCreate.classList.add('active');
      paneJoin.classList.remove('active');
    } else {
      tabJoin.classList.add('active');
      tabCreate.classList.remove('active');
      paneJoin.classList.add('active');
      paneCreate.classList.remove('active');
      joinInput.focus();
    }
  }

  // Create Room
  btnCreateRoom.addEventListener('click', () => {
    btnCreateRoom.disabled = true;
    btnCreateRoom.textContent = 'Generating Room...';
    webrtc.createRoom();
  });

  function displayRoomCode(code) {
    btnCreateRoom.style.display = 'none';
    roomCodeBox.style.display = 'flex';
    roomDigits.textContent = code;

    // Build mobile-friendly pairing URL using network LAN IP
    const baseUrl = networkInfo.networkUrl || window.location.origin;
    const shareUrl = `${baseUrl}/?room=${code}`;

    // Load QR Code directly from backend
    qrBox.innerHTML = `<img src="/api/qr?text=${encodeURIComponent(shareUrl)}" alt="Scan to join room" style="width:100%; height:100%; border-radius: 8px;">`;
  }

  // Copy Room Code
  btnCopyCode.addEventListener('click', () => {
    const code = roomDigits.textContent.trim();
    if (code) {
      navigator.clipboard.writeText(code);
      showToast(`Copied room code: ${code}`);
    }
  });

  // Copy Shareable Link
  btnCopyLink.addEventListener('click', () => {
    const code = roomDigits.textContent.trim();
    const baseUrl = networkInfo.networkUrl || window.location.origin;
    const shareUrl = `${baseUrl}/?room=${code}`;
    navigator.clipboard.writeText(shareUrl);
    showToast('Copied direct join link to clipboard!');
  });

  // Join Room
  btnJoinRoom.addEventListener('click', () => {
    const code = joinInput.value.trim().toUpperCase();
    if (code) {
      joinRoomByCode(code);
    } else {
      showToast('Please enter a valid room code.');
    }
  });

  joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnJoinRoom.click();
    }
  });

  function joinRoomByCode(code) {
    btnJoinRoom.disabled = true;
    btnJoinRoom.textContent = 'Connecting...';
    webrtc.joinRoom(code);
  }

  // Disconnect button
  btnDisconnect.addEventListener('click', () => {
    webrtc.disconnect();
    window.location.href = window.location.pathname; // Clean reload without query params
  });

  // Drag and Drop Zone
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleSelectedFile(files[0]);
    }
  });

  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleSelectedFile(fileInput.files[0]);
    }
  });

  // Process selected file & compute SHA-256 pre-hash
  async function handleSelectedFile(file) {
    selectedFile = file;
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);
    fileHashDisplay.innerHTML = `<span style="color: var(--accent-amber)">Computing SHA-256...</span>`;
    filePreview.style.display = 'flex';
    btnSendFile.disabled = true;

    try {
      const sha256 = await window.CryptoUtils.computeBlobSha256(file);
      selectedFileSha256 = sha256;
      fileHashDisplay.innerHTML = `<code>${window.CryptoUtils.truncateHash(sha256, 10, 10)}</code>`;
      btnSendFile.disabled = false;
      showToast('Local SHA-256 pre-validation complete.');
    } catch (err) {
      console.error('SHA-256 calculation error:', err);
      fileHashDisplay.innerHTML = `<span style="color: var(--accent-rose)">Failed to hash</span>`;
    }
  }

  btnClearFile.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedFile = null;
    selectedFileSha256 = null;
    fileInput.value = '';
    filePreview.style.display = 'none';
  });

  // Send File
  btnSendFile.addEventListener('click', async () => {
    if (!selectedFile || !selectedFileSha256) return;

    btnSendFile.disabled = true;
    showTransferDashboard('sending', selectedFile.name);

    try {
      const success = await webrtc.sendFile(selectedFile, selectedFileSha256);
      if (success) {
        sound.playSuccess();
        showToast(`Sent "${selectedFile.name}" successfully!`);
        hideTransferDashboard();
        btnClearFile.click();
      }
    } catch (err) {
      sound.playError();
      showToast(err.message, 'error');
      hideTransferDashboard();
      btnSendFile.disabled = false;
    }
  });

  btnCancelTransfer.addEventListener('click', () => {
    webrtc.cancelSending();
    hideTransferDashboard();
    btnSendFile.disabled = false;
    showToast('Transfer cancelled.');
  });

  // Active Transfer Dashboard
  function showTransferDashboard(direction, fileName) {
    transferDashboard.style.display = 'block';
    transferDirectionBadge.textContent = direction.toUpperCase();
    transferDirectionBadge.className = `transfer-direction-badge ${direction}`;
    transferFileName.textContent = fileName;
    progressBar.style.width = '0%';
    statPercent.textContent = '0%';
    statSpeed.textContent = '0.0 MB/s';
    statBytes.textContent = '0 MB / 0 MB';
    statEta.textContent = '--:--';
  }

  function hideTransferDashboard() {
    transferDashboard.style.display = 'none';
  }

  function updateTransferDashboard(p) {
    if (transferDashboard.style.display === 'none') {
      showTransferDashboard(p.direction, p.fileName);
    }

    progressBar.style.width = `${p.percent}%`;
    statPercent.textContent = `${p.percent}%`;
    statSpeed.textContent = `${p.speedMBps.toFixed(1)} MB/s`;
    statBytes.textContent = `${formatBytes(p.bytesTransferred)} / ${formatBytes(p.totalBytes)}`;
    statEta.textContent = p.etaSeconds > 0 ? formatSeconds(p.etaSeconds) : 'Done';

    if (p.verifying) {
      statEta.textContent = 'Verifying SHA-256...';
    }
  }

  // Add Card for Received File
  function addReceivedFileCard(fileData) {
    receivedSection.style.display = 'block';

    const card = document.createElement('div');
    card.className = `received-card ${fileData.isVerified ? 'verified' : ''}`;

    const shortSenderHash = window.CryptoUtils.truncateHash(fileData.senderSha256, 12, 12);
    const shortReceiverHash = window.CryptoUtils.truncateHash(fileData.receiverSha256, 12, 12);

    card.innerHTML = `
      <div class="received-main-row">
        <div class="file-name-group">
          <div class="file-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div>
            <div class="file-name" title="${escapeHtml(fileData.fileName)}">${escapeHtml(fileData.fileName)}</div>
            <div class="file-size">${formatBytes(fileData.fileSize)}</div>
          </div>
        </div>
        <a href="${fileData.downloadUrl}" download="${escapeHtml(fileData.fileName)}" class="btn btn-primary btn-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download File
        </a>
      </div>

      <!-- Local SHA-256 Hash Validation Box -->
      <div class="integrity-box ${fileData.isVerified ? '' : 'failed'}">
        <div class="integrity-header ${fileData.isVerified ? '' : 'failed'}">
          <span>${fileData.isVerified ? '✓ SHA-256 Verified: 100% Bit-Exact Match' : '⚠ SHA-256 Checksum Mismatch!'}</span>
          <button class="btn btn-secondary btn-sm copy-hash-btn" data-hash="${fileData.receiverSha256}" style="padding: 4px 8px; font-size: 0.7rem;">Copy Hash</button>
        </div>
        <div class="hash-row">
          <span>Sender SHA-256:</span>
          <span class="hash-val-span">${shortSenderHash}</span>
        </div>
        <div class="hash-row">
          <span>Receiver SHA-256:</span>
          <span class="hash-val-span">${shortReceiverHash}</span>
        </div>
      </div>
    `;

    // Copy hash button handler
    card.querySelector('.copy-hash-btn').addEventListener('click', (e) => {
      const h = e.target.getAttribute('data-hash');
      navigator.clipboard.writeText(h);
      showToast('SHA-256 copied to clipboard!');
    });

    receivedList.prepend(card);
  }

  // Toast notifications
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.borderColor = type === 'error' ? 'var(--accent-rose)' : 'var(--accent-cyan)';

    const iconSvg = type === 'error' 
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>';

    toast.innerHTML = `${iconSvg} <span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Format Helpers
  function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  function formatSeconds(sec) {
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});
