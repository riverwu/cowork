const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cowork", {
  runtime: "electron",
  invoke(command, args) {
    return ipcRenderer.invoke("cowork:invoke", command, args ?? {});
  },
  listen(channel, handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(`cowork:event:${channel}`, listener);
    return () => ipcRenderer.removeListener(`cowork:event:${channel}`, listener);
  },
});
