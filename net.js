"use strict";

// Онлайн через WebRTC (PeerJS). Публичный сервер PeerJS нужен только для
// установки соединения, сами ходы идут напрямую между браузерами.

const PEER_PREFIX = "kushok93-battleship-";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

const PEER_ERRORS = {
  "peer-unavailable": "Комната не найдена. Проверьте код или попросите друга создать игру заново",
  "network": "Нет соединения с сервером. Проверьте интернет",
  "server-error": "Сервер соединения недоступен, попробуйте позже",
  "socket-error": "Ошибка соединения с сервером",
  "browser-incompatible": "Браузер не поддерживает онлайн-игру",
};

class Net {
  /** handlers: onRoom(code), onConnect(), onData(msg), onClose(), onError(text) */
  constructor(handlers) {
    this.h = handlers;
    this.peer = null;
    this.conn = null;
    this.closed = false;
  }

  host() {
    const code = randomCode();
    this.peer = new Peer(PEER_PREFIX + code);
    this.peer.on("open", () => this.h.onRoom(code));
    this.peer.on("connection", conn => {
      if (this.conn) {
        conn.on("open", () => conn.close());
        return;
      }
      this.attach(conn);
    });
    this.peer.on("error", err => {
      if (err.type === "unavailable-id" && !this.conn) {
        this.peer.destroy();
        this.host();
      } else {
        this.fail(err);
      }
    });
  }

  join(code) {
    this.peer = new Peer();
    this.peer.on("open", () => {
      this.attach(this.peer.connect(PEER_PREFIX + code, { reliable: true }));
    });
    this.peer.on("error", err => this.fail(err));
  }

  attach(conn) {
    this.conn = conn;
    conn.on("open", () => this.h.onConnect());
    conn.on("data", msg => this.h.onData(msg));
    conn.on("close", () => this.lost());
    conn.on("error", () => this.lost());
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  lost() {
    if (this.closed) return;
    this.closed = true;
    this.h.onClose();
  }

  fail(err) {
    // Ошибки сервера знакомств не мешают уже установленному прямому соединению.
    if (this.closed || (this.conn && this.conn.open)) return;
    this.h.onError(PEER_ERRORS[err.type] || "Ошибка соединения: " + (err.type || err.message || err));
  }

  destroy() {
    this.closed = true;
    if (this.peer) this.peer.destroy();
  }
}
