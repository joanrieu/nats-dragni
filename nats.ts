import { Socket } from "net";

let buffer = "";
let debug = true;
let nextSid = 1;

type ServerInfo = {
  server_id: string;
  server_name: string;
  version: string;
  proto: number;
  git_commit: string;
  go: string;
  host: string;
  port: number;
  headers: boolean;
  max_payload: number;
  jetstream: boolean;
  client_id: number;
  client_ip: string;
};

type Message = {
  subject: string;
  sid: string;
  replyTo: string | null;
  payloadSize: number;
  payload: string;
};

const sep = "\r\n";

const socket = new Socket();
socket.setEncoding("utf-8");
socket.setNoDelay(true);
socket.connect(4222, "nats.docker");
socket.on("data", (data) => {
  buffer += data;
  if (buffer.includes("\r\n")) {
    const [line, ...rest] = buffer.split(sep);
    const [command, ...args] = line.trim().split(/\s+/);
    buffer = rest.join(sep);
    if (debug) console.log(" [IN] ", line);

    switch (command) {
      case "INFO":
        const infoStr = args[0];
        const info = JSON.parse(infoStr);
        socket.emit(command, info);
        break;

      case "MSG":
        {
          if (args.length === 3) {
            args.splice(2, 0, "");
          }
          const [subject, sid, replyTo, payloadSizeStr] = args;
          const payloadSize = +payloadSizeStr;
          const payload = buffer.slice(0, payloadSize);
          buffer = buffer.slice(payloadSize + sep.length);
          const msg = {
            subject,
            sid,
            replyTo: replyTo || null,
            payloadSize,
            payload,
          };
          socket.emit(command, msg);
        }
        break;

      case "HMSG":
        {
          if (args.length === 4) {
            args.splice(2, 0, "");
          }
          const [subject, sid, replyTo, headersSizeStr, payloadSizeStr] = args;
          const headersSize = +headersSizeStr;
          const payloadSize = +payloadSizeStr;
          const headers = buffer.slice(0, headersSize);
          buffer = buffer.slice(headersSize); // includes terminal double sep
          const payload = buffer.slice(0, payloadSize);
          buffer = buffer.slice(payloadSize + sep.length);
          const msg = {
            subject,
            sid,
            replyTo,
            headersSize,
            headers,
            payloadSize,
            payload,
          };
          socket.emit(command, msg);
        }
        break;

      case "PING":
        pong();
        break;

      case "PONG":
        break;

      case "+OK":
        break;

      case "-ERR":
        const [error] = args;
        socket.emit("error", new Error(error));

      default:
        socket.emit("error", new Error("unknown command: " + line));
    }
  }
});
socket.on("INFO", (info: ServerInfo) => {
  write("CONNECT " + JSON.stringify({}) + sep);
});
socket.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

function write(data: string) {
  if (debug) console.log("[OUT] ", data.trim());
  socket.write(data);
}

function pub(subject: string, payload: string, replyTo: string | null = null) {
  write(
    ["PUB", subject, replyTo ?? "", payload.length].join(" ") +
      sep +
      payload +
      sep
  );
}

function sub(
  subject: string,
  queue: string | null = null,
  sid: string | number = nextSid++
) {
  write(["SUB", subject, queue ?? "", sid].join(" ") + sep);
}

function unsub(sid: string | number, maxMsgs = 0) {
  write(["UNSUB", sid, maxMsgs].join(" ") + sep);
}

function pong() {
  write("PONG" + sep);
}

// ---------------------------------------------------------------

function isSubjectInMask(subject: string, mask: string): boolean {
  if (subject === mask) return true;
  const [sub1, ...subN] = subject.split(".");
  const [mask1, ...maskN] = subject.split(".");
  if (mask1 === ">") return true;
  if (sub1 !== mask1 && mask1 !== "*") return false;
  return isSubjectInMask(subN.join("."), maskN.join("."));
}

socket.on("INFO", () => {
  sub("test", null);

  socket.on("MSG", (msg: Message) => {
    if (msg.replyTo) {
      pub(msg.replyTo, "BOOOO");
    }
  });

  setTimeout(() => {
    pub("test", "heyaaa");
  }, 3000);
});
