"use strict";

// Онлайн через публичный MQTT-брокер (WebSocket по TLS): оба игрока
// подключаются к брокеру как к чат-серверу, поэтому работает в любой сети,
// где открываются сайты. Брокер выбирается по первой букве кода комнаты.

const MQTT_BROKERS = [
  "wss://test.mosquitto.org:8081/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
];
const CONNECT_ATTEMPTS = 3;
const TOPIC_PREFIX = "kushok93-battleship/v2/";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_TIMEOUT = 8000;

const randomId = () => Math.random().toString(36).slice(2, 12);

function randomCode(brokerIndex) {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  // первая буква кодирует брокер: indexOf(code[0]) % MQTT_BROKERS.length === brokerIndex
  const n = MQTT_BROKERS.length;
  const options = [...CODE_ALPHABET].filter((_, i) => i % n === brokerIndex);
  return options[Math.floor(Math.random() * options.length)] + code.slice(1);
}

const brokerOf = code => CODE_ALPHABET.indexOf(code[0]) % MQTT_BROKERS.length;

class Net {
  /** handlers: onRoom(code), onConnect(), onData(msg), onClose(), onError(text) */
  constructor(handlers) {
    this.h = handlers;
    this.id = randomId();
    this.client = null;
    this.partner = null;
    this.connected = false;
    this.closed = false;
    this.seqOut = 0;
    this.seqIn = 0;
  }

  /** Подключиться к брокеру с last will «bye» в сторону соперника. */
  connectBroker(url, willTopic, onReady, onFail, attempt = 1) {
    if (this.closed) return;
    let ready = false;
    const client = mqtt.connect(url, {
      clientId: "bs-" + this.id,
      clean: true,
      keepalive: 10,
      connectTimeout: 8000,
      reconnectPeriod: 0,
      will: { topic: willTopic, payload: JSON.stringify({ from: this.id, c: "bye" }), qos: 1 },
    });
    client.on("connect", () => {
      ready = true;
      this.client = client;
      onReady();
    });
    client.on("message", (_topic, payload) => {
      let env;
      try {
        env = JSON.parse(payload.toString());
      } catch {
        return;
      }
      if (env && env.from !== this.id) this.receive(env);
    });
    let failed = false;
    const down = () => {
      if (!ready) {
        if (failed) return;
        failed = true;
        client.end(true);
        // публичные брокеры иногда не отвечают на отдельное подключение — пробуем ещё
        if (attempt < CONNECT_ATTEMPTS) this.connectBroker(url, willTopic, onReady, onFail, attempt + 1);
        else onFail();
      } else {
        this.lost();
      }
    };
    client.on("error", down);
    client.on("close", down);
  }

  host() {
    const tryBroker = i => {
      if (this.closed) return;
      if (i >= MQTT_BROKERS.length) {
        this.fail("Не удалось подключиться к серверу игры. Проверьте интернет");
        return;
      }
      this.code = randomCode(i);
      this.base = TOPIC_PREFIX + this.code + "/";
      this.isHost = true;
      this.connectBroker(MQTT_BROKERS[i], this.base + "g", () => {
        this.client.subscribe(this.base + "h", { qos: 1 }, err => {
          if (err) this.fail("Ошибка сервера игры");
          else this.h.onRoom(this.code);
        });
      }, () => tryBroker(i + 1));
    };
    tryBroker(0);
  }

  join(code) {
    this.code = code;
    this.base = TOPIC_PREFIX + code + "/";
    this.isHost = false;
    this.connectBroker(MQTT_BROKERS[brokerOf(code)], this.base + "h", () => {
      this.client.subscribe(this.base + "g", { qos: 1 }, err => {
        if (err) {
          this.fail("Ошибка сервера игры");
          return;
        }
        const hello = () => this.publish({ c: "hello" });
        hello();
        this.helloTimer = setInterval(hello, 1500);
        this.joinTimer = setTimeout(() => {
          if (!this.connected) this.fail("Комната не найдена. Проверьте код или попросите друга создать игру заново");
        }, JOIN_TIMEOUT);
      });
    }, () => this.fail("Не удалось подключиться к серверу игры. Проверьте интернет"));
  }

  publish(env) {
    if (!this.client || this.closed) return;
    const topic = this.base + (this.isHost ? "g" : "h");
    this.client.publish(topic, JSON.stringify({ from: this.id, ...env }), { qos: 1 });
  }

  receive(env) {
    if (this.closed) return;
    if (this.isHost) {
      if (env.c === "hello") {
        if (!this.partner) {
          this.partner = env.from;
          this.connected = true;
          this.publish({ c: "welcome", to: env.from });
          this.h.onConnect();
        } else {
          this.publish({ c: env.from === this.partner ? "welcome" : "full", to: env.from });
        }
        return;
      }
    } else if (env.to === this.id && (env.c === "welcome" || env.c === "full")) {
      if (env.c === "full") {
        this.fail("В этой комнате уже идёт игра");
      } else if (!this.connected) {
        this.partner = env.from;
        this.connected = true;
        this.stopJoinTimers();
        this.h.onConnect();
      }
      return;
    }
    if (env.from !== this.partner) return;
    if (env.c === "bye") {
      this.lost();
    } else if (env.m && env.s > this.seqIn) {
      // QoS 1 может доставить сообщение повторно — отбрасываем дубли
      this.seqIn = env.s;
      this.h.onData(env.m);
    }
  }

  send(msg) {
    if (this.connected) this.publish({ s: ++this.seqOut, m: msg });
  }

  stopJoinTimers() {
    clearInterval(this.helloTimer);
    clearTimeout(this.joinTimer);
  }

  lost() {
    if (this.closed) return;
    this.closed = true;
    this.stopJoinTimers();
    if (this.client) this.client.end(true);
    this.h.onClose();
  }

  fail(text) {
    if (this.closed) return;
    this.closed = true;
    this.stopJoinTimers();
    if (this.client) this.client.end(true);
    this.h.onError(text);
  }

  destroy() {
    if (this.closed) return;
    if (this.connected) this.publish({ c: "bye" });
    this.closed = true;
    this.stopJoinTimers();
    if (this.client) this.client.end(false);
  }
}
