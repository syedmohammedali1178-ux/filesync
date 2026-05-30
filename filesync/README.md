# 🔄 FileSync — Local Wi-Fi File Sync

Sync files between your PC (Windows/Mac) and Android over your home Wi-Fi — **no internet, no cloud, no accounts**.

---

## ⚡ Quick Start (2 minutes)

### Step 1 — Install Node.js (one-time)
Download from **https://nodejs.org** → choose the **LTS** version → install it.

### Step 2 — Install FileSync
Open a terminal (Command Prompt / PowerShell on Windows, Terminal on Mac) and run:

```bash
cd path/to/filesync-folder
npm install
```

### Step 3 — Start the server
```bash
node server.js
```

You'll see something like:
```
╔══════════════════════════════════════════════╗
║           🔄  FileSync  is  running          ║
╠══════════════════════════════════════════════╣
║  📁  C:\Users\You\FileSync                   ║
╠══════════════════════════════════════════════╣
║  💻  PC       →  http://localhost:3000       ║
║  📱  Android  →  http://192.168.1.42:3000   ║
╚══════════════════════════════════════════════╝
```

### Step 4 — Open the app
- **On your PC**: Open `http://localhost:3000` in your browser
- **On Android**: Scan the QR code (click 📱 Android button) or type the IP address into Chrome

---

## 🗂️ How It Works

| Feature | What it does |
|---|---|
| **Drop zone** | Drag & drop files from PC or use file picker on Android |
| **Download** | Click ⬇ on any file to download it to that device |
| **Auto-refresh** | File list updates instantly when files are added on PC |
| **Auto-download** | On Android: new PC files download automatically (toggle ON) |
| **Multi-select** | Click file cards to select, then batch download as ZIP or delete |
| **QR code** | Tap 📱 Android to get a scannable QR code for easy mobile connection |
| **Open Folder** | On PC: opens the sync folder directly in File Explorer / Finder |

---

## 📁 Sync Folder Location

Files are stored in a folder called `FileSync` in your home directory:

| OS | Default path |
|---|---|
| Windows | `C:\Users\YourName\FileSync` |
| Mac | `/Users/YourName/FileSync` |

You can change it with an environment variable:
```bash
# Windows (PowerShell)
$env:SYNC_DIR="D:\MySyncFolder"; node server.js

# Mac / Linux
SYNC_DIR="/Volumes/ExternalDrive/Sync" node server.js
```

---

## 🔁 Auto-Start on Boot (optional)

### Windows
Create a shortcut to `node server.js` and place it in:
`C:\Users\YourName\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`

### Mac
Use a launchd plist or simply add it to Login Items.

---

## 🛠️ Troubleshooting

**Android can't connect?**
- Make sure both devices are on the **same Wi-Fi network**
- Check Windows Firewall: allow Node.js or port 3000 through inbound rules
- Try typing the IP directly in Android Chrome (e.g. `http://192.168.1.42:3000`)

**Wrong IP shown?**
- The server auto-detects your Wi-Fi IP. If it picks the wrong one, check `ipconfig` (Windows) or `ifconfig` (Mac) and use the correct IP in Android browser.

**Port 3000 in use?**
```bash
PORT=8080 node server.js
```
Then connect to port 8080 instead.

**Files not appearing?**
- Make sure the sync folder path is accessible
- Toggle "Auto-refresh" off and back on, or click the ↻ button

---

## 📦 Tech Stack
- **Backend**: Node.js + Express + WebSocket + Chokidar (file watcher)
- **Frontend**: Vanilla JS + CSS (no framework, works on any browser)
- **No cloud**: 100% local — your files never leave your network

---

*Keep the terminal window open while syncing. Close it to stop the server.*
