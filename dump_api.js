const http = require('http');

http.get('http://127.0.0.1:9229/json/list', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    const list = JSON.parse(body);
    if(!list[0]) return console.log("No debugger found");
    const wsUrl = list[0].webSocketDebuggerUrl;
    
    let WebSocket;
    try {
       WebSocket = require('ws');
    } catch(e) {
       console.log('NO_WS');
       process.exit(1);
    }
    
    const client = new WebSocket(wsUrl);
    
    client.on('open', () => {
      client.send(JSON.stringify({ id: 1, method: 'Debugger.enable' }));
    });
    
    client.on('message', (msg) => {
      const data = JSON.parse(msg);
      if (data.method === 'Debugger.scriptParsed') {
        if (data.params.url && data.params.url.includes('routes/api.js')) {
          client.send(JSON.stringify({
            id: 2,
            method: 'Debugger.getScriptSource',
            params: { scriptId: data.params.scriptId }
          }));
        }
      }
      if (data.id === 2 && data.result) {
        require('fs').writeFileSync('/tmp/recovered_api.js', data.result.scriptSource);
        console.log('RECOVERED');
        process.exit(0);
      }
    });
  });
});
