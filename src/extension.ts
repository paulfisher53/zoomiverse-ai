import * as vscode from "vscode";
import ollama from "ollama";
import { marked } from "marked";

interface ChatMessage {
  role: string;
  content: string;
  timings?: {
    prompt: number;
    response: number;
    thinking: number;
  };
}

interface ChatSession {
  id: string;
  name: string;
  messages: ChatMessage[];
  timestamp: number;
}

const COMMANDS = {
  CHAT: "chat",
  RESPONSE_START: "chatResponseStart",
  RESPONSE: "chatResponse",
  RESPONSE_COMPLETE: "chatResponseComplete",
  CLEAR_CHAT: "clearChat",
  STOP_CHAT: "stopChat",
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

function stringToTokenCount(text: string): number {
  const tokens = text.match(
    /[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+('s|'S|'t|'T|'re|'rE|'Re|'RE|'ve|'vE|'Ve|'VE|'m|'M|'ll|'lL|'Ll|'LL|'d|'D)?|[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*('s|'S|'t|'T|'re|'rE|'Re|'RE|'ve|'vE|'Ve|'VE|'m|'M|'ll|'lL|'Ll|'LL|'d|'D)?|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n/]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu
  );

  let tokenCount = 0;
  tokens?.forEach((token) => {
    tokenCount += Math.ceil(Math.min(1, token.trim().length) / 4);
  });

  return tokenCount;
}

let currentWebview: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "zoomiverse-ai.start",
    () => {
      if (!currentWebview) {
        createWebview(context);
      } else {
        if (currentWebview.visible) {
          currentWebview.dispose();
        } else {
          showWebview(currentWebview);
        }
      }
    }
  );

  context.subscriptions.push(disposable);

  let statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.text = "Zoomiverse";
  statusBar.tooltip = "Click to open Zoomiverse chat";
  statusBar.command = "zoomiverse-ai.start";

  // Show the status bar item
  statusBar.show();

  context.subscriptions.push(statusBar);
}

