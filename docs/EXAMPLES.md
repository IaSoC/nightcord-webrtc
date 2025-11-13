# 扩展示例

本文档提供了各种实用的扩展示例，展示如何利用模块化架构来增强聊天应用的功能。

## 目录

- [基础扩展](#基础扩展)
- [消息处理](#消息处理)
- [用户体验增强](#用户体验增强)
- [数据持久化](#数据持久化)
- [通知系统](#通知系统)
- [插件系统](#插件系统)
- [高级功能](#高级功能)

---

## 基础扩展

### 1. 自动回复机器人

```javascript
const eventBus = chatApp.getEventBus();

eventBus.on('message:received', (data) => {
  // 检测是否 @ 了机器人
  if (data.message.includes('@bot')) {
    setTimeout(() => {
      const responses = [
        '你好！我是机器人，有什么可以帮助你的？',
        '我在这里！需要什么帮助吗？',
        '机器人收到！请问有什么问题？'
      ];
      const response = responses[Math.floor(Math.random() * responses.length)];
      chatApp.getChatRoomManager().sendMessage(response);
    }, 1000);
  }
});
```

### 2. 消息计数器

```javascript
let messageCount = 0;
let userMessageCounts = {};

eventBus.on('message:received', (data) => {
  messageCount++;
  userMessageCounts[data.name] = (userMessageCounts[data.name] || 0) + 1;
  
  console.log(`总消息数: ${messageCount}`);
  console.log(`${data.name} 发送了 ${userMessageCounts[data.name]} 条消息`);
});

// 显示统计信息
function showStats() {
  const ui = chatApp.getUIManager();
  const stats = Object.entries(userMessageCounts)
    .map(([name, count]) => `${name}: ${count}条`)
    .join(', ');
  ui.addChatMessage(null, `* 消息统计: ${stats}`);
}
```

### 3. 打字指示器

```javascript
const chatInput = chatApp.getUIManager().getElements().chatInput;
let typingTimer;
let isTyping = false;

chatInput.addEventListener('input', () => {
  clearTimeout(typingTimer);
  
  // 开始打字
  if (!isTyping) {
    isTyping = true;
    chatApp.getChatRoomManager().wsManager.send({ typing: true });
  }
  
  // 停止打字
  typingTimer = setTimeout(() => {
    isTyping = false;
    chatApp.getChatRoomManager().wsManager.send({ typing: false });
  }, 1000);
});

// 显示其他用户的打字状态
eventBus.on('message:received', (data) => {
  if (data.typing !== undefined) {
    const ui = chatApp.getUIManager();
    if (data.typing) {
      ui.addChatMessage(null, `* ${data.name} 正在输入...`);
    }
  }
});
```

---

## 消息处理

### 1. 消息过滤器

```javascript
class MessageFilter {
  constructor(eventBus) {
    this.blockedWords = ['spam', 'advertisement'];
    this.blockedUsers = new Set();
    
    // 拦截消息显示
    const originalHandler = eventBus.listeners['message:received'][0];
    eventBus.off('message:received', originalHandler);
    
    eventBus.on('message:received', (data) => {
      if (this.shouldBlock(data)) {
        console.log('Blocked message:', data);
        return;
      }
      originalHandler(data);
    });
  }
  
  shouldBlock(data) {
    // 检查用户黑名单
    if (this.blockedUsers.has(data.name)) {
      return true;
    }
    
    // 检查敏感词
    const message = data.message.toLowerCase();
    return this.blockedWords.some(word => message.includes(word));
  }
  
  blockUser(username) {
    this.blockedUsers.add(username);
  }
  
  unblockUser(username) {
    this.blockedUsers.delete(username);
  }
}

// 使用过滤器
const filter = new MessageFilter(chatApp.getEventBus());
filter.blockUser('annoying_user');
```

### 2. Markdown 支持

```javascript
import { marked } from 'marked';

class MarkdownRenderer {
  constructor(ui) {
    this.ui = ui;
    this.originalAddChatMessage = ui.addChatMessage.bind(ui);
    
    // 替换原方法
    ui.addChatMessage = (name, text) => {
      if (name) {
        // 用户消息，渲染 Markdown
        const html = marked.parse(text);
        this.addFormattedMessage(name, html);
      } else {
        // 系统消息，不渲染
        this.originalAddChatMessage(name, text);
      }
    };
  }
  
  addFormattedMessage(name, html) {
    const { chatlog } = this.ui.elements;
    const p = document.createElement("p");
    
    const tag = document.createElement("span");
    tag.className = "username";
    tag.innerText = name + ": ";
    p.appendChild(tag);
    
    const content = document.createElement("span");
    content.innerHTML = html;
    p.appendChild(content);
    
    chatlog.appendChild(p);
    if (this.ui.isAtBottom) {
      chatlog.scrollBy(0, 1e8);
    }
  }
}

// 启用 Markdown
const markdown = new MarkdownRenderer(chatApp.getUIManager());
```

### 3. 表情符号支持

```javascript
class EmojiSupport {
  constructor(chatApp) {
    this.emojiMap = {
      ':)': '😊',
      ':(': '😢',
      ':D': '😃',
      '<3': '❤️',
      ':p': '😛',
      ';)': '😉'
    };
    
    // 拦截发送消息
    const chatRoom = chatApp.getChatRoomManager();
    const originalSend = chatRoom.sendMessage.bind(chatRoom);
    
    chatRoom.sendMessage = (message) => {
      message = this.convertEmojis(message);
      return originalSend(message);
    };
  }
  
  convertEmojis(text) {
    let result = text;
    for (const [shortcode, emoji] of Object.entries(this.emojiMap)) {
      result = result.replace(new RegExp(this.escapeRegex(shortcode), 'g'), emoji);
    }
    return result;
  }
  
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// 启用表情符号
const emoji = new EmojiSupport(chatApp);
```

---

## 用户体验增强

### 1. 声音通知

```javascript
class SoundNotifications {
  constructor(eventBus) {
    this.sounds = {
      message: new Audio('/sounds/message.mp3'),
      userJoined: new Audio('/sounds/join.mp3'),
      userLeft: new Audio('/sounds/leave.mp3')
    };
    
    eventBus.on('message:received', () => this.play('message'));
    eventBus.on('user:joined', () => this.play('userJoined'));
    eventBus.on('user:quit', () => this.play('userLeft'));
  }
  
  play(soundName) {
    if (this.sounds[soundName]) {
      this.sounds[soundName].play().catch(e => {
        console.log('Sound play failed:', e);
      });
    }
  }
  
  mute() {
    Object.values(this.sounds).forEach(sound => sound.muted = true);
  }
  
  unmute() {
    Object.values(this.sounds).forEach(sound => sound.muted = false);
  }
}

// 启用声音通知
const sounds = new SoundNotifications(chatApp.getEventBus());
```

### 2. 桌面通知

```javascript
class DesktopNotifications {
  constructor(eventBus, username) {
    this.username = username;
    this.enabled = false;
    
    // 请求权限
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        this.enabled = permission === 'granted';
      });
    }
    
    eventBus.on('message:received', (data) => {
      if (this.enabled && data.name !== username) {
        this.notify(data);
      }
    });
  }
  
  notify(data) {
    // 只在窗口不活动时通知
    if (document.hidden) {
      new Notification(`来自 ${data.name} 的消息`, {
        body: data.message,
        icon: '/icon.png',
        tag: 'chat-message'
      });
    }
  }
}

// 启用桌面通知
const notifications = new DesktopNotifications(
  chatApp.getEventBus(),
  chatApp.getState().username
);
```

### 3. 消息时间戳

```javascript
class MessageTimestamp {
  constructor(ui) {
    this.ui = ui;
    this.originalAddChatMessage = ui.addChatMessage.bind(ui);
    
    ui.addChatMessage = (name, text) => {
      if (name) {
        const timestamp = this.formatTime(new Date());
        this.addMessageWithTimestamp(name, text, timestamp);
      } else {
        this.originalAddChatMessage(name, text);
      }
    };
  }
  
  addMessageWithTimestamp(name, text, timestamp) {
    const { chatlog } = this.ui.elements;
    const p = document.createElement("p");
    
    // 时间戳
    const timeSpan = document.createElement("span");
    timeSpan.className = "timestamp";
    timeSpan.innerText = `[${timestamp}] `;
    timeSpan.style.color = '#888';
    timeSpan.style.fontSize = '0.9em';
    p.appendChild(timeSpan);
    
    // 用户名
    const nameSpan = document.createElement("span");
    nameSpan.className = "username";
    nameSpan.innerText = name + ": ";
    p.appendChild(nameSpan);
    
    // 消息内容
    p.appendChild(document.createTextNode(text));
    
    chatlog.appendChild(p);
    if (this.ui.isAtBottom) {
      chatlog.scrollBy(0, 1e8);
    }
  }
  
  formatTime(date) {
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }
}

// 启用时间戳
const timestamp = new MessageTimestamp(chatApp.getUIManager());
```

---

## 数据持久化

### 1. 聊天历史记录

```javascript
class ChatHistory {
  constructor(eventBus, roomname) {
    this.roomname = roomname;
    this.storageKey = `chat-history-${roomname}`;
    this.maxMessages = 100;
    
    // 监听消息
    eventBus.on('message:received', (data) => {
      this.saveMessage(data);
    });
  }
  
  saveMessage(data) {
    const history = this.load();
    history.push({
      ...data,
      savedAt: Date.now()
    });
    
    // 限制数量
    if (history.length > this.maxMessages) {
      history.shift();
    }
    
    localStorage.setItem(this.storageKey, JSON.stringify(history));
  }
  
  load() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
    } catch (e) {
      return [];
    }
  }
  
  restore(ui) {
    const history = this.load();
    history.forEach(msg => {
      ui.addChatMessage(msg.name, msg.message);
    });
    return history.length;
  }
  
  clear() {
    localStorage.removeItem(this.storageKey);
  }
}

// 使用历史记录
const history = new ChatHistory(
  chatApp.getEventBus(),
  chatApp.getState().roomname
);

// 恢复历史
const count = history.restore(chatApp.getUIManager());
console.log(`恢复了 ${count} 条历史消息`);
```

### 2. 用户偏好设置

```javascript
class UserPreferences {
  constructor() {
    this.preferences = this.load();
  }
  
  load() {
    try {
      return JSON.parse(localStorage.getItem('chat-preferences') || '{}');
    } catch (e) {
      return {};
    }
  }
  
  save() {
    localStorage.setItem('chat-preferences', JSON.stringify(this.preferences));
  }
  
  set(key, value) {
    this.preferences[key] = value;
    this.save();
  }
  
  get(key, defaultValue = null) {
    return this.preferences[key] !== undefined 
      ? this.preferences[key] 
      : defaultValue;
  }
  
  // 预定义的偏好设置
  getSoundEnabled() {
    return this.get('soundEnabled', true);
  }
  
  setSoundEnabled(enabled) {
    this.set('soundEnabled', enabled);
  }
  
  getTheme() {
    return this.get('theme', 'light');
  }
  
  setTheme(theme) {
    this.set('theme', theme);
    document.body.className = `theme-${theme}`;
  }
}

// 使用偏好设置
const prefs = new UserPreferences();
if (prefs.getSoundEnabled()) {
  // 启用声音
}
```

---

## 通知系统

### 1. 未读消息计数

```javascript
class UnreadCounter {
  constructor(eventBus) {
    this.count = 0;
    this.originalTitle = document.title;
    
    eventBus.on('message:received', () => {
      if (document.hidden) {
        this.increment();
      }
    });
    
    // 窗口获得焦点时重置
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.reset();
      }
    });
  }
  
  increment() {
    this.count++;
    this.updateTitle();
  }
  
  reset() {
    this.count = 0;
    this.updateTitle();
  }
  
  updateTitle() {
    if (this.count > 0) {
      document.title = `(${this.count}) ${this.originalTitle}`;
    } else {
      document.title = this.originalTitle;
    }
  }
}

// 启用未读计数
const unreadCounter = new UnreadCounter(chatApp.getEventBus());
```

### 2. @提及通知

```javascript
class MentionNotifier {
  constructor(eventBus, username) {
    this.username = username;
    
    eventBus.on('message:received', (data) => {
      if (this.isMentioned(data.message)) {
        this.notify(data);
      }
    });
  }
  
  isMentioned(message) {
    return message.includes(`@${this.username}`);
  }
  
  notify(data) {
    // 高亮显示
    const ui = chatApp.getUIManager();
    const chatlog = ui.getElements().chatlog;
    const lastMessage = chatlog.lastElementChild;
    if (lastMessage) {
      lastMessage.style.backgroundColor = '#fff3cd';
    }
    
    // 桌面通知
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`${data.name} 提到了你`, {
        body: data.message,
        icon: '/icon.png'
      });
    }
    
    // 播放声音
    const audio = new Audio('/sounds/mention.mp3');
    audio.play();
  }
}

// 启用提及通知
const mentionNotifier = new MentionNotifier(
  chatApp.getEventBus(),
  chatApp.getState().username
);
```

---

## 插件系统

### 1. 插件基类

```javascript
class ChatPlugin {
  constructor(app) {
    this.app = app;
    this.eventBus = app.getEventBus();
    this.chatRoom = app.getChatRoomManager();
    this.ui = app.getUIManager();
  }
  
  install() {
    throw new Error('Plugin must implement install() method');
  }
  
  uninstall() {
    throw new Error('Plugin must implement uninstall() method');
  }
  
  getName() {
    return this.constructor.name;
  }
}

class PluginManager {
  constructor(app) {
    this.app = app;
    this.plugins = new Map();
  }
  
  register(plugin) {
    const name = plugin.getName();
    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} already registered`);
    }
    
    plugin.install();
    this.plugins.set(name, plugin);
    console.log(`Plugin ${name} installed`);
  }
  
  unregister(name) {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.uninstall();
      this.plugins.delete(name);
      console.log(`Plugin ${name} uninstalled`);
    }
  }
  
  getPlugin(name) {
    return this.plugins.get(name);
  }
}

// 创建插件管理器
const pluginManager = new PluginManager(chatApp);
```

### 2. 示例插件：消息搜索

```javascript
class SearchPlugin extends ChatPlugin {
  install() {
    this.messages = [];
    
    // 记录所有消息
    this.messageHandler = (data) => {
      this.messages.push(data);
    };
    this.eventBus.on('message:received', this.messageHandler);
    
    // 添加搜索 UI
    this.addSearchUI();
  }
  
  uninstall() {
    this.eventBus.off('message:received', this.messageHandler);
    this.removeSearchUI();
  }
  
  addSearchUI() {
    const searchBox = document.createElement('input');
    searchBox.type = 'text';
    searchBox.placeholder = '搜索消息...';
    searchBox.id = 'message-search';
    
    searchBox.addEventListener('input', (e) => {
      this.search(e.target.value);
    });
    
    document.body.insertBefore(searchBox, document.body.firstChild);
  }
  
  removeSearchUI() {
    const searchBox = document.getElementById('message-search');
    if (searchBox) {
      searchBox.remove();
    }
  }
  
  search(query) {
    if (!query) return;
    
    const results = this.messages.filter(msg => 
      msg.message.toLowerCase().includes(query.toLowerCase())
    );
    
    console.log(`找到 ${results.length} 条匹配的消息:`, results);
    
    // 高亮显示结果
    this.highlightResults(results);
  }
  
  highlightResults(results) {
    // 实现高亮逻辑
  }
}

// 安装插件
pluginManager.register(new SearchPlugin(chatApp));
```

---

## 高级功能

### 1. 文件共享

```javascript
class FileSharing {
  constructor(chatRoom, ui) {
    this.chatRoom = chatRoom;
    this.ui = ui;
    this.addFileInput();
  }
  
  addFileInput() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'file-input';
    fileInput.style.display = 'none';
    
    fileInput.addEventListener('change', (e) => {
      this.handleFile(e.target.files[0]);
    });
    
    document.body.appendChild(fileInput);
    
    // 添加按钮
    const button = document.createElement('button');
    button.innerText = '📎';
    button.onclick = () => fileInput.click();
    
    const chatInput = this.ui.getElements().chatInput;
    chatInput.parentElement.appendChild(button);
  }
  
  async handleFile(file) {
    if (!file) return;
    
    // 上传文件
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      // 发送文件链接
      this.chatRoom.sendMessage(`[文件] ${file.name}: ${data.url}`);
    } catch (error) {
      console.error('文件上传失败:', error);
      this.ui.showError('文件上传失败');
    }
  }
}

