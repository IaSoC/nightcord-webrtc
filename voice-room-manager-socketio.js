/**
 * VoiceRoomManager - 使用 Socket.io 公共服务器进行信令
 */
class VoiceRoomManagerSocketIO {
  constructor(eventBus, wsManager) {
    this.eventBus = eventBus;
    this.wsManager = wsManager;

    this.inVoice = false;
    this.localStream = null;
    this.isMuted = false;
    this.username = null;
    this.roomname = null;

    // Socket.io connection for signaling
    this.socket = null;

    // Peer connections: username -> RTCPeerConnection
    this.peers = new Map();
    this.remoteStreams = new Map();

    // Users in voice: Set of usernames
    this.voiceUsers = new Set();
  }

  async joinVoiceChat(username, roomname) {
    if (this.inVoice) {
      console.warn('[Voice] Already in voice chat');
      return;
    }

    this.username = username;
    this.roomname = roomname;

    try {
      // Get microphone access
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      // Connect to signaling server
      await this.connectSignaling();

      this.inVoice = true;

      this.eventBus.emit('voice:joined', {
        username: this.username,
        local: true
      });

      console.log('[Voice] Joined voice chat');
    } catch (error) {
      console.error('[Voice] Failed to join:', error);
      this.eventBus.emit('voice:error', {
        message: 'Failed to join voice chat',
        error
      });
      throw error;
    }
  }

  async connectSignaling() {
    return new Promise((resolve, reject) => {
      // Use a free Socket.io server (you can replace with your own)
      this.socket = io('https://socketio-chat-h9jt.herokuapp.com/', {
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('[Voice] Connected to signaling server');

        // Join room
        this.socket.emit('join-voice-room', {
          room: this.roomname,
          username: this.username
        });

        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('[Voice] Signaling connection error:', error);
        reject(error);
      });

      // Handle signaling messages
      this.socket.on('voice-user-joined', (data) => {
        console.log('[Voice] User joined:', data.username);
        this.handleUserJoined(data.username);
      });

      this.socket.on('voice-user-left', (data) => {
        console.log('[Voice] User left:', data.username);
        this.handleUserLeft(data.username);
      });

      this.socket.on('voice-offer', async (data) => {
        console.log('[Voice] Received offer from:', data.from);
        await this.handleOffer(data.from, data.sdp);
      });

      this.socket.on('voice-answer', async (data) => {
        console.log('[Voice] Received answer from:', data.from);
        await this.handleAnswer(data.from, data.sdp);
      });

      this.socket.on('voice-ice-candidate', async (data) => {
        console.log('[Voice] Received ICE candidate from:', data.from);
        await this.handleIceCandidate(data.from, data.candidate);
      });

      this.socket.on('voice-room-users', (data) => {
        console.log('[Voice] Users in room:', data.users);
        data.users.forEach(user => {
          if (user !== this.username) {
            this.voiceUsers.add(user);
          }
        });
      });
    });
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
    this.voiceUsers.clear();

    // Disconnect signaling
    if (this.socket) {
      this.socket.emit('leave-voice-room', {
        room: this.roomname,
        username: this.username
      });
      this.socket.disconnect();
      this.socket = null;
    }

    this.inVoice = false;

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

    this.eventBus.emit('voice:muted', {
      username: this.username,
      muted: this.isMuted
    });

    console.log(`[Voice] Microphone ${this.isMuted ? 'muted' : 'unmuted'}`);
    return this.isMuted;
  }

  handleUserJoined(username) {
    if (username === this.username) return;

    this.voiceUsers.add(username);

    this.eventBus.emit('voice:joined', {
      username,
      local: false
    });

    // Create peer connection and send offer
    if (this.inVoice && !this.peers.has(username)) {
      this.createPeerConnection(username);
    }
  }

  handleUserLeft(username) {
    this.voiceUsers.delete(username);
    this.removePeer(username);

    this.eventBus.emit('voice:left', {
      username,
      local: false
    });
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
      if (event.candidate && this.socket) {
        this.socket.emit('voice-ice-candidate', {
          room: this.roomname,
          to: remoteUsername,
          from: this.username,
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

      if (this.socket) {
        this.socket.emit('voice-offer', {
          room: this.roomname,
          to: remoteUsername,
          from: this.username,
          sdp: offer.sdp
        });
      }
    } catch (error) {
      console.error(`[Voice] Failed to create offer for ${remoteUsername}:`, error);
      this.removePeer(remoteUsername);
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
        if (event.candidate && this.socket) {
          this.socket.emit('voice-ice-candidate', {
            room: this.roomname,
            to: from,
            from: this.username,
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

      if (this.socket) {
        this.socket.emit('voice-answer', {
          room: this.roomname,
          to: from,
          from: this.username,
          sdp: answer.sdp
        });
      }
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
