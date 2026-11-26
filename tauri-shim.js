/*
 * Tauri bridge.
 *
 * md-viewer.html only knows the `window.electronAPI` surface. This shim
 * implements the same surface on top of Tauri's `withGlobalTauri` API, so the
 * UI code stays shared between the Electron and Tauri builds.
 */
(function () {
  'use strict';

  var tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return;

  var invoke = tauri.core.invoke;
  var openHandlers = [];
  var dirHandlers = [];
  var themeHandlers = [];
  var menuReady = false;

  function pickFile() {
    return invoke('pick_file');
  }

  function pickDirectory() {
    return invoke('pick_directory');
  }

  function notifyOpen(path) {
    if (!path) return;
    openHandlers.forEach(function (cb) {
      try { cb(path); } catch (e) { /* 忽略单个回调错误 */ }
    });
  }

  function notifyDir(path) {
    if (!path) return;
    dirHandlers.forEach(function (cb) {
      try { cb(path); } catch (e) { /* 忽略单个回调错误 */ }
    });
  }

  function toggleTheme() {
    themeHandlers.forEach(function (cb) {
      try { cb(); } catch (e) { /* 忽略单个回调错误 */ }
    });
  }

  window.electronAPI = {
    readFile: function (p) { return invoke('read_file', { path: p }); },
    readImage: function (p) { return invoke('read_image', { path: p }); },
    listDirectory: function (p) { return invoke('list_directory', { path: p }); },
    pickFile: pickFile,
    pickDirectory: pickDirectory,
    onOpenFile: function (cb) { openHandlers.push(cb); },
    onOpenDirectory: function (cb) { dirHandlers.push(cb); },
    onToggleTheme: function (cb) { themeHandlers.push(cb); }
  };

  /* ================= 原生菜单 ================= */
  function buildMenu() {
    if (!tauri.menu) return Promise.resolve(false);
    var menuApi = tauri.menu;
    var isMac = /Mac/i.test(navigator.platform || navigator.userAgent);

    var openItem = {
      id: 'mdv_open_file',
      text: '打开文件...',
      accelerator: 'CmdOrCtrl+O',
      action: function () { pickFile().then(notifyOpen); }
    };
    var folderItem = {
      id: 'mdv_open_folder',
      text: '打开文件夹...',
      accelerator: 'CmdOrCtrl+Shift+O',
      action: function () { pickDirectory().then(notifyDir); }
    };
    var themeItem = {
      id: 'mdv_toggle_theme',
      text: '切换主题',
      accelerator: 'CmdOrCtrl+T',
      action: toggleTheme
    };

    var fileItems = [openItem, folderItem];
    if (!isMac) {
      fileItems.push({ item: 'Separator' });
      fileItems.push({ item: 'Quit', text: '退出' });
    }

    var fileMenu = menuApi.Submenu.new({ text: '文件', items: fileItems });
    var editMenu = menuApi.Submenu.new({
      text: '编辑',
      items: [
        { item: 'Undo' },
        { item: 'Redo' },
        { item: 'Separator' },
        { item: 'Cut' },
        { item: 'Copy' },
        { item: 'Paste' },
        { item: 'SelectAll' }
      ]
    });
    var viewMenu = menuApi.Submenu.new({ text: '视图', items: [themeItem] });

    var menuPromises = [fileMenu, editMenu, viewMenu];
    if (isMac) {
      var appMenu = menuApi.Submenu.new({
        text: 'MD 查看器 Lite',
        items: [
          { item: { About: null } },
          { item: 'Separator' },
          { item: 'Hide' },
          { item: 'HideOthers' },
          { item: 'ShowAll' },
          { item: 'Separator' },
          { item: 'Quit', text: '退出 MD 查看器 Lite' }
        ]
      });
      menuPromises.unshift(appMenu);
    }

    return Promise.all(menuPromises).then(function (items) {
      return menuApi.Menu.new({ items: items });
    }).then(function (menu) {
      if (isMac) return menu.setAsAppMenu();
      return menu.setAsWindowMenu(tauri.window.getCurrentWindow());
    }).then(function () {
      menuReady = true;
      return true;
    }).catch(function (err) {
      if (window.console && console.warn) console.warn('Tauri menu setup failed', err);
      return false;
    });
  }

  /* ================= 启动参数 / 第二实例 ================= */
  function deliverStartupPath() {
    invoke('take_startup_path').then(function (p) {
      if (p) notifyOpen(p);
    }).catch(function () {});
  }

  /* ================= 原生拖拽 ================= */
  function installNativeDrop() {
    if (!tauri.webviewWindow) return;
    try {
      tauri.webviewWindow.getCurrentWebviewWindow().onDragDropEvent(function (event) {
        var payload = event && event.payload;
        if (!payload) return;
        var overlay = document.getElementById('dropOverlay');
        if (payload.type === 'enter' || payload.type === 'over') {
          if (overlay) overlay.classList.add('show');
          return;
        }
        if (payload.type === 'leave') {
          if (overlay) overlay.classList.remove('show');
          return;
        }
        if (payload.type !== 'drop') return;
        if (overlay) overlay.classList.remove('show');

        var path = (payload.paths || [])[0];
        if (!path) return;
        invoke('is_directory', { path: path }).then(function (isDir) {
          if (isDir) notifyDir(path);
          else if (/\.(md|markdown|mdown|mkd|txt|text)$/i.test(path)) notifyOpen(path);
        }).catch(function () {});
      });
    } catch (e) {
      /* 拖拽 API 不可用时忽略 */
    }
  }

  /* ================= 外部链接 ================= */
  function installExternalLinks() {
    document.addEventListener('click', function (event) {
      var target = event.target;
      var anchor = target && target.closest ? target.closest('a') : null;
      if (!anchor) return;
      var href = anchor.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href)) return;
      event.preventDefault();
      event.stopPropagation();
      invoke('open_url', { url: href }).catch(function () {});
    }, true);
  }

  /* ================= 快捷键兜底 ================= */
  function installKeyboardFallback() {
    document.addEventListener('keydown', function (event) {
      if (menuReady) return;
      var mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      var key = (event.key || '').toLowerCase();
      if (key === 'o' && !event.shiftKey) {
        event.preventDefault();
        pickFile().then(notifyOpen);
      } else if (key === 'o' && event.shiftKey) {
        event.preventDefault();
        pickDirectory().then(notifyDir);
      } else if (key === 't') {
        event.preventDefault();
        toggleTheme();
      }
    });
  }

  /* ================= 窗口标题同步 ================= */
  function installTitleSync() {
    var titleEl = document.querySelector('title');
    if (!titleEl || !window.MutationObserver) return;
    new MutationObserver(function () {
      invoke('set_title', { title: document.title }).catch(function () {});
    }).observe(titleEl, { childList: true });
  }

  tauri.event.listen('mdv-open-file', function (event) {
    notifyOpen(event.payload);
  }).catch(function () {});

  buildMenu();
  installNativeDrop();
  installExternalLinks();
  installKeyboardFallback();
  installTitleSync();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', deliverStartupPath);
  } else {
    setTimeout(deliverStartupPath, 0);
  }
})();