// 启用文件共享
const fileSharing = new FileSharing(
  chatApp.getChatRoomManager(),
  chatApp.getUIManager()
);
```

### 2. 用户状态(在线/离线)

```javascript
class UserStatus {
  constructor(eventBus) {
    this.statuses = new Map();
    
    // 监听连接状态
    eventBus.on('connection:open', () => {
      this.setOnline();
    });
    
    eventBus.on('connection:close', () => {
      this.setOffline();
    });
    
    // 定期发送心跳
    this.startHeartbeat();
  }
  
  setOnline() {
    this.updateStatus('online');
  }
  
  setOffline() {
    this.updateStatus('offline');
  }
  
  updateStatus(status) {
    chatApp.getChatRoomManager().wsManager.send({
      type: 'status',
      status: status
    });
  }
  
  startHeartbeat() {
    setInterval(() => {
      if (chatApp.getChatRoomManager().isConnected()) {
        this.updateStatus('online');
      }
    }, 30000); // 每30秒
  }
}

// 启用用户状态
const userStatus = new UserStatus(chatApp.getEventBus());
```

### 3. 消息反应（类似 Slack 的 emoji 反应）

```javascript
class MessageReactions {
  constructor(ui, chatRoom) {
    this.ui = ui;
    this.chatRoom = chatRoom;
    this.reactions = new Map(); // messageId -> reactions
    this.modifyMessageDisplay();
  }
  
