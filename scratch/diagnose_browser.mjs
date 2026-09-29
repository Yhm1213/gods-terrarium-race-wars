import { spawn } from 'node:child_process';

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless',
  '--remote-debugging-port=9333',
  '--user-data-dir=/tmp/chrome_diag_' + Date.now(),
  '--no-first-run',
  '--no-default-browser-check',
  'http://localhost:3000/'
]);

await new Promise(r => setTimeout(r, 2000));

try {
  const res = await fetch('http://127.0.0.1:9333/json');
  const tabs = await res.json();
  const pageTab = tabs.find(t => t.type === 'page');
  console.log('Target tab:', pageTab?.title, pageTab?.url);

  if (pageTab?.webSocketDebuggerUrl) {
    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Log.enable' }));
      ws.send(JSON.stringify({ id: 3, method: 'Page.enable' }));
      setTimeout(() => {
        ws.send(JSON.stringify({ id: 4, method: 'Page.reload' }));
      }, 300);
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.method === 'Runtime.exceptionThrown') {
        console.error('CRITICAL PAGE EXCEPTION:', JSON.stringify(data.params.exceptionDetails, null, 2));
      }
      if (data.method === 'Runtime.consoleAPICalled') {
        console.log(`PAGE LOG [${data.params.type}]:`, data.params.args.map(a => a.value || a.description).join(' '));
      }
    };
  }
} catch(e) {
  console.error('Diag err:', e);
}

await new Promise(r => setTimeout(r, 4000));
chrome.kill();
