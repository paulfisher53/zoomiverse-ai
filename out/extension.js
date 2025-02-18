"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ollama_1 = __importDefault(require("ollama"));
const marked_1 = require("marked");
const COMMANDS = {
    CHAT: "chat",
    RESPONSE_START: "chatResponseStart",
    RESPONSE: "chatResponse",
    RESPONSE_COMPLETE: "chatResponseComplete",
    CLEAR_CHAT: "clearChat",
    POPULATE_MODELS: "populateModels",
    SET_MODEL: "setModel",
    GET_MODELS: "getModels",
    RESTORE_CHAT: "restoreChat",
    NEW_SESSION: "newSession",
    DELETE_SESSION: "deleteSession",
    SWITCH_SESSION: "switchSession",
    UPDATE_SESSIONS: "updateSessions",
};
const STATE = {
    sessions: "chatSessions",
    currentSessionId: "currentSessionId",
};
const CONFIG = {
    MODEL: "ollamaModel",
};
function stringToTokenCount(text) {
    const tokenLength = 4;
    return text.length / tokenLength;
}
function activate(context) {
    const disposable = vscode.commands.registerCommand("zoomiverse-ai.start", () => {
        let messageHistory = [];
        const configuration = vscode.workspace.getConfiguration("zoomiverse-ai");
        const panel = vscode.window.createWebviewPanel("zoomiverse-ai", "Chat Window", vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        panel.webview.html = getWebviewContent(panel.webview);
        // Load settings
        let currentModelName = configuration.get(CONFIG.MODEL, "deepseek-r1:1.5b");
        // Load sessions
        const sessions = context.globalState.get(STATE.sessions, []);
        let currentSessionId = context.globalState.get(STATE.currentSessionId, "");
        // Create default session if none exists
        if (sessions.length === 0) {
            const defaultSession = {
                id: generateId(),
                name: "Default Session",
                messages: [],
                timestamp: Date.now(),
            };
            sessions.push(defaultSession);
            currentSessionId = defaultSession.id;
            context.globalState.update(STATE.sessions, sessions);
            context.globalState.update(STATE.currentSessionId, currentSessionId);
        }
        // Load current session
        const currentSession = sessions.find((s) => s.id === currentSessionId) || sessions[0];
        messageHistory = [...currentSession.messages];
        // Update UI with sessions and messages
        panel.webview.postMessage({
            command: COMMANDS.UPDATE_SESSIONS,
            sessions: sessions,
            currentSessionId: currentSessionId,
        });
        panel.webview.postMessage({
            command: COMMANDS.RESTORE_CHAT,
            savedChatHistory: messageHistory.map((message) => ({
                role: message.role,
                content: (0, marked_1.marked)(message.content),
            })),
        });
        panel.webview.onDidReceiveMessage(async (message) => {
            async function saveCurrentSession() {
                const sessions = context.globalState.get(STATE.sessions, []);
                const sessionIndex = sessions.findIndex((s) => s.id === currentSessionId);
                if (sessionIndex !== -1) {
                    sessions[sessionIndex].messages = messageHistory;
                    sessions[sessionIndex].timestamp = Date.now();
                    await context.globalState.update(STATE.sessions, sessions);
                }
            }
            if (message.command === COMMANDS.CLEAR_CHAT) {
                ollama_1.default.abort();
                panel.webview.postMessage({ command: COMMANDS.CLEAR_CHAT });
                messageHistory = [];
                await saveCurrentSession();
            }
            if (message.command === COMMANDS.NEW_SESSION) {
                vscode.window
                    .showInputBox({
                    prompt: "Enter a name for the new session",
                })
                    .then(async (name) => {
                    if (!name) {
                        return;
                    }
                    const newSession = {
                        id: generateId(),
                        name: name,
                        messages: [],
                        timestamp: Date.now(),
                    };
                    const sessions = context.globalState.get(STATE.sessions, []);
                    sessions.push(newSession);
                    currentSessionId = newSession.id;
                    messageHistory = [];
                    await context.globalState.update(STATE.sessions, sessions);
                    await context.globalState.update(STATE.currentSessionId, currentSessionId);
                    panel.webview.postMessage({
                        command: COMMANDS.UPDATE_SESSIONS,
                        sessions: sessions,
                        currentSessionId: currentSessionId,
                    });
                    panel.webview.postMessage({ command: COMMANDS.CLEAR_CHAT });
                });
            }
            if (message.command === COMMANDS.DELETE_SESSION) {
                let sessions = context.globalState.get(STATE.sessions, []);
                sessions = sessions.filter((s) => s.id !== message.sessionId);
                if (sessions.length === 0) {
                    const defaultSession = {
                        id: generateId(),
                        name: "Default Session",
                        messages: [],
                        timestamp: Date.now(),
                    };
                    sessions.push(defaultSession);
                }
                if (currentSessionId === message.sessionId) {
                    currentSessionId = sessions[0].id;
                    messageHistory = [...sessions[0].messages];
                    panel.webview.postMessage({
                        command: COMMANDS.RESTORE_CHAT,
                        savedChatHistory: messageHistory.map((message) => ({
                            role: message.role,
                            content: (0, marked_1.marked)(message.content),
                        })),
                    });
                }
                await context.globalState.update(STATE.sessions, sessions);
                await context.globalState.update(STATE.currentSessionId, currentSessionId);
                panel.webview.postMessage({
                    command: COMMANDS.UPDATE_SESSIONS,
                    sessions: sessions,
                    currentSessionId: currentSessionId,
                });
            }
            if (message.command === COMMANDS.SWITCH_SESSION) {
                const sessions = context.globalState.get(STATE.sessions, []);
                const session = sessions.find((s) => s.id === message.sessionId);
                if (session) {
                    currentSessionId = session.id;
                    messageHistory = [...session.messages];
                    await context.globalState.update(STATE.currentSessionId, currentSessionId);
                    panel.webview.postMessage({
                        command: COMMANDS.RESTORE_CHAT,
                        savedChatHistory: messageHistory.map((message) => ({
                            role: message.role,
                            content: (0, marked_1.marked)(message.content),
                        })),
                    });
                }
            }
            if (message.command === COMMANDS.CHAT) {
                let responseText = "";
                messageHistory.push({ role: "user", content: message.text });
                try {
                    const streamResponse = await ollama_1.default.chat({
                        model: currentModelName,
                        messages: messageHistory,
                        stream: true,
                    });
                    panel.webview.postMessage({
                        command: COMMANDS.RESPONSE_START,
                    });
                    let totalTokens = 0;
                    let totalSeconds = 0;
                    let startTime = Date.now();
                    for await (const part of streamResponse) {
                        part.eval_count =
                            part.eval_count || stringToTokenCount(part.message.content);
                        part.eval_duration = part.eval_duration || Date.now() - startTime;
                        startTime = Date.now();
                        responseText += part.message.content;
                        totalTokens += Math.round(part.eval_count);
                        // Calculate tokens per second
                        const elapsedSeconds = part.eval_duration / 1000;
                        totalSeconds += elapsedSeconds;
                        const tokensPerSecond = Math.round(totalTokens / totalSeconds);
                        const htmlResponse = (0, marked_1.marked)(responseText);
                        panel.webview.postMessage({
                            command: COMMANDS.RESPONSE,
                            text: htmlResponse,
                            tokensPerSecond,
                            totalTokens,
                        });
                    }
                    messageHistory.push({ role: "assistant", content: responseText });
                    panel.webview.postMessage({ command: COMMANDS.RESPONSE_COMPLETE });
                }
                catch (e) {
                    if (String(e).startsWith("AbortError")) {
                        return;
                    }
                    panel.webview.postMessage({ command: COMMANDS.RESPONSE_START });
                    panel.webview.postMessage({
                        command: COMMANDS.RESPONSE,
                        text: `Error: ${String(e)}`,
                    });
                    panel.webview.postMessage({ command: COMMANDS.RESPONSE_COMPLETE });
                }
                await saveCurrentSession();
            }
            if (message.command === COMMANDS.GET_MODELS) {
                try {
                    const models = await ollama_1.default.list();
                    panel.webview.postMessage({
                        command: COMMANDS.POPULATE_MODELS,
                        models,
                        currentModelName,
                    });
                }
                catch (e) {
                    console.error("Failed to fetch models:", e);
                }
            }
            if (message.command === COMMANDS.SET_MODEL) {
                currentModelName = message.modelName;
                configuration.update(CONFIG.MODEL, currentModelName, vscode.ConfigurationTarget.Global);
            }
        });
        panel.onDidDispose(() => {
            ollama_1.default.abort();
            const sessions = context.globalState.get(STATE.sessions, []);
            const sessionIndex = sessions.findIndex((s) => s.id === currentSessionId);
            if (sessionIndex !== -1) {
                sessions[sessionIndex].messages = messageHistory;
                sessions[sessionIndex].timestamp = Date.now();
                context.globalState.update(STATE.sessions, sessions);
            }
        });
    });
    context.subscriptions.push(disposable);
}
function generateId() {
    return Math.random().toString(36).substring(2, 15);
}
function getWebviewContent(webview) {
    return /*html*/ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com;">
      
      <link rel="stylesheet" href="https://unpkg.com/@highlightjs/cdn-assets@11.9.0/styles/atom-one-dark.min.css"/>
      <link rel="stylesheet" href="https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.css"/>

      <script src="https://unpkg.com/@highlightjs/cdn-assets@11.9.0/highlight.min.js"></script>
      <script src="https://unpkg.com/@highlightjs/cdn-assets@11.9.0/languages/javascript.min.js"></script>
      <script src="https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.js"></script>

      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
        #chat-container { display: flex; flex-direction: column; flex: 1; }
        #response { flex: 1; margin: 1rem; padding: 1rem; max-height: calc(100vh - 200px); overflow-y: auto; padding-bottom: 30px; box-sizing: border-box; max-width: 90%; }
        #chat-input { font-family: Arial, sans-serif; position: absolute; bottom: 0; left: 0; right: 0; display: flex; }
        #chat { flex: 1; border-radius: 0.5rem; background-color: #414141; color: white; padding: 0.5rem 1rem; border-color: lightblue; }
        #clear { padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; width: 80px; font-size: 0.6rem; border: none; background-color: transparent; color: white; cursor: pointer; }
        #model-select { padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; width: 200px; font-size: 0.6rem; border: none; background-color: transparent; color: white; cursor: pointer; }
        div.think { color: #999; text-style: italic; width: 80px; max-height: 1rem; overflow: hidden; cursor: pointer; }
        div.think::before { content: 'Thinking...'; }
        .expanded div.think::before { content: ''; }
        .expanded div.think { max-height: unset; width: unset; }
        .message { margin-bottom: 1rem; clear: both; }
        .user { background-color: #414141; border-radius: 0.5rem; color: white; padding: 0 1rem; float: right; }
        .bot,.assistant {color: white; padding: 0.5rem 1rem; float: left; }
        .controls { display: flex; justify-content: space-between; padding: 1rem; align-items: center; }
        .sessions-container { display: flex; align-items: center; gap: 10px; }
        #session-select { padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.6rem; border: none; background-color: #414141; color: white; cursor: pointer; }
        .session-btn { padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.6rem; border: none; background-color: #414141; color: white; cursor: pointer; }
        .session-btn:hover { background-color: #515151; }
        #token-stats {
          position: fixed;
          bottom: 80px;
          right: 20px;
          background-color: #333;
          color: #fff;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          display: none;
        }
        .hljs-copy-button {
          width: 60px;
          text-indent: unset;
        }
        .hljs-copy-button:before {
          content: unset;
        }
      </style>
    </head>
    <body>
      <h2 style="margin: 1rem;">⚡ Zoomiverse</h2>
      <div class="controls">
        <div class="sessions-container">
          <select id="session-select"></select>
          <button id="new-session" class="session-btn">New Session</button>
          <button id="delete-session" class="session-btn">Delete Session</button>
        </div>
        <div class="controls-right">
          <select id="model-select"></select>
          <button id="clear">Clear</button>
        </div>
      </div>
      <div id="chat-container">
        <div id="response"></div>
        <div id="token-stats"></div>
        <div id="chat-input">
          <textarea id="chat" rows="3" placeholder="Ask something..."></textarea>
        </div>
      </div>

      <script>
        const chatElement = document.getElementById('chat');
        const responseDiv = document.getElementById('response');	
        const modelSelect = document.getElementById('model-select');
        const clearButton = document.getElementById('clear');
        const sessionSelect = document.getElementById('session-select');
        const newSessionButton = document.getElementById('new-session');
        const deleteSessionButton = document.getElementById('delete-session');			
        const tokenStats = document.getElementById('token-stats');

        hljs.addPlugin(
          new CopyButtonPlugin({
            autohide: false
          })
        );

        const vscode = acquireVsCodeApi();
        let currentMessage = null;
        let running = false;
        let lastPrompt = '';

        document.addEventListener('click', (event) => {
          if(!running && event.target && event.target.className === 'think'){
            event.target.parentElement.classList.toggle('expanded');
          }
        });

        newSessionButton.addEventListener('click', () => {
          vscode.postMessage({ command: '${COMMANDS.NEW_SESSION}' });
        });

        deleteSessionButton.addEventListener('click', () => {					
          const sessionId = sessionSelect.value;
          vscode.postMessage({ command: '${COMMANDS.DELETE_SESSION}', sessionId });					
        });

        sessionSelect.addEventListener('change', (event) => {
          const sessionId = event.target.value;
          vscode.postMessage({ command: '${COMMANDS.SWITCH_SESSION}', sessionId });
        });

        chatElement.addEventListener('keydown', event => {
          if (event.code === 'Enter' && !event.shiftKey && !running) {
            event.preventDefault();
            running = true;								
            chatElement.disabled = true;	
            lastPrompt = chatElement.value;	
            const text = chatElement.value;
            vscode.postMessage({ command: '${COMMANDS.CHAT}', text });
            addMessage('user', '<p>'+text.replace(/\\n/g,'<br>')+'</p>');
            processResponse();
          }
          if(event.code === 'ArrowUp' && !running){
            chatElement.value = lastPrompt;
            if(chatElement.value.length > 0){
              chatElement.selectionStart = 0;
              chatElement.selectionEnd = chatElement.value.length - 1;
            }
          }
        });

        clearButton.addEventListener('click', () => {
          vscode.postMessage({ command: '${COMMANDS.CLEAR_CHAT}' });
        });

        modelSelect.addEventListener('change', (event) => {
          const modelName = event.target.value;
          vscode.postMessage({ command: '${COMMANDS.SET_MODEL}', modelName });
          chatElement.focus();
        });

        window.addEventListener('message', event => {
          const message = event.data;

          if (message.command === '${COMMANDS.UPDATE_SESSIONS}') {
            updateSessionSelect(message.sessions, message.currentSessionId);
          }

          if (message.command === '${COMMANDS.RESPONSE_START}') {
            currentMessage = addMessage('bot', '');
            currentMessage.style.cursor = 'pointer';
            currentMessage.addEventListener('click', () => {
              if(currentMessage){
                currentMessage.classList.toggle('expanded');
              }
            });
            tokenStats.style.display = 'block';
            tokenStats.textContent = 'Starting...';
          }

          if (message.command === '${COMMANDS.RESPONSE}') {
            currentMessage.innerHTML = fixThinkTags(message.text) + '•••';
            if (message.tokensPerSecond) {
              tokenStats.textContent = message.tokensPerSecond + ' tokens/s | Total: ' + message.totalTokens;
            }
            processResponse();
          }

          if (message.command === '${COMMANDS.RESPONSE_COMPLETE}') {
            currentMessage.innerHTML = currentMessage.innerHTML.replace('•••', '');
            currentMessage.style.cursor = '';
            currentMessage = null;
            resetChat();
          }

          if (message.command === '${COMMANDS.CLEAR_CHAT}') {
            clearChat();
            currentMessage = null;
            tokenStats.style.display = 'none';
          }

          if (message.command === '${COMMANDS.POPULATE_MODELS}') {
            populateModelSelect(message.models,message.currentModelName);
          }
          
          if (message.command === '${COMMANDS.RESTORE_CHAT}') {
            restoreChat(message.savedChatHistory);
          }
        });

        function processResponse() {
          hljs.highlightAll();
          responseDiv.scrollTop = responseDiv.scrollHeight + 100;
        }

        function fixThinkTags(text) {
          return text.replace('<think>', '<div class="think">').replace('</think>', '</div>');
        }

        function restoreChat(savedChatHistory) {
          responseDiv.innerHTML = '';
          savedChatHistory.forEach(message => {
            addMessage(message.role, fixThinkTags(message.content));
          });
          processResponse();
        }

        function resetChat() {
          running = false;
          chatElement.disabled = false;
          chatElement.value = '';
          chatElement.focus();
        }

        function addMessage(role, text) {    
          const messageDiv = document.createElement('div');                
          messageDiv.className = 'message ' + role;
          messageDiv.innerHTML = text;
          responseDiv.appendChild(messageDiv);
          return messageDiv;
        }

        function clearChat() {                    
          responseDiv.innerHTML = '';
          resetChat();
        }

        function populateModelSelect(data,currentModelName) {
          modelSelect.innerHTML = '';
          data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.name;
            option.text = model.name;
            if (model.name === currentModelName) {
              option.selected = true;
            }
            modelSelect.appendChild(option);
          });
        }

        function updateSessionSelect(sessions, currentSessionId) {
          sessionSelect.innerHTML = '';
          sessions.forEach(session => {
            const option = document.createElement('option');
            option.value = session.id;
            option.text = session.name;
            if (session.id === currentSessionId) {
              option.selected = true;
            }
            sessionSelect.appendChild(option);
          });
        }

        chatElement.focus();
        vscode.postMessage({ command: '${COMMANDS.GET_MODELS}' });
      </script>
    </body>
    </html>
  `;
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map