  modifyMessageDisplay() {
    const originalAdd = this.ui.addChatMessage.bind(this.ui);
    
    this.ui.addChatMessage = (name, text) => {
      originalAdd(name, text);
      
      if (name) {
        // 添加反应按钮
        const chatlog = this.ui.getElements().chatlog;
        const lastMessage = chatlog.lastElementChild;
        this.addReactionButton(lastMessage, text);
      }
    };
  }
  
  addReactionButton(messageElement, messageText) {
    const button = document.createElement('button');
    button.innerText = '👍';
    button.className = 'reaction-button';
    button.style.marginLeft = '10px';
    button.style.cursor = 'pointer';
    
    button.onclick = () => {
      this.addReaction(messageText, '👍');
    };
    
    messageElement.appendChild(button);
  }
  
  addReaction(messageText, emoji) {
    const count = (this.reactions.get(messageText) || 0) + 1;
    this.reactions.set(messageText, count);
    
    // 发送反应到服务器
    this.chatRoom.wsManager.send({
      type: 'reaction',
      message: messageText,
      emoji: emoji
    });
  }
}

// 启用消息反应
const reactions = new MessageReactions(
  chatApp.getUIManager(),
  chatApp.getChatRoomManager()
);
```

### 4. 命令系统

```javascript
class CommandSystem {
  constructor(chatRoom, ui) {
    this.chatRoom = chatRoom;
    this.ui = ui;
    this.commands = new Map();
    
    // 注册默认命令
    this.registerDefaultCommands();
    
    // 拦截消息发送
    this.interceptMessages();
  }
  
  registerCommand(name, handler, description) {
    this.commands.set(name, { handler, description });
  }
  
  registerDefaultCommands() {
    this.registerCommand('help', () => {
      const commandList = Array.from(this.commands.entries())
        .map(([name, { description }]) => `/${name} - ${description}`)
        .join('\n');
      this.ui.addChatMessage(null, `可用命令:\n${commandList}`);
    }, '显示所有命令');
    
    this.registerCommand('clear', () => {
      const chatlog = this.ui.getElements().chatlog;
      while (chatlog.firstChild) {
        chatlog.removeChild(chatlog.firstChild);
      }
    }, '清空聊天记录');
    
    this.registerCommand('me', (args) => {
      const action = args.join(' ');
      this.chatRoom.sendMessage(`* ${action}`);
    }, '发送动作消息');
  }
  
  interceptMessages() {
    const originalSend = this.chatRoom.sendMessage.bind(this.chatRoom);
    
    this.chatRoom.sendMessage = (message) => {
      if (message.startsWith('/')) {
        this.executeCommand(message);
        return false;
      }
      return originalSend(message);
    };
  }
  
  executeCommand(input) {
    const parts = input.slice(1).split(' ');
    const commandName = parts[0];
    const args = parts.slice(1);
    
    const command = this.commands.get(commandName);
    if (command) {
      command.handler(args);
    } else {
      this.ui.addChatMessage(null, `* 未知命令: /${commandName}`);
    }
  }
}

// 启用命令系统
const commands = new CommandSystem(
  chatApp.getChatRoomManager(),
  chatApp.getUIManager()
);

// 添加自定义命令
commands.registerCommand('time', () => {
  const time = new Date().toLocaleTimeString();
  chatApp.getUIManager().addChatMessage(null, `* 当前时间: ${time}`);
}, '显示当前时间');
```

---

## 总结

这些示例展示了如何利用模块化架构来扩展聊天应用的功能。关键点：

✅ **无需修改核心代码** - 所有扩展都是通过事件监听和方法替换实现
✅ **模块化设计** - 每个功能都是独立的类，易于管理
✅ **可组合** - 可以同时使用多个扩展
✅ **易于测试** - 每个扩展都可以独立测试
✅ **可插拔** - 可以动态启用/禁用功能

通过这些模式，你可以构建一个功能丰富、高度可定制的聊天应用！
