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
			'Zoomiverse Chat',
			vscode.ViewColumn.Beside,
			{ enableScripts: true }
		);

		panel.webview.html = getWebviewContent(panel.webview);

		const messageHistory: ChatMessage[] = [];

		panel.webview.onDidReceiveMessage(async (message) => {
			console.log(message);
			if (message.command === 'clearChat') {
				panel.webview.postMessage({ command: 'clearChat' });
				messageHistory.length = 0;
			}
			if (message.command === 'chat') {
				const userPrompt = message.text;
				let responseText = '';

				messageHistory.push({role: 'user', content: userPrompt});

				try{
					
					const streamResponse = await ollama.chat({
						model: 'deepseek-r1:1.5b',
						messages: messageHistory ,
						stream: true
					});

					panel.webview.postMessage({ command: 'chatResponseStart' });

					for await (const part of streamResponse){
						responseText += part.message.content;
						const htmlResponse = marked(responseText);
						panel.webview.postMessage({ command: 'chatResponse', text: htmlResponse });
					}

					messageHistory.push({role: 'assistant', content: responseText});
					panel.webview.postMessage({ command: 'chatResponseComplete' });
					
				}catch(e){
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
                .message { margin-bottom: 1rem; clear: both; }
                .user { background-color: #414141; border-radius: 0.5rem; color: white; padding: 0.5rem 1rem; float: right; }
                .bot {color: white; padding: 0.5rem 1rem; float: left; }
			</style>
		</head>
		<body>
			<h2 style="margin: 1rem;">Zoomiverse Chat</h2>
			<button id="clear">Clear</button>
			<div id="chat-container">
				<div id="response"></div>
				<div id="chat-input">
					<textarea id="chat" rows="3" placeholder="Ask something..."></textarea>
				</div>
			</div>

			<script>

				const vscode = acquireVsCodeApi();
				let currentMessage = null;

				document.getElementById('chat').addEventListener('keydown', event => {
					if (event.code === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						const text = document.getElementById('chat').value;
						vscode.postMessage({ command:'chat', text });
						addMessage('user', text);
						document.getElementById('chat').value = '';
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
						currentMessage.innerHTML = message.text;
						const responseDiv = document.getElementById('response');

						hljs.highlightAll();

						responseDiv.scrollTop = responseDiv.scrollHeight + 100;
					}
					if (message.command === 'chatResponseComplete') {
						currentMessage = null;
						document.getElementById('chat').focus();
					}
					if (message.command === 'clearChat') {
                        clearChat();
                    }
				});

				function addMessage(role, text) {
                    const responseDiv = document.getElementById('response');
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message ' + role;
                    messageDiv.innerHTML = text;
                    responseDiv.appendChild(messageDiv);
					return messageDiv;
                }

				function clearChat() {
                    const responseDiv = document.getElementById('response');
                    responseDiv.innerHTML = '';
					document.getElementById('chat').focus();
                }

				document.getElementById('chat').focus();

			</script>
		</body>
		</html>
	`;
}


// This method is called when your extension is deactivated
export function deactivate() {}