function createWebview(context: vscode.ExtensionContext) {
  let messageHistory: ChatMessage[] = [];
  const configuration = vscode.workspace.getConfiguration("zoomiverse-ai");
  const panel = vscode.window.createWebviewPanel(
    "zoomiverse-ai",
    "Chat Window",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getWebviewContent(panel.webview);

  // Load settings
  let currentModelName = configuration.get<string>(
    CONFIG.MODEL,
    "deepseek-r1:1.5b"
  );

  // Load sessions
  const sessions = context.globalState.get<ChatSession[]>(STATE.sessions, []);
  let currentSessionId = context.globalState.get<string>(
    STATE.currentSessionId,
    ""
  );

  // Create default session if none exists
  if (sessions.length === 0) {
    const defaultSession: ChatSession = {
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
  const currentSession =
    sessions.find((s) => s.id === currentSessionId) || sessions[0];
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
      content: marked(message.content),
      timings: message.timings,
    })),
  });

  let responseText = "";
  let timings = {
    prompt: Date.now(),
    response: Date.now(),
    thinking: 0,
  };

  panel.webview.onDidReceiveMessage(async (message) => {
    async function saveCurrentSession() {
      const sessions = context.globalState.get<ChatSession[]>(
        STATE.sessions,
        []
      );
      const sessionIndex = sessions.findIndex((s) => s.id === currentSessionId);
      if (sessionIndex !== -1) {
        sessions[sessionIndex].messages = messageHistory;
        sessions[sessionIndex].timestamp = Date.now();
        await context.globalState.update(STATE.sessions, sessions);
      }
    }

    async function saveResponse() {
      if (responseText.length > 0) {
        timings.response = Date.now() - timings.response - timings.thinking;

        messageHistory.push({
          role: "assistant",
          content: responseText,
          timings,
        });

        panel.webview.postMessage({
          command: COMMANDS.RESPONSE_COMPLETE,
          timings,
        });

        await saveCurrentSession();
      }
    }

    if (message.command === COMMANDS.CLEAR_CHAT) {
      ollama.abort();
      panel.webview.postMessage({ command: COMMANDS.CLEAR_CHAT });
      messageHistory = [];
      await saveCurrentSession();
    }

    if (message.command === COMMANDS.STOP_CHAT) {
      ollama.abort();
      await saveResponse();
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

          const newSession: ChatSession = {
            id: generateId(),
            name: name,
            messages: [],
            timestamp: Date.now(),
          };
          const sessions = context.globalState.get<ChatSession[]>(
            STATE.sessions,
            []
          );
          sessions.push(newSession);
          currentSessionId = newSession.id;
          messageHistory = [];
          await context.globalState.update(STATE.sessions, sessions);
          await context.globalState.update(
            STATE.currentSessionId,
            currentSessionId
          );
          panel.webview.postMessage({
            command: COMMANDS.UPDATE_SESSIONS,
            sessions: sessions,
            currentSessionId: currentSessionId,
          });
          panel.webview.postMessage({ command: COMMANDS.CLEAR_CHAT });
        });
    }

    if (message.command === COMMANDS.DELETE_SESSION) {
      let sessions = context.globalState.get<ChatSession[]>(STATE.sessions, []);
      sessions = sessions.filter((s) => s.id !== message.sessionId);
      if (sessions.length === 0) {
        const defaultSession: ChatSession = {
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
            content: marked(message.content),
            timings: message.timings,
          })),
        });
      }
      await context.globalState.update(STATE.sessions, sessions);
      await context.globalState.update(
        STATE.currentSessionId,
        currentSessionId
      );
      panel.webview.postMessage({
        command: COMMANDS.UPDATE_SESSIONS,
        sessions: sessions,
        currentSessionId: currentSessionId,
      });
    }

    if (message.command === COMMANDS.SWITCH_SESSION) {
      const sessions = context.globalState.get<ChatSession[]>(
        STATE.sessions,
        []
      );
      const session = sessions.find((s) => s.id === message.sessionId);
      if (session) {
        currentSessionId = session.id;
        messageHistory = [...session.messages];
        await context.globalState.update(
          STATE.currentSessionId,
          currentSessionId
        );
        panel.webview.postMessage({
          command: COMMANDS.RESTORE_CHAT,
          savedChatHistory: messageHistory.map((message) => ({
            role: message.role,
            content: marked(message.content),
            timings: message.timings,
          })),
        });
      }
    }

    if (message.command === COMMANDS.CHAT) {
      messageHistory.push({ role: "user", content: message.text });

      responseText = "";
      timings.prompt = Date.now();
      timings.response = Date.now();
      timings.thinking = 0;

      try {
        const streamResponse = await ollama.chat({
          model: currentModelName,
          messages: messageHistory,
          stream: true,
        });

        timings.prompt = Date.now() - timings.prompt;

        panel.webview.postMessage({
          command: COMMANDS.RESPONSE_START,
        });

        let totalTokens = 0;
        let totalSeconds = 0;

        let startTime = Date.now();
        let startThinking = 0;

        for await (const part of streamResponse) {
          part.eval_count =
            part.eval_count || stringToTokenCount(part.message.content);
          part.eval_duration = part.eval_duration || Date.now() - startTime;
          startTime = Date.now();

          if (part.message.content.includes("<think>")) {
            startThinking = Date.now();
          }
          if (part.message.content.includes("</think>")) {
            timings.thinking = Date.now() - startThinking;
          }

          responseText += part.message.content;
          totalTokens += Math.round(part.eval_count);

          // Calculate tokens per second
          const elapsedSeconds = part.eval_duration / 1000;
          totalSeconds += elapsedSeconds;
          const tokensPerSecond = Math.round(totalTokens / totalSeconds);

          const htmlResponse = marked(responseText);
          panel.webview.postMessage({
            command: COMMANDS.RESPONSE,
            text: htmlResponse,
            tokensPerSecond,
            totalTokens,
          });
        }

        await saveResponse();
      } catch (e) {
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
    }

    if (message.command === COMMANDS.GET_MODELS) {
      try {
        const models = await ollama.list();
        panel.webview.postMessage({
          command: COMMANDS.POPULATE_MODELS,
          models,
          currentModelName,
        });
      } catch (e) {
        console.error("Failed to fetch models:", e);
      }
    }

    if (message.command === COMMANDS.SET_MODEL) {
      currentModelName = message.modelName;
      configuration.update(
        CONFIG.MODEL,
        currentModelName,
        vscode.ConfigurationTarget.Global
      );
    }
  });

  panel.onDidDispose(() => {
    ollama.abort();
    const sessions = context.globalState.get<ChatSession[]>(STATE.sessions, []);
    const sessionIndex = sessions.findIndex((s) => s.id === currentSessionId);
    if (sessionIndex !== -1) {
      sessions[sessionIndex].messages = messageHistory;
      sessions[sessionIndex].timestamp = Date.now();
      context.globalState.update(STATE.sessions, sessions);
    }
  });

  currentWebview = panel;

  currentWebview.onDidDispose(() => {
    currentWebview = undefined;
  });
}

