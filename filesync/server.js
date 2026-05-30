const express    = require('express');
const multer     = require('multer');
const WebSocket  = require('ws');
const chokidar   = require('chokidar');
const archiver   = require('archiver');
const QRCode     = require('qrcode');
const mime       = require('mime-types');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const http       = require('http');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT     = process.env.PORT || 3000;
const SYNC_DIR = process.env.SYNC_DIR
  ? path.resolve(process.env.SYNC_DIR)
  : path.join(os.homedir(), 'FileSync');

if (!fs.existsSync(SYNC_DIR)) {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  console.log(`📁 Created sync folder: ${SYNC_DIR}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getLocalIP() {
  const priority = ['Wi-Fi', 'Wireless', 'en0', 'en1', 'wlan0', 'eth0'];
  const ifaces   = os.networkInterfaces();
  for (const name of priority) {
    for (const alias of (ifaces[name] || [])) {
      if (alias.family === 'IPv4' && !alias.internal) return alias.address;
    }
  }
  for (const name of Object.keys(ifaces)) {
    for (const alias of ifaces[name]) {
      if (alias.family === 'IPv4' && !alias.internal) return alias.address;
    }
  }
  return 'localhost';
}

function getFileInfo(filePath) {
  const stat = fs.statSync(filePath);
  const name = path.basename(filePath);
  return {
    name,
    size:     stat.size,
    modified: stat.mtime.toISOString(),
    created:  stat.birthtime.toISOString(),
    type:     mime.lookup(name) || 'application/octet-stream',
    ext:      path.extname(name).toLowerCase().slice(1)
  };
}

function safeFilePath(filename) {
  const fp = path.resolve(SYNC_DIR, filename);
  if (!fp.startsWith(SYNC_DIR + path.sep) && fp !== SYNC_DIR) return null;
  return fp;
}

const LOCAL_IP = getLocalIP();

// ─── Express + HTTP + WebSocket ───────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── WebSocket ────────────────────────────────────────────────────────────────
const clients    = new Map();
let   clientSeq  = 0;

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  clients.forEach((info, id) => {
    if (id !== excludeId && info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(msg);
    }
  });
}

wss.on('connection', (ws, req) => {
  const id = ++clientSeq;
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isMobile = /android|iphone|ipad|mobile/.test(ua);
  clients.set(id, { ws, ip: req.socket.remoteAddress, isMobile });

  ws.send(JSON.stringify({
    type:      'welcome',
    id,
    syncDir:   SYNC_DIR,
    isMobile,
    serverTime: new Date().toISOString()
  }));
  broadcast({ type: 'peers_updated', count: clients.size }, id);

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    } catch {}
  });

  ws.on('close', () => {
    clients.delete(id);
    broadcast({ type: 'peers_updated', count: clients.size });
  });

  ws.on('error', () => { try { ws.close(); } catch {} });
});

// ─── File watcher ─────────────────────────────────────────────────────────────
const IGNORED = /(^|[/\\])(\..+|thumbs\.db|desktop\.ini|\.DS_Store)$/i;

chokidar.watch(SYNC_DIR, {
  ignored:         IGNORED,
  persistent:      true,
  ignoreInitial:   true,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
})
  .on('add',    fp => broadcast({ type: 'file_added',   name: path.basename(fp) }))
  .on('unlink', fp => broadcast({ type: 'file_removed', name: path.basename(fp) }))
  .on('change', fp => broadcast({ type: 'file_changed', name: path.basename(fp) }));

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SYNC_DIR),
  filename: (_req, file, cb) => {
    let name;
    try   { name = Buffer.from(file.originalname, 'latin1').toString('utf8'); }
    catch { name = file.originalname; }

    // Avoid collisions
    let final = name;
    let n = 1;
    while (fs.existsSync(path.join(SYNC_DIR, final))) {
      const ext  = path.extname(name);
      const base = path.basename(name, ext);
      final = `${base} (${n++})${ext}`;
    }
    cb(null, final);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }   // 10 GB
});

// ─── API ──────────────────────────────────────────────────────────────────────

// Server info + QR
app.get('/api/info', async (_req, res) => {
  const url = `http://${LOCAL_IP}:${PORT}`;
  let qr = null;
  try { qr = await QRCode.toDataURL(url, { width: 260, margin: 2 }); } catch {}
  res.json({ ip: LOCAL_IP, port: PORT, url, qr, syncDir: SYNC_DIR,
             platform: os.platform(), devices: clients.size });
});

