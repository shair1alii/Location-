import Busboy from "busboy";
import FormData from "form-data";
import fetch from "node-fetch";

export const config = {
  api: { bodyParser: false }
};

const TELEGRAM_BASE = "https://api.telegram.org";

export default async function handler(req, res) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: "Missing BOT_TOKEN env var" });
  }

  try {
    const contentType = req.headers["content-type"] || "";

    // ---- JSON requests (text / location) ----
    if (contentType.includes("application/json")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const data = JSON.parse(raw);

      let methodPath;
      if (data.type === "text" || data.text) methodPath = `sendMessage`;
      else if (data.type === "location") methodPath = `sendLocation`;
      else methodPath = data.method ? data.method : null;

      if (!methodPath) return res.status(400).send("Invalid JSON payload");

      const tgRes = await fetch(`${TELEGRAM_BASE}/bot${BOT_TOKEN}/${methodPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const text = await tgRes.text();
      return res.status(tgRes.status).send(text);
    }

    // ---- multipart (photo / voice / audio) ----
    if (req.method === "POST") {
      const bb = Busboy({ headers: req.headers });
      const fields = {};
      let fileBuffer = null;
      let fileInfo = null;

      await new Promise((resolve, reject) => {
        bb.on("field", (name, val) => { fields[name] = val; });
        bb.on("file", (name, file, info) => {
          const chunks = [];
          file.on("data", (d) => chunks.push(d));
          file.on("end", () => {
            fileBuffer = Buffer.concat(chunks);
            fileInfo = { filename: info.filename, mime: info.mimeType || info.mimetype || "application/octet-stream" };
          });
        });
        bb.on("close", resolve);
        bb.on("error", reject);
        req.pipe(bb);
      });

      const chat_id = fields.chat_id;
      const type = fields.type || "photo";
      if (!chat_id) return res.status(400).send("Missing chat_id");
      if (!fileBuffer) return res.status(400).send("Missing file upload");

      let tgMethod, fieldKey;
      if (type === "photo") { tgMethod = "sendPhoto"; fieldKey = "photo"; }
      else if (type === "voice") { tgMethod = "sendVoice"; fieldKey = "voice"; }
      else if (type === "audio") { tgMethod = "sendAudio"; fieldKey = "audio"; }
      else { tgMethod = "sendDocument"; fieldKey = "document"; }

      const fd = new FormData();
      fd.append("chat_id", chat_id);
      fd.append(fieldKey, fileBuffer, { filename: fileInfo.filename || "file.ogg", contentType: fileInfo.mime });

      // forward extra fields (e.g. caption)
      Object.keys(fields).forEach(k => {
        if (!["chat_id", "type"].includes(k)) fd.append(k, fields[k]);
      });

      const tgRes = await fetch(`${TELEGRAM_BASE}/bot${BOT_TOKEN}/${tgMethod}`, {
        method: "POST",
        body: fd,
        headers: fd.getHeaders()
      });

      const text = await tgRes.text();
      return res.status(tgRes.status).send(text);
    }

    return res.status(400).send("Unsupported request");
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy failed", details: err.message });
  }
                        }
