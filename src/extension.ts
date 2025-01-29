import * as vscode from 'vscode';
import ollama from 'ollama';
import { marked } from 'marked';

interface ChatMessage {
	role: string;
	content: string;
}

export function activate(context: vscode.ExtensionContext) {

	const disposable = vscode.commands.registerCommand('zoomiverse-ai.start', () => {
		
		const panel = vscode.window.createWebviewPanel(
			'zoomiverse-ai',
			'Chat Window',
			vscode.ViewColumn.Beside,
			{ enableScripts: true }
		);

		panel.webview.html = getWebviewContent(panel.webview);

		const messageHistory: ChatMessage[] = [];

		panel.webview.onDidReceiveMessage(async (message) => {

			if (message.command === 'clearChat') {
				ollama.abort();
				panel.webview.postMessage({ command: 'clearChat' });
				messageHistory.length = 0;
			}
			if (message.command === 'chat') {
				const userPrompt = message.text;
				let responseText = '';

				messageHistory.push({role: 'user', content: userPrompt});

				try{

					const configuration = vscode.workspace.getConfiguration('zoomiverse-ai');
                    const modelName = configuration.get<string>('ollamaModel', 'deepseek-r1:1.5b');
					
					const streamResponse = await ollama.chat({
						model: modelName,
						messages: messageHistory,
						stream: true,
					});

					panel.webview.postMessage({ command: 'chatResponseStart' });

					for await (const part of streamResponse){
						responseText += part.message.content;
						const htmlResponse = marked(responseText);
						panel.webview.postMessage({ command: 'chatResponse', text: htmlResponse });
					}

					messageHistory.push({role: 'assistant', content: responseText});
					panel.webview.postMessage({ command: 'chatResponseComplete' });
					
				} catch (e) {
					if (String(e).startsWith('AbortError')) {
						return;
					}
					panel.webview.postMessage({ command: 'chatResponseStart' });
					panel.webview.postMessage({ command: 'chatResponse', text: `Error: ${String(e)}` });
					panel.webview.postMessage({ command: 'chatResponseComplete' });
                }
			}
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
				#clear { margin: 1rem; padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; width: 80px; font-size: 0.6rem; }
				div.think { color: #999; text-style: italic; }
                .message { margin-bottom: 1rem; clear: both; }
                .user { background-color: #414141; border-radius: 0.5rem; color: white; padding: 0.5rem 1rem; float: right; }
                .bot {color: white; padding: 0.5rem 1rem; float: left; }
			</style>
		</head>
		<body>
			<h2 style="margin: 1rem;">⚡ Zoomiverse</h2>
			<button id="clear">Clear</button>
			<div id="chat-container">
				<div id="response"></div>
				<div id="chat-input">
					<textarea id="chat" rows="3" placeholder="Ask something..."></textarea>
				</div>
			</div>

			<script>

				const chatElement = document.getElementById('chat');
				const responseDiv = document.getElementById('response');				

				const vscode = acquireVsCodeApi();
				let currentMessage = null;
				let running = false;
				let lastPrompt = '';

				document.getElementById('chat').addEventListener('keydown', event => {
					if (event.code === 'Enter' && !event.shiftKey && !running) {
						
						event.preventDefault();
						
						running = true;								
						chatElement.disabled = true;	

						lastPrompt = chatElement.value;	
						const text = chatElement.value;
						vscode.postMessage({ command:'chat', text });
						addMessage('user', text);
					}
					if(event.code === 'ArrowUp' && !running){
						chatElement.value = lastPrompt;
						if(chatElement.value.length > 0){
							chatElement.selectionStart = 0;
							chatElement.selectionEnd = chatElement.value.length - 1;
						}
					}
				});

				document.getElementById('clear').addEventListener('click', () => {
                    vscode.postMessage({ command: 'clearChat' });
                });

				window.addEventListener('message', event => {
					const message = event.data;
					if (message.command === 'chatResponseStart') {
						currentMessage = addMessage('bot', '');
					}
					if (message.command === 'chatResponse') {
						currentMessage.innerHTML = message.text.replace('<think>', '<div class="think">').replace('</think>', '</div>') + '•••';					
						hljs.highlightAll();
						responseDiv.scrollTop = responseDiv.scrollHeight + 100;
					}
					if (message.command === 'chatResponseComplete') {
						currentMessage.innerHTML = currentMessage.innerHTML.replace('•••', '');
						currentMessage = null;
						resetChat();
					}
					if (message.command === 'clearChat') {
                        clearChat();
						currentMessage = null;
                    }
				});

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

				document.getElementById('chat').focus();

			</script>
		</body>
		</html>
	`;
}


// This method is called when your extension is deactivated
export function deactivate() {}
