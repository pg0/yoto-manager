// Minimal MQTT 3.1.1 client over a native WebSocket.
//
// Yoto's player channel is AWS IoT, which speaks plain MQTT under the `mqtt`
// websocket subprotocol. The app only needs CONNECT, SUBSCRIBE, QoS-0 PUBLISH
// and PINGREQ, so the ~180 lines below stand in for a ~150 kB dependency that
// would also need Node polyfills under Vite. QoS 1/2, retained messages, wills
// and session resumption are deliberately unimplemented - the device uses none
// of them, and a half-supported QoS is worse than an honestly absent one.

const PKT = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  SUBSCRIBE: 8,
  PINGREQ: 12,
  DISCONNECT: 14,
} as const;

/** CONNACK return codes. 5 is what a token without the device scope gets. */
const CONNACK_ERR: Record<number, string> = {
  1: 'unsupported MQTT version',
  2: 'client id rejected',
  3: 'player service unavailable',
  4: 'bad credentials',
  5: 'not authorised for player control',
};

export interface MqttConfig {
  url: string;
  clientId: string;
  username: string;
  password: string;
  /** seconds; the broker drops a silent connection at roughly 1.5x this */
  keepalive?: number;
  onConnect: () => void;
  onMessage: (topic: string, payload: string) => void;
  /** fires exactly once, for any end of the connection - including a CONNECT
   *  that was refused, so the caller only needs this one failure path */
  onClose: (reason: string) => void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** MQTT's 7-bits-per-byte variable length integer. */
function encLen(n: number): number[] {
  const out: number[] = [];
  do {
    let digit = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) digit |= 0x80;
    out.push(digit);
  } while (n > 0);
  return out;
}

/** Length-prefixed UTF-8, the encoding of every string in the protocol. */
function encStr(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
}

export class MqttClient {
  private ws: WebSocket;
  private cfg: MqttConfig;
  /** partial packets: websocket frames and MQTT packets do not line up */
  private rx = new Uint8Array(0);
  private ping?: number;
  private packetId = 1;
  private done = false;
  private connected = false;

  constructor(cfg: MqttConfig) {
    this.cfg = cfg;
    const ws = new WebSocket(cfg.url, 'mqtt');
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => this.sendConnect();
    ws.onmessage = (e) => this.feed(new Uint8Array(e.data as ArrayBuffer));
    // onerror is always followed by onclose; finish() is idempotent
    ws.onerror = () => this.finish('could not reach the player service');
    ws.onclose = () =>
      this.finish(this.connected ? 'connection closed' : 'could not reach the player service');
  }

  /** Subscribe at QoS 0. Fire-and-forget: SUBACK carries nothing we act on. */
  subscribe(topics: string[]) {
    if (topics.length === 0) return;
    const id = this.nextId();
    const body = [id >> 8, id & 0xff, ...topics.flatMap((t) => [...encStr(t), 0])];
    this.raw(PKT.SUBSCRIBE, 0x02, body); // 0x02 is mandatory for SUBSCRIBE
  }

  /** Publish a JSON payload at QoS 0 (no packet identifier, no ack). */
  publish(topic: string, payload: unknown) {
    this.raw(PKT.PUBLISH, 0, [...encStr(topic), ...enc.encode(JSON.stringify(payload))]);
  }

  /** Close cleanly. `onClose` still fires, with this reason. */
  end(reason = 'closed by the app') {
    if (this.connected) this.raw(PKT.DISCONNECT, 0, []);
    this.finish(reason);
  }

  get live() {
    return this.connected && !this.done;
  }

  private nextId() {
    this.packetId = (this.packetId % 0xffff) + 1;
    return this.packetId;
  }

  private sendConnect() {
    const ka = this.cfg.keepalive ?? 300;
    this.raw(PKT.CONNECT, 0, [
      ...encStr('MQTT'),
      4, // protocol level 4 = MQTT 3.1.1
      0x80 | 0x40 | 0x02, // username + password + clean session
      ka >> 8,
      ka & 0xff,
      ...encStr(this.cfg.clientId),
      ...encStr(this.cfg.username),
      ...encStr(this.cfg.password),
    ]);
  }

  /** Accumulate bytes and drain every whole packet the buffer now holds. */
  private feed(chunk: Uint8Array) {
    const merged = new Uint8Array(this.rx.length + chunk.length);
    merged.set(this.rx);
    merged.set(chunk, this.rx.length);
    this.rx = merged;

    for (;;) {
      if (this.rx.length < 2) return;
      let len = 0;
      let mult = 1;
      let i = 1;
      for (;;) {
        if (i >= this.rx.length) return; // length field still incomplete
        const b = this.rx[i++];
        len += (b & 0x7f) * mult;
        if ((b & 0x80) === 0) break;
        mult *= 128;
        if (mult > 128 ** 3) {
          this.finish('malformed packet from the player service');
          return;
        }
      }
      if (this.rx.length < i + len) return; // body still incomplete
      const type = this.rx[0] >> 4;
      const body = this.rx.slice(i, i + len);
      this.rx = this.rx.slice(i + len);
      this.handle(type, body);
      if (this.done) return;
    }
  }

  private handle(type: number, body: Uint8Array) {
    if (type === PKT.CONNACK) {
      const code = body[1] ?? 0;
      if (code !== 0) {
        this.finish(CONNACK_ERR[code] ?? `connection refused (${code})`);
        return;
      }
      this.connected = true;
      const ka = this.cfg.keepalive ?? 300;
      this.ping = window.setInterval(() => this.raw(PKT.PINGREQ, 0, []), (ka / 2.5) * 1000);
      this.cfg.onConnect();
      return;
    }
    if (type === PKT.PUBLISH) {
      const tlen = (body[0] << 8) | body[1];
      // QoS 0 (the only level we subscribe at): no packet id after the topic
      this.cfg.onMessage(dec.decode(body.subarray(2, 2 + tlen)), dec.decode(body.subarray(2 + tlen)));
    }
    // SUBACK and PINGRESP carry nothing this client acts on
  }

  private raw(type: number, flags: number, body: number[]) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(new Uint8Array([(type << 4) | flags, ...encLen(body.length), ...body]));
  }

  private finish(reason: string) {
    if (this.done) return;
    this.done = true;
    if (this.ping) window.clearInterval(this.ping);
    try {
      this.ws.close();
    } catch {
      /* already closing */
    }
    this.cfg.onClose(reason);
  }
}
