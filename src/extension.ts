import * as vscode from 'vscode';
import ollama from 'ollama';
import { marked } from 'marked';

interface ChatMessage {
	role: string;
	content: string;
}

const COMMANDS = {
	CHAT: 'chat',
	RESPONSE_START: 'chatResponseStart',
	RESPONSE: 'chatResponse',
	RESPONSE_COMPLETE: 'chatResponseComplete',
	CLEAR_CHAT: 'clearChat',
	POPULATE_MODELS: 'populateModels',
	SET_MODEL: 'setModel',
	GET_MODELS: 'getModels',
	RESTORE_CHAT: 'restoreChat',
};

const STATE = {
	chatHistory: 'chatHistory',
};

const CONFIG = {
	MODEL: 'ollamaModel',
};

export function activate(context: vscode.ExtensionContext) {

	const disposable = vscode.commands.registerCommand('zoomiverse-ai.start', () => {
		
		const messageHistory: ChatMessage[] = [];
		const configuration = vscode.workspace.getConfiguration('zoomiverse-ai');
		const panel = vscode.window.createWebviewPanel(
			'zoomiverse-ai',
			'Chat Window',
			vscode.ViewColumn.Beside,
			{ enableScripts: true }
		);

		panel.webview.html = getWebviewContent(panel.webview);

		// Load settings.
		let currentModelName = configuration.get<string>(CONFIG.MODEL, 'deepseek-r1:1.5b');

		// Load state.
        const savedChatHistory = context.globalState.get<ChatMessage[]>(STATE.chatHistory, []);
        messageHistory.push(...savedChatHistory);
        panel.webview.postMessage({ 
			command: COMMANDS.RESTORE_CHAT, 
			savedChatHistory: messageHistory.map(message => {
				return { 
					role: message.role, 
					content: marked(message.content) 
				};
			}) 
		});

		panel.webview.onDidReceiveMessage(async (message) => {

			if (message.command === COMMANDS.CLEAR_CHAT) {
				ollama.abort();
				panel.webview.postMessage({ command: COMMANDS.CLEAR_CHAT });
				messageHistory.length = 0;
			}

			if (message.command === COMMANDS.CHAT) {
;
				let responseText = '';

				messageHistory.push({role: 'user', content: message.text});

				try{

					const streamResponse = await ollama.chat({
						model: currentModelName,
						messages: messageHistory,
						stream: true,
					});

					panel.webview.postMessage({ command: COMMANDS.RESPONSE_START });

					for await (const part of streamResponse){
						responseText += part.message.content;
						const htmlResponse = marked(responseText);
						panel.webview.postMessage({ command: COMMANDS.RESPONSE, text: htmlResponse });
					}

					messageHistory.push({role: 'assistant', content: responseText});
					panel.webview.postMessage({ command: COMMANDS.RESPONSE_COMPLETE });
					
				} catch (e) {
					if (String(e).startsWith('AbortError')) {
						return;
					}
					panel.webview.postMessage({ command: COMMANDS.RESPONSE_START });
					panel.webview.postMessage({ command: COMMANDS.RESPONSE, text: `Error: ${String(e)}` });
					panel.webview.postMessage({ command: COMMANDS.RESPONSE_COMPLETE });
                }
			}

			if (message.command === COMMANDS.GET_MODELS) {
                try {
                    const models = await ollama.list();
                    panel.webview.postMessage({ command: COMMANDS.POPULATE_MODELS, models, currentModelName });
                } catch (e) {
                    console.error('Failed to fetch models:', e);
                }
            }

            if (message.command === COMMANDS.SET_MODEL) {
                currentModelName = message.modelName;
				configuration.update(CONFIG.MODEL, currentModelName, vscode.ConfigurationTarget.Global);
            }
		});

		panel.onDidDispose(() => {
			ollama.abort();
            context.globalState.update(STATE.chatHistory, messageHistory);
        });
	});

	context.subscriptions.push(disposable);
	
}

function getWebviewContent(webview: vscode.Webview) : string {
	return /*html*/`
		<!DOCTYPE html>
		<html lang="en">
		<head>
			
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com;">
    
            
			<link rel="stylesheet" href="https://unpkg.com/@highlightjs/cdn-assets@11.9.0/styles/atom-one-dark.min.css">
			<script src="https://unpkg.com/@highlightjs/cdn-assets@11.9.0/highlight.min.js"></script>
			
			<script src="https://unpkg.com/@highlightjs/cdn-assets@11.9.0/languages/javascript.min.js"></script>

			<style>
				body { font-family: Arial, sans-serif; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
                #chat-container { display: flex; flex-direction: column; flex: 1; }
                #response { flex: 1; margin: 1rem; padding: 1rem; max-height: calc(100vh - 200px); overflow-y: auto; padding-bottom: 30px; box-sizing: border-box; max-width: 90%; }
                #chat-input { position: absolute; bottom: 0; left: 0; right: 0; display: flex; }
                #chat { flex: 1; border-radius: 0.5rem; background-color: #414141; color: white; padding: 0.5rem 1rem; border-color: lightblue; }
				#clear { padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; width: 80px; font-size: 0.6rem; border: none; background-color: transparent; color: white; }
				#model-select { padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; width: 200px; font-size: 0.6rem; border: none; background-color: transparent; color: white; }
				div.think { color: #999; text-style: italic; }
                .message { margin-bottom: 1rem; clear: both; }
                .user { background-color: #414141; border-radius: 0.5rem; color: white; padding: 0 1rem; float: right; }
                .bot,.assistant {color: white; padding: 0.5rem 1rem; float: left; }
				.controls { display: flex; justify-content: space-between; padding: 1rem; }
			</style>
		</head>
		<body>
			<h2 style="margin: 1rem;">⚡ Zoomiverse</h2>
			<div class="controls">
				<select id="model-select"></select>
				<button id="clear">Clear</button>
			</div>
			<div id="chat-container">
				<div id="response"></div>
				<div id="chat-input">
					<textarea id="chat" rows="3" placeholder="Ask something..."></textarea>
				</div>
			</div>

			<script>

				const chatElement = document.getElementById('chat');
				const responseDiv = document.getElementById('response');	
				const modelSelect = document.getElementById('model-select');
				const clearButton = document.getElementById('clear');			

				const vscode = acquireVsCodeApi();
				let currentMessage = null;
				let running = false;
				let lastPrompt = '';

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

					if (message.command === '${COMMANDS.RESPONSE_START}') {
						currentMessage = addMessage('bot', '');
					}

					if (message.command === '${COMMANDS.RESPONSE}') {
						currentMessage.innerHTML = message.text.replace('<think>', '<div class="think">').replace('</think>', '</div>') + '•••';					
						processResponse();
					}

					if (message.command === '${COMMANDS.RESPONSE_COMPLETE}') {
						currentMessage.innerHTML = currentMessage.innerHTML.replace('•••', '');
						currentMessage = null;
						resetChat();
					}

					if (message.command === '${COMMANDS.CLEAR_CHAT}') {
                        clearChat();
						currentMessage = null;
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

				function restoreChat(savedChatHistory) {
					responseDiv.innerHTML = '';
					savedChatHistory.forEach(message => {
						addMessage(message.role, message.content);
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

				chatElement.focus();
				vscode.postMessage({ command: '${COMMANDS.GET_MODELS}' });

			</script>
		</body>
		</html>
	`;
}


// This method is called when your extension is deactivated
export function deactivate() {}
