'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback) => ipcRenderer.on('open-file', (event, p) => callback(p)),
  onOpenDirectory: (callback) => ipcRenderer.on('open-directory', (event, p) => callback(p)),
  onToggleTheme: (callback) => ipcRenderer.on('toggle-theme', () => callback()),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  readImage: (p) => ipcRenderer.invoke('read-image', p),
  listDirectory: (d) => ipcRenderer.invoke('list-directory', d),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickDirectory: () => ipcRenderer.invoke('pick-directory')
});
