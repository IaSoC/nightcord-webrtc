/**
 * VoiceUIManager - 语音聊天 UI 管理器
 * 负责语音聊天的界面展示和用户交互
 * 通过 EventBus 监听事件，完全独立于业务逻辑
 */
class VoiceUIManager {
  /**
   * 创建语音 UI 管理器
   * @param {EventBus} eventBus - 事件总线
   */
  constructor(eventBus) {
    this.eventBus = eventBus;

    // UI state
    this.isInVoice = false;
    this.isMuted = false;
    this.participants = new Map(); // username -> { element, audioElement, stream }

    // DOM elements
    this.container = null;
    this.voicePanel = null;
    this.joinButton = null;
    this.muteButton = null;
    this.participantsList = null;

    // Audio elements for remote streams
    this.audioElements = new Map();

    // Setup event listeners
    this._setupEventListeners();
  }

  /**
   * 初始化 UI
   * @param {HTMLElement} container - 容器元素
   */
  init(container) {
    this.container = container;
    this._createVoicePanel();
  }

  /**
   * 创建语音面板 UI
   * @private
   */
  _createVoicePanel() {
    // Create voice panel container
    this.voicePanel = document.createElement('div');
    this.voicePanel.className = 'voice-panel';
    this.voicePanel.innerHTML = `
      <div class="voice-header">
        <span class="voice-title">语音聊天</span>
        <span class="voice-status"></span>
      </div>
      <div class="voice-participants"></div>
      <div class="voice-controls">
        <button class="voice-btn voice-join-btn" title="加入语音">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span>加入语音</span>
        </button>
        <button class="voice-btn voice-mute-btn hidden" title="静音">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span>静音</span>
        </button>
      </div>
    `;

    // Get references to elements
    this.joinButton = this.voicePanel.querySelector('.voice-join-btn');
    this.muteButton = this.voicePanel.querySelector('.voice-mute-btn');
    this.participantsList = this.voicePanel.querySelector('.voice-participants');
    this.statusElement = this.voicePanel.querySelector('.voice-status');

    // Setup button handlers
    this.joinButton.addEventListener('click', () => {
      if (this.isInVoice) {
        this.eventBus.emit('voice:leave-request');
      } else {
        this.eventBus.emit('voice:join-request');
      }
    });

    this.muteButton.addEventListener('click', () => {
      this.eventBus.emit('voice:mute-request');
    });

    // Add to container
    if (this.container) {
      this.container.appendChild(this.voicePanel);
    }
  }

  /**
   * 设置事件监听器
   * @private
   */
  _setupEventListeners() {
    // Voice joined event
    this.eventBus.on('voice:joined', (data) => {
      if (data.local) {
        this._onLocalJoined();
      } else {
        this._addParticipant(data.username);
      }
    });

    // Voice left event
    this.eventBus.on('voice:left', (data) => {
      if (data.local) {
        this._onLocalLeft();
      } else {
        this._removeParticipant(data.username);
      }
    });

    // Mute state changed
    this.eventBus.on('voice:muted', (data) => {
      if (data.username === this._getLocalUsername()) {
        this._updateMuteState(data.muted);
      } else {
        this._updateParticipantMuteState(data.username, data.muted);
      }
    });

    // Remote stream added
    this.eventBus.on('voice:stream-added', (data) => {
      this._handleRemoteStream(data.username, data.stream);
    });

    // Remote stream removed
    this.eventBus.on('voice:stream-removed', (data) => {
      this._removeRemoteStream(data.username);
    });

    // Connection state changed
    this.eventBus.on('voice:connection-state', (data) => {
      this._updateConnectionState(data.username, data.state);
    });

    // Voice error
    this.eventBus.on('voice:error', (data) => {
      this._showError(data.message);
    });
  }

  /**
   * 获取本地用户名
   * @private
   */
  _getLocalUsername() {
    // This will be set when joining voice
    return this._localUsername || null;
  }

  /**
   * 设置本地用户名
   * @param {string} username
   */
  setLocalUsername(username) {
    this._localUsername = username;
  }

  /**
   * 本地用户加入语音
   * @private
   */
  _onLocalJoined() {
    this.isInVoice = true;
    this.isMuted = false;

    // Update join button
    this.joinButton.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      <span>离开语音</span>
    `;
    this.joinButton.classList.add('active');

    // Show mute button
    this.muteButton.classList.remove('hidden');

    // Update status
    this.statusElement.textContent = '已连接';
    this.statusElement.className = 'voice-status connected';

    // Add self to participants
    this._addParticipant(this._localUsername, true);
  }

  /**
   * 本地用户离开语音
   * @private
   */
  _onLocalLeft() {
    this.isInVoice = false;
    this.isMuted = false;

    // Update join button
    this.joinButton.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      <span>加入语音</span>
    `;
    this.joinButton.classList.remove('active');

    // Hide mute button
    this.muteButton.classList.add('hidden');

    // Update status
    this.statusElement.textContent = '';
    this.statusElement.className = 'voice-status';

    // Clear all participants
    this._clearParticipants();
  }

  /**
   * 更新静音状态
   * @param {boolean} muted
   * @private
   */
  _updateMuteState(muted) {
    this.isMuted = muted;

    if (muted) {
      this.muteButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span>取消静音</span>
      `;
      this.muteButton.classList.add('muted');
    } else {
      this.muteButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span>静音</span>
      `;
      this.muteButton.classList.remove('muted');
    }

    // Update self in participants list
    this._updateParticipantMuteState(this._localUsername, muted);
  }

