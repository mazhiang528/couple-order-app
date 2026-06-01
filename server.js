const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3456;

// ============ Data Store ============
const pairs = new Map();
const deviceRoles = new Map();

function generatePairId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// ============ Static File Server ============
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  filePath = path.join(__dirname, "public", filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    }
  });
});

// ============ WebSocket Server ============
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("[连接] 新设备已连接");

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      send(ws, { type: "error", message: "消息格式错误" });
      return;
    }
    const device = deviceRoles.get(ws);

    switch (msg.type) {
      case "create_pair": {
        if (device) { send(ws, { type: "error", message: "你已在一个配对中，请先退出" }); return; }
        const { password } = msg;
        if (!password || password.length < 4) { send(ws, { type: "error", message: "密码至少4位" }); return; }
        for (const [id, pair] of pairs) {
          if (pair.boyfriendWs === ws) { send(ws, { type: "error", message: "你已创建过一个配对了" }); return; }
        }
        const pairId = generatePairId();
        pairs.set(pairId, { password: hashPassword(password), boyfriendWs: ws, girlfriendWs: null, orders: [], createdAt: Date.now() });
        deviceRoles.set(ws, { pairId, role: "boyfriend" });
        send(ws, { type: "pair_created", pairId, message: `配对码已创建，请让对方输入：${pairId}` });
        console.log(`[配对] 男友创建配对 ${pairId}`);
        break;
      }

      case "join_pair": {
        if (device) { send(ws, { type: "error", message: "你已在一个配对中，请先退出" }); return; }
        const { pairId, password } = msg;
        const pair = pairs.get(pairId);
        if (!pair) { send(ws, { type: "error", message: "配对码不存在" }); return; }
        if (hashPassword(password) !== pair.password) { send(ws, { type: "error", message: "密码错误" }); return; }
        if (pair.girlfriendWs) { send(ws, { type: "error", message: "该配对码已被另一台设备使用" }); return; }
        pair.girlfriendWs = ws;
        deviceRoles.set(ws, { pairId, role: "girlfriend" });
        send(ws, { type: "pair_joined", message: "配对成功！" });
        if (pair.boyfriendWs && pair.boyfriendWs.readyState === WebSocket.OPEN) {
          send(pair.boyfriendWs, { type: "partner_connected", message: "你的另一半已连接！" });
        }
        console.log(`[配对] 女友加入配对 ${pairId}`);
        break;
      }

      case "place_order": {
        if (!device || device.role !== "girlfriend") { send(ws, { type: "error", message: "只有女朋友才能下单哦~" }); return; }
        const pair = pairs.get(device.pairId);
        if (!pair) { send(ws, { type: "error", message: "配对不存在" }); return; }
        const { item, note = "", quantity = 1 } = msg;
        if (!item) { send(ws, { type: "error", message: "请填写想要的东西" }); return; }
        const order = {
          id: crypto.randomUUID(), item, note, quantity,
          time: new Date().toISOString(), status: "pending",
        };
        pair.orders.unshift(order);
        if (pair.boyfriendWs && pair.boyfriendWs.readyState === WebSocket.OPEN) {
          send(pair.boyfriendWs, { type: "new_order", order });
        }
        send(ws, { type: "order_placed", order });
        console.log(`[订单] ${device.pairId}: ${item} x${quantity}`);
        break;
      }

      case "update_order": {
        if (!device || device.role !== "boyfriend") { send(ws, { type: "error", message: "无权限" }); return; }
        const pair = pairs.get(device.pairId);
        if (!pair) { send(ws, { type: "error", message: "配对不存在" }); return; }
        const { orderId, status } = msg;
        const order = pair.orders.find(o => o.id === orderId);
        if (!order) { send(ws, { type: "error", message: "订单不存在" }); return; }
        if (!["accepted", "done"].includes(status)) { send(ws, { type: "error", message: "无效状态" }); return; }
        order.status = status;
        send(ws, { type: "order_updated", order });
        if (pair.girlfriendWs && pair.girlfriendWs.readyState === WebSocket.OPEN) {
          send(pair.girlfriendWs, { type: "order_updated", order });
        }
        break;
      }

      case "get_orders": {
        if (!device) { send(ws, { type: "error", message: "请先配对" }); return; }
        const pair = pairs.get(device.pairId);
        if (!pair) { send(ws, { type: "error", message: "配对不存在" }); return; }
        send(ws, { type: "orders_list", orders: pair.orders });
        break;
      }

      case "leave_pair": {
        if (!device) { send(ws, { type: "error", message: "你不在任何配对中" }); return; }
        const pair = pairs.get(device.pairId);
        if (pair) {
          if (device.role === "boyfriend") {
            if (pair.girlfriendWs && pair.girlfriendWs.readyState === WebSocket.OPEN) {
              send(pair.girlfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
              deviceRoles.delete(pair.girlfriendWs);
            }
            pairs.delete(device.pairId);
          } else {
            pair.girlfriendWs = null;
            if (pair.boyfriendWs && pair.boyfriendWs.readyState === WebSocket.OPEN) {
              send(pair.boyfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
            }
          }
        }
        deviceRoles.delete(ws);
        send(ws, { type: "pair_left", message: "已退出配对" });
        break;
      }

      default:
        send(ws, { type: "error", message: "未知消息类型" });
    }
  });

  ws.on("close", () => {
    const device = deviceRoles.get(ws);
    if (device) {
      const pair = pairs.get(device.pairId);
      if (pair) {
        if (device.role === "boyfriend") {
          if (pair.girlfriendWs && pair.girlfriendWs.readyState === WebSocket.OPEN) {
            send(pair.girlfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
            deviceRoles.delete(pair.girlfriendWs);
          }
          pairs.delete(device.pairId);
        } else {
          pair.girlfriendWs = null;
          if (pair.boyfriendWs && pair.boyfriendWs.readyState === WebSocket.OPEN) {
            send(pair.boyfriendWs, { type: "partner_disconnected", message: "对方已断开连接" });
          }
        }
      }
      deviceRoles.delete(ws);
    }
    console.log("[断开] 设备断开连接");
  });
});

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

server.listen(PORT, () => {
  console.log(`情侣点单系统已启动: http://localhost:${PORT}`);
});