// List files
app.get('/api/files', (_req, res) => {
  try {
    const files = fs.readdirSync(SYNC_DIR)
      .filter(n => {
        if (n.startsWith('.')) return false;
        return fs.statSync(path.join(SYNC_DIR, n)).isFile();
      })
      .map(n => getFileInfo(path.join(SYNC_DIR, n)))
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({
      files,
      count:     files.length,
      totalSize: files.reduce((s, f) => s + f.size, 0)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload (one file per request for individual progress tracking)
app.post('/api/upload', upload.array('files', 100), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
  res.json({
    success: true,
    files: req.files.map(f => ({
      name: f.filename,
      size: f.size,
      type: mime.lookup(f.filename) || 'application/octet-stream'
    }))
  });
});

// Download single file
app.get('/api/download/:filename(*)', (req, res) => {
  const fp = safeFilePath(decodeURIComponent(req.params.filename));
  if (!fp)                   return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(fp))    return res.status(404).json({ error: 'File not found' });
  res.download(fp);
});

// Download multiple as ZIP
app.post('/api/download-zip', (req, res) => {
  const { files } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'No files specified' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="filesync-${Date.now()}.zip"`);

  const arc = archiver('zip', { zlib: { level: 6 } });
  arc.on('error', err => res.status(500).end(err.message));
  arc.pipe(res);

  files.forEach(filename => {
    const fp = safeFilePath(filename);
    if (fp && fs.existsSync(fp)) arc.file(fp, { name: filename });
  });

  arc.finalize();
});

// Delete files
app.delete('/api/files', (req, res) => {
  const { files } = req.body;
  if (!files?.length) return res.status(400).json({ error: 'No files specified' });

  const deleted = [], errors = [];
  files.forEach(filename => {
    const fp = safeFilePath(filename);
    if (!fp) return errors.push({ filename, error: 'Access denied' });
    try {
      if (fs.existsSync(fp)) { fs.unlinkSync(fp); deleted.push(filename); }
    } catch (e) { errors.push({ filename, error: e.message }); }
  });
  res.json({ success: true, deleted, errors });
});

// Rename
app.patch('/api/files/:filename(*)', (req, res) => {
  const oldFP = safeFilePath(decodeURIComponent(req.params.filename));
  const newFP = safeFilePath(req.body.newName);
  if (!oldFP || !newFP) return res.status(403).json({ error: 'Access denied' });
  try { fs.renameSync(oldFP, newFP); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Open sync folder in OS file explorer (PC only)
app.post('/api/open-folder', (_req, res) => {
  const { exec } = require('child_process');
  const cmds = { win32: `explorer "${SYNC_DIR}"`, darwin: `open "${SYNC_DIR}"` };
  const cmd  = cmds[os.platform()] || `xdg-open "${SYNC_DIR}"`;
  exec(cmd, err => err ? res.status(500).json({ error: err.message }) : res.json({ ok: true }));
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const border = '═'.repeat(46);
  console.log(`\n╔${border}╗`);
  console.log(`║           🔄  FileSync  is  running           ║`);
  console.log(`╠${border}╣`);
  console.log(`║  📁  ${SYNC_DIR.slice(0, 40).padEnd(40)}  ║`);
  console.log(`╠${border}╣`);
  console.log(`║  💻  PC       →  http://localhost:${PORT}        ║`);
  console.log(`║  📱  Android  →  http://${LOCAL_IP}:${PORT}  ║`);
  console.log(`╠${border}╣`);
  console.log(`║   Keep this window open while syncing files   ║`);
  console.log(`╚${border}╝\n`);
});
