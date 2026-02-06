/**
 * VoiceRoomManager - 简化版语音聊天室管理器（原生 WebRTC）
 * 只支持音频，通过聊天消息交换简短的信令
 */
class VoiceRoomManagerSimple {
  constructor(eventBus, wsManager) {
    this.eventBus = eventBus;
    this.wsManager = wsManager;

    this.inVoice = false;
    this.localStream = null;
    this.isMuted = false;
    this.username = null;
    this.roomname = null;

    // Peer connections: username -> RTCPeerConnection
    this.peers = new Map();
    this.remoteStreams = new Map();

    this.setupSignalingHandlers();
  }

  setupSignalingHandlers() {
    this.eventBus.on('message:received', (data) => {
      this.handleChatMessage(data);
    });
  }

  async joinVoiceChat(username, roomname) {
    if (this.inVoice) {
      console.warn('Already in voice chat');
      return;
    }

    this.username = username;
    this.roomname = roomname;

    try {
      // Get microphone access (audio only)
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      this.inVoice = true;

      // Broadcast voice state
      this.broadcastVoiceState();

      this.eventBus.emit('voice:joined', {
        username: this.username,
        local: true
      });

      console.log('[Voice] Joined voice chat (audio only)');
    } catch (error) {
      console.error('[Voice] Failed to join:', error);
      this.eventBus.emit('voice:error', {
        message: 'Failed to join voice chat',
        error
      });
      throw error;
    }
  }

  leaveVoiceChat() {
    if (!this.inVoice) return;

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close all peer connections
    this.peers.forEach((pc) => {
      pc.close();
    });
    this.peers.clear();
    this.remoteStreams.clear();

    this.inVoice = false;

    // Notify server
    this.broadcastVoiceState();

    this.eventBus.emit('voice:left', {
      username: this.username,
      local: true
    });

    console.log('[Voice] Left voice chat');
  }