  /**
   * 添加参与者到列表
   * @param {string} username
   * @param {boolean} isLocal
   * @private
   */
  _addParticipant(username, isLocal = false) {
    if (this.participants.has(username)) return;

    const participantEl = document.createElement('div');
    participantEl.className = 'voice-participant';
    participantEl.dataset.username = username;
    participantEl.innerHTML = `
      <div class="participant-avatar">${username.charAt(0).toUpperCase()}</div>
      <div class="participant-info">
        <span class="participant-name">${username}${isLocal ? ' (你)' : ''}</span>
        <span class="participant-status">连接中...</span>
      </div>
      <div class="participant-indicators">
        <span class="mute-indicator hidden" title="已静音">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
          </svg>
        </span>
        <span class="speaking-indicator hidden" title="正在说话">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          </svg>
        </span>
      </div>
    `;

    this.participantsList.appendChild(participantEl);
    this.participants.set(username, {
      element: participantEl,
      audioElement: null,
      stream: null,
      isLocal
    });

    if (isLocal) {
      // Local user is always "connected"
      this._updateConnectionState(username, 'connected');
    }
  }

  /**
   * 移除参与者
   * @param {string} username
   * @private
   */
  _removeParticipant(username) {
    const participant = this.participants.get(username);
    if (!participant) return;

    // Remove audio element
    if (participant.audioElement) {
      participant.audioElement.srcObject = null;
      participant.audioElement.remove();
    }

    // Remove from DOM
    participant.element.remove();
    this.participants.delete(username);
  }

  /**
   * 清除所有参与者
   * @private
   */
  _clearParticipants() {
    for (const [username, participant] of this.participants) {
      if (participant.audioElement) {
        participant.audioElement.srcObject = null;
        participant.audioElement.remove();
      }
      participant.element.remove();
    }
    this.participants.clear();
    this.audioElements.clear();
  }

  /**
   * 更新参与者静音状态
   * @param {string} username
   * @param {boolean} muted
   * @private
   */
  _updateParticipantMuteState(username, muted) {
    const participant = this.participants.get(username);
    if (!participant) return;

    const muteIndicator = participant.element.querySelector('.mute-indicator');
    if (muteIndicator) {
      muteIndicator.classList.toggle('hidden', !muted);
    }
  }

  /**
   * 更新连接状态
   * @param {string} username
   * @param {string} state
   * @private
   */
  _updateConnectionState(username, state) {
    const participant = this.participants.get(username);
    if (!participant) return;

    const statusEl = participant.element.querySelector('.participant-status');
    if (!statusEl) return;

    const stateMap = {
      'new': '初始化...',
      'connecting': '连接中...',
      'connected': '已连接',
      'disconnected': '已断开',
      'failed': '连接失败',
      'closed': '已关闭'
    };

    statusEl.textContent = stateMap[state] || state;
    statusEl.className = `participant-status ${state}`;
  }

  /**
   * 处理远程音频流
   * @param {string} username
   * @param {MediaStream} stream
   * @private
   */
  _handleRemoteStream(username, stream) {
    const participant = this.participants.get(username);
    if (!participant) {
      // Participant not in list yet, add them
      this._addParticipant(username);
    }

    // Create audio element for playback
    let audioEl = this.audioElements.get(username);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      document.body.appendChild(audioEl);
      this.audioElements.set(username, audioEl);
    }

    audioEl.srcObject = stream;

    // Update participant data
    const p = this.participants.get(username);
    if (p) {
      p.audioElement = audioEl;
      p.stream = stream;
    }

    // Setup audio level detection for speaking indicator
    this._setupAudioLevelDetection(username, stream);
  }

  /**
   * 移除远程音频流
   * @param {string} username
   * @private
   */
  _removeRemoteStream(username) {
    const audioEl = this.audioElements.get(username);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      this.audioElements.delete(username);
    }

    const participant = this.participants.get(username);
    if (participant) {
      participant.audioElement = null;
      participant.stream = null;
    }
  }

  /**
   * 设置音频级别检测（说话指示器）
   * @param {string} username
   * @param {MediaStream} stream
   * @private
   */
  _setupAudioLevelDetection(username, stream) {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      source.connect(analyser);
      analyser.fftSize = 256;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkLevel = () => {
        if (!this.participants.has(username)) {
          audioContext.close();
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

        const participant = this.participants.get(username);
        if (participant) {
          const speakingIndicator = participant.element.querySelector('.speaking-indicator');
          if (speakingIndicator) {
            speakingIndicator.classList.toggle('hidden', average < 20);
          }
        }

        requestAnimationFrame(checkLevel);
      };

      checkLevel();
    } catch (error) {
      console.warn('Failed to setup audio level detection:', error);
    }
  }

  /**
   * 显示错误消息
   * @param {string} message
   * @private
   */
  _showError(message) {
    // Emit to main UI for display
    this.eventBus.emit('ui:show-toast', {
      type: 'error',
      message: message
    });

    // Also update status
    if (this.statusElement) {
      this.statusElement.textContent = message;
      this.statusElement.className = 'voice-status error';
    }
  }

  /**
   * 显示/隐藏语音面板
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (this.voicePanel) {
      this.voicePanel.classList.toggle('hidden', !visible);
    }
  }

  /**
   * 销毁 UI 管理器
   */
  destroy() {
    // Clear all participants and audio elements
    this._clearParticipants();

    // Remove voice panel
    if (this.voicePanel) {
      this.voicePanel.remove();
      this.voicePanel = null;
    }
  }
}