function showWebview(webview: vscode.WebviewPanel) {
  webview.reveal(vscode.ViewColumn.Beside);
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function getWebviewContent(webview: vscode.Webview): string {
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
        body {
          padding: 0 var(--container-padding);
          color: var(--vscode-foreground);
          font-size: var(--vscode-font-size);
          font-weight: var(--vscode-font-weight);
          font-family: var(--vscode-font-family);
          background-color: var(--vscode-editor-background);
          display: flex;
          flex-direction: column;
          height: 100vh;
        }
        #chat-container {
          display: flex;
          flex-direction: column;
          flex: 1;
        }
        #response {
          flex: 1;
          margin: 1rem;
          padding: 1rem;
          max-height: calc(100vh - 200px);
          overflow-y: auto;
          padding-bottom: 30px;
          box-sizing: border-box;
          max-width: 90%;
        }
        #chat-input {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
        }
        #chat {
          flex: 1;
          border: none;
          font-family: var(--vscode-font-family);
          padding: 1rem;
          color: var(--vscode-input-foreground);
          outline-color: var(--vscode-input-border);
          background-color: var(--vscode-input-background);
        }
        #chat:placeholder {
          color: var(--vscode-input-placeholderForeground);
        }
        .button {
          padding: 0.5rem 0.7rem;
          border-radius: 0.3rem;
          display: inline-block;
          font-size: 0.6rem;
          border: none;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          cursor: pointer;
        }
        .button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        div.think {
          color: var(--vscode-textLink-activeForeground);
          text-style: italic;
          width: 80px;
          max-height: 1rem;
          overflow: hidden;
          cursor: pointer;
        }
        div.think::before {
          content: "Thinking...";
        }
        .expanded div.think::before {
          content: "";
        }
        .expanded div.think {
          max-height: unset;
          width: unset;
        }
        .message {
          margin-bottom: 1rem;
          clear: both;
        }
        .user {
          border-radius: 0.5rem;
          color: #FFF;
          background-color: #333;
          padding: 0 1rem;
          float: right;
        }
        .bot,
        .assistant {
          color: var(--vscode-foreground);
          padding: 0.5rem 1rem;
          float: left;
        }
        .controls {
          display: flex;
          justify-content: space-between;
          padding: 1rem;
          align-items: center;
        }
        .sessions-container {
          display: flex;
          align-items: center;
          gap: 4px;
        }
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
        small {
          color: #666;
          font-size: 0.6rem;
        }
      </style>
    </head>
    <body>
      <h2 style="margin: 1rem;">⚡ Zoomiverse</h2>
      <div class="controls">
        <div class="sessions-container">
          <select id="session-select" class="button"></select>
          <button id="new-session" class="button">New</button>
          <button id="delete-session" class="button">Delete</button>
        </div>
        <div class="controls-right">
          <select id="model-select" class="button"></select>
          <button id="clear" class="button">Clear</button>          
        </div>
      </div>
      <div id="chat-container">
        <div id="response"></div>
        <div id="token-stats"></div>
        <div id="chat-input">
          <textarea id="chat" rows="3" placeholder="Ask something..."></textarea>
        </div>
      </div>
      <button id="stop" class="button" style="display: none;position: absolute;right: 10px;bottom: 25px;">Stop</button>
      <script>
        const chatElement = document.getElementById('chat');
        const responseDiv = document.getElementById('response');	
        const modelSelect = document.getElementById('model-select');
        const clearButton = document.getElementById('clear');
        const sessionSelect = document.getElementById('session-select');
        const newSessionButton = document.getElementById('new-session');
        const deleteSessionButton = document.getElementById('delete-session');			
        const tokenStats = document.getElementById('token-stats');
        const stopButton = document.getElementById('stop');

        let copyPlugin = null;

        function enableCopyButton() {
          copyPlugin = new CopyButtonPlugin({
            autohide: false
          });
          hljs.addPlugin(copyPlugin);
        }
        enableCopyButton();

        function disableCopyButton() {
          if(copyPlugin){
            hljs.removePlugin(copyPlugin);
            copyPlugin = null;
          }
        }

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

        stopButton.addEventListener('click', () => {
          vscode.postMessage({ command: '${COMMANDS.STOP_CHAT}' }); 
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
            disableCopyButton();
            currentMessage = addMessage('bot', '');
            currentMessage.style.cursor = 'pointer';
            currentMessage.addEventListener('click', () => {
              if(currentMessage){
                currentMessage.classList.toggle('expanded');
              }
            });
            tokenStats.style.display = 'block';
            tokenStats.textContent = 'Starting...';
            stopButton.style.display = 'inline-block';
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
            const codeBlocks = currentMessage.getElementsByTagName('code');
            for (let i = 0; i < codeBlocks.length; i++) {
              if(codeBlocks[i].dataset?.highlighted){
                delete codeBlocks[i].dataset.highlighted;
              }
            }
            if(message.timings){
              currentMessage.innerHTML += '<small>Prompt: ' + message.timings.prompt + 'ms | ' +
                (message.timings.thinking?'Thinking: ' + message.timings.thinking + 'ms | ':'') +
                'Response: ' + message.timings.response + 'ms</small>';
            }
            currentMessage = null;
            enableCopyButton();
            processResponse();
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
            addMessage(message.role, fixThinkTags(message.content), message.timings);
          });
          processResponse();
        }

        function resetChat() {
          running = false;
          chatElement.disabled = false;
          chatElement.value = '';
          chatElement.focus();
          stopButton.style.display = 'none';
        }

        function addMessage(role, text, timings) {    
          const messageDiv = document.createElement('div');                
          messageDiv.className = 'message ' + role;
          messageDiv.innerHTML = text;
          if(timings){
            messageDiv.innerHTML += '<small>Prompt: ' + timings.prompt + 'ms | ' +
              (timings.thinking?'Thinking: ' + timings.thinking + 'ms | ':'') +
              'Response: ' + timings.response + 'ms</small>';
          }
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
export function deactivate() {}