  toggleMute() {
    if (!this.inVoice || !this.localStream) {
      console.warn('[Voice] Not in voice chat');
      return this.isMuted;
    }

    this.isMuted = !this.isMuted;

    this.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.isMuted;
    });

    this.broadcastVoiceState();

    this.eventBus.emit('voice:muted', {
      username: this.username,
      muted: this.isMuted
    });

    console.log(`[Voice] Microphone ${this.isMuted ? 'muted' : 'unmuted'}`);
    return this.isMuted;
  }

  broadcastVoiceState() {
    if (!this.wsManager.isConnected()) return;

    const message = `[VOICE_STATE:${JSON.stringify({
      username: this.username,
      inVoice: this.inVoice,
      muted: this.isMuted
    })}]`;

    this.wsManager.send({ message });
  }

  handleChatMessage(messageData) {
    const { name, message } = messageData;
    if (!message) return;

    // Handle voice state messages
    if (message.startsWith('[VOICE_STATE:')) {
      try {
        const jsonStr = message.slice('[VOICE_STATE:'.length, -1);
        const data = JSON.parse(jsonStr);
        if (data.username !== this.username) {
          this.handleVoiceState(data);
        }
      } catch (e) {
        console.warn('[Voice] Failed to parse voice state:', e);
      }
    }
    // Handle WebRTC signaling messages
    else if (message.startsWith('[VOICE_SIG:')) {
      try {
        const jsonStr = message.slice('[VOICE_SIG:'.length, -1);
        const data = JSON.parse(jsonStr);
        if (data.to === this.username) {
          this.handleSignaling(data);
        }
      } catch (e) {
        console.warn('[Voice] Failed to parse signaling:', e);
      }
    }
  }

  handleVoiceState(data) {
    const { username, inVoice, muted } = data;

    if (inVoice) {
      this.eventBus.emit('voice:joined', {
        username,
        local: false
      });

      // If we're also in voice, initiate connection
      if (this.inVoice && !this.peers.has(username)) {
        this.createPeerConnection(username);
      }
    } else {
      this.removePeer(username);
      this.eventBus.emit('voice:left', {
        username,
        local: false
      });
    }

    if (muted !== undefined) {
      this.eventBus.emit('voice:muted', {
        username,
        muted
      });
    }
  }

  async createPeerConnection(remoteUsername) {
    if (this.peers.has(remoteUsername)) {
      console.warn(`[Voice] Peer connection to ${remoteUsername} already exists`);
      return;
    }

    console.log(`[Voice] Creating peer connection to ${remoteUsername}`);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    this.peers.set(remoteUsername, pc);

    // Add local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle remote track
    pc.ontrack = (event) => {
      console.log(`[Voice] Received track from ${remoteUsername}`);
      const stream = event.streams[0];
      this.remoteStreams.set(remoteUsername, stream);
      this.eventBus.emit('voice:stream-added', {
        username: remoteUsername,
        stream
      });

      // Play audio
      if (window.playAudio) {
        window.playAudio(stream, remoteUsername);
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'ice',
          to: remoteUsername,
          candidate: event.candidate
        });
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log(`[Voice] Connection to ${remoteUsername}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(remoteUsername);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Voice] ICE connection to ${remoteUsername}:`, pc.iceConnectionState);
    };

    // Create and send offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendSignaling({
        type: 'offer',
        to: remoteUsername,
        sdp: offer.sdp
      });
    } catch (error) {
      console.error(`[Voice] Failed to create offer for ${remoteUsername}:`, error);
      this.removePeer(remoteUsername);
    }
  }

  async handleSignaling(data) {
    const { type, from, sdp, candidate } = data;

    console.log(`[Voice] Received ${type} from ${from}`);

    if (type === 'offer') {
      await this.handleOffer(from, sdp);
    } else if (type === 'answer') {
      await this.handleAnswer(from, sdp);
    } else if (type === 'ice') {
      await this.handleIceCandidate(from, candidate);
    }
  }

  async handleOffer(from, sdp) {
    // Create peer connection if doesn't exist
    if (!this.peers.has(from)) {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      });

      this.peers.set(from, pc);

      // Add local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream);
        });
      }

      // Handle remote track
      pc.ontrack = (event) => {
        console.log(`[Voice] Received track from ${from}`);
        const stream = event.streams[0];
        this.remoteStreams.set(from, stream);
        this.eventBus.emit('voice:stream-added', {
          username: from,
          stream
        });

        // Play audio
        if (window.playAudio) {
          window.playAudio(stream, from);
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignaling({
            type: 'ice',
            to: from,
            candidate: event.candidate
          });
        }
      };

      // Monitor connection state
      pc.onconnectionstatechange = () => {
        console.log(`[Voice] Connection to ${from}:`, pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this.removePeer(from);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Voice] ICE connection to ${from}:`, pc.iceConnectionState);
      };
    }

    const pc = this.peers.get(from);

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.sendSignaling({
        type: 'answer',
        to: from,
        sdp: answer.sdp
      });
    } catch (error) {
      console.error(`[Voice] Failed to handle offer from ${from}:`, error);
      this.removePeer(from);
    }
  }

  async handleAnswer(from, sdp) {
    const pc = this.peers.get(from);
    if (!pc) {
      console.warn(`[Voice] No peer connection for ${from}`);
      return;
    }

    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      console.error(`[Voice] Failed to handle answer from ${from}:`, error);
      this.removePeer(from);
    }
  }

  async handleIceCandidate(from, candidate) {
    const pc = this.peers.get(from);
    if (!pc) {
      console.warn(`[Voice] No peer connection for ${from}`);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error(`[Voice] Failed to add ICE candidate from ${from}:`, error);
    }
  }

  sendSignaling(data) {
    if (!this.wsManager.isConnected()) return;

    const message = `[VOICE_SIG:${JSON.stringify({
      ...data,
      from: this.username
    })}]`;

    this.wsManager.send({ message });
  }

  removePeer(username) {
    const pc = this.peers.get(username);
    if (pc) {
      pc.close();
      this.peers.delete(username);
    }

    const stream = this.remoteStreams.get(username);
    if (stream) {
      this.remoteStreams.delete(username);
      this.eventBus.emit('voice:stream-removed', {
        username
      });

      // Remove audio
      if (window.removeAudio) {
        window.removeAudio(username);
      }
    }
  }

  getParticipants() {
    const participants = Array.from(this.peers.keys());
    if (this.inVoice) {
      participants.unshift(this.username);
    }
    return participants;
  }

  getRemoteStream(username) {
    return this.remoteStreams.get(username) || null;
  }

  destroy() {
    this.leaveVoiceChat();
  }
}
