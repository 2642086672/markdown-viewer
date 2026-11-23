'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;

// 调试端口：设了环境变量 MDV_DEBUG_PORT 才开启（正常使用的用户不会设置）
if (process.env.MDV_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.MDV_DEBUG_PORT);
}

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// 从命令行参数里提取 md 文件路径（关联打开 / 拖拽到 exe 上）
function extractFile(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/\.(md|markdown|mdown|mkd|txt)$/i.test(a)) return a;
  }
  return null;
}

function createWindow(openPath) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    title: 'MD Viewer',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'md-viewer.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (openPath) mainWindow.webContents.send('open-file', openPath);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ================= IPC ================= */

ipcMain.handle('read-file', (event, p) => {
  try {
    return { ok: true, text: fs.readFileSync(p, 'utf-8') };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('read-image', (event, p) => {
  try {
    const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
    if (!mime) return { ok: false };
    const buf = fs.readFileSync(p);
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
  } catch (e) {
    return { ok: false };
  }
});

ipcMain.handle('list-directory', (event, dir) => {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile())
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }));
    const dirs = entries.filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }));
    return { ok: true, files, dirs };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('pick-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('pick-directory', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return r.canceled ? null : r.filePaths[0];
});

/* ================= 菜单 ================= */

function setupMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: '打开文件...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const r = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [
                { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            });
            if (!r.canceled && r.filePaths.length && mainWindow) {
              mainWindow.webContents.send('open-file', r.filePaths[0]);
            }
          }
        },
        {
          label: '打开文件夹...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const r = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });
            if (!r.canceled && r.filePaths.length && mainWindow) {
              mainWindow.webContents.send('open-directory', r.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '切换主题',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('toggle-theme');
          }
        },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

/* ================= 生命周期 ================= */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('cn.pursueray.mdviewer');

  app.on('second-instance', (event, argv) => {
    const f = extractFile(argv);
    if (mainWindow) {
      if (f) mainWindow.webContents.send('open-file', f);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow(f);
    }
  });

  app.on('ready', () => {
    createWindow(extractFile(process.argv));
    setupMenu();
  });

  app.on('window-all-closed', () => app.quit());

  // macOS 拖到 Dock 图标打开
  app.on('open-file', (event, p) => {
    event.preventDefault();
    if (mainWindow) mainWindow.webContents.send('open-file', p);
  });
}
