const WebSocket = require('ws');

async function testSignaling() {
  console.log('Testing WebSocket signaling server...');
  
  const ws1 = new WebSocket('ws://localhost:3030');
  let roomId = null;

  await new Promise((resolve) => {
    ws1.on('open', () => {
      console.log('Peer 1 connected to signaling server');
      ws1.send(JSON.stringify({ type: 'create-room' }));
    });

    ws1.on('message', (data) => {
      const msg = JSON.parse(data);
      console.log('Peer 1 received:', msg.type, msg.payload || '');
      if (msg.type === 'room-created') {
        roomId = msg.payload.roomId;
        console.log(`✓ Room created with code: ${roomId}`);
        resolve();
      }
    });
  });

  // Now peer 2 joins the room
  const ws2 = new WebSocket('ws://localhost:3030');
  await new Promise((resolve, reject) => {
    ws2.on('open', () => {
      console.log('Peer 2 connected, joining room:', roomId);
      ws2.send(JSON.stringify({ type: 'join-room', payload: { roomId } }));
    });

    let peer1Ready = false;
    let peer2Ready = false;

    ws1.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'peer-ready') {
        console.log('✓ Peer 1 received peer-ready signal');
        peer1Ready = true;
        // Peer 1 sends mock offer
        ws1.send(JSON.stringify({
          type: 'signal',
          payload: { type: 'offer', sdp: { type: 'offer', sdp: 'mock-sdp-offer' } }
        }));
      }
    });

    ws2.on('message', (data) => {
      const msg = JSON.parse(data);
      console.log('Peer 2 received:', msg.type);
      if (msg.type === 'peer-ready') {
        console.log('✓ Peer 2 received peer-ready signal');
        peer2Ready = true;
      }
      if (msg.type === 'signal' && msg.payload.type === 'offer') {
        console.log('✓ Peer 2 received relayed SDP offer successfully!');
        ws1.close();
        ws2.close();
        resolve();
      }
    });

    setTimeout(() => {
      if (!peer1Ready || !peer2Ready) {
        reject(new Error('Timeout waiting for signaling exchange'));
      }
    }, 4000);
  });

  console.log('\n🎉 ALL SIGNALING CHECKS PASSED PERFECTLY!\n');
}

testSignaling().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
