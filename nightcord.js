class Nightcord {
  /**
   * 创建 Nightcord 实例
   * @param {Object} config - 配置对象
   * @param {string} [config.hostname] - 服务器主机名
   */
  constructor(config = {}) {
    this.eventBus = new EventBus();
    this.chatRoom = new NightcordManager({
      hostname: config.hostname,
      eventBus: this.eventBus
    });
    this.ui = new UIManager(this.eventBus);

    // Initialize voice chat managers
    this.voiceRoom = new VoiceRoomManagerSimple(this.eventBus, this.chatRoom.wsManager);
    this.voiceUI = new VoiceUIManager(this.eventBus);

    // Setup voice UI event handlers
    this._setupVoiceEventHandlers();

    // Application state
    this.state = {
      phase: 'name-choosing', // name-choosing, chatting
      voiceEnabled: config.voiceEnabled !== false // Voice chat enabled by default
    };
  }

  /**
   * 设置语音事件处理器
   * @private
   */
  _setupVoiceEventHandlers() {
    // Handle voice join request from UI
    this.eventBus.on('voice:join-request', () => {
      this.joinVoice();
    });

    // Handle voice leave request from UI
    this.eventBus.on('voice:leave-request', () => {
      this.leaveVoice();
    });

    // Handle mute request from UI
    this.eventBus.on('voice:mute-request', () => {
      this.toggleMute();
    });
  }

  /**
   * 初始化应用
   */
  init(roomname) {
    this.state.phase = 'name-choosing';
    
    // 尝试从 localStorage 获取已保存的用户名
    const storedName = localStorage.getItem('nightcord-username');
    
    if (storedName) {
      // 如果已有用户名，直接加入房间
      this.chatRoom.setUser(storedName);
      this.joinRoom(roomname || 'nightcord-default');
    } else {
      // 如果没有用户名，设置用户名选择器
      this.ui.setupNameChooser((username) => {
        this.chatRoom.setUser(username);
        this.joinRoom(roomname || 'nightcord-default');
      });
    }
  }

  /**
   * 加入聊天室
   * @param {string} roomname - 房间名称
   */
  joinRoom(roomname) {
    this.state.phase = 'chatting';
    // this.ui.hideRoomChooser();

    const success = this.chatRoom.joinRoom(roomname);
    if (success) {
      this.ui.setCurrentRoom(this.chatRoom.roomname);
      this.ui.setupChatRoom((message) => {
        this.chatRoom.sendMessage(message);
      }, (username) => {
        this.chatRoom.setUser(username);
      });

      // Initialize voice UI in sidebar
      if (this.state.voiceEnabled) {
        const sidebarContent = document.querySelector('.sidebar-content');
        if (sidebarContent) {
          this.voiceUI.init(sidebarContent);
          this.voiceUI.setLocalUsername(this.chatRoom.username);
        }
      }
    }
  }

  /**
   * 离开聊天室
   */
  leaveRoom() {
    this.chatRoom.leave();
    this.state.phase = 'room-choosing';
  }

  /**
   * 获取当前应用状态
   * @returns {Object} 状态对象
   * @property {string} phase - 当前阶段
   * @property {string} username - 当前用户名
   * @property {string} roomname - 当前房间名
   * @property {string[]} roster - 房间成员列表
   */
  getState() {
    return {
      ...this.state,
      username: this.chatRoom.username,
      roomname: this.chatRoom.roomname,
      roster: this.chatRoom.getRoster()
    };
  }

  /**
   * 获取事件总线实例（用于外部扩展）
   * @returns {EventBus} 事件总线
   */
  getEventBus() {
    return this.eventBus;
  }

  /**
   * 获取聊天室管理器实例（用于外部扩展）
   * @returns {NightcordManager} 聊天室管理器
   */
  getChatRoomManager() {
    return this.chatRoom;
  }

  /**
   * 获取 UI 管理器实例（用于外部扩展）
   * @returns {UIManager} UI 管理器
   */
  getUIManager() {
    return this.ui;
  }

  /**
   * 获取语音聊天管理器实例（用于外部扩展）
   * @returns {VoiceRoomManager} 语音聊天管理器
   */
  getVoiceRoomManager() {
    return this.voiceRoom;
  }

  /**
   * 获取语音 UI 管理器实例（用于外部扩展）
   * @returns {VoiceUIManager} 语音 UI 管理器
   */
  getVoiceUIManager() {
    return this.voiceUI;
  }

  /**
   * 加入语音聊天
   */
  async joinVoice(options = {}) {
    if (!this.state.voiceEnabled) {
      console.warn('Voice chat is disabled');
      return false;
    }

    try {
      await this.voiceRoom.joinVoiceChat(this.chatRoom.username, this.chatRoom.roomname, options);
      return true;
    } catch (error) {
      console.error('Failed to join voice chat:', error);
      return false;
    }
  }

  /**
   * 离开语音聊天
   */
  leaveVoice() {
    this.voiceRoom.leaveVoiceChat();
  }

  /**
   * 切换麦克风静音状态
   */
  toggleMute() {
    return this.voiceRoom.toggleMute();
  }

  /**
   * 销毁应用实例
   */
  destroy() {
    if (this.voiceUI) {
      this.voiceUI.destroy();
    }
    if (this.voiceRoom) {
      this.voiceRoom.destroy();
    }
    this.chatRoom.leave();
    this.eventBus.clear();
  }
}
