const http = require("http");

const data = JSON.stringify({
  model: "vgo-cs",
  messages: [{role: "user", content: "Hello"}],
  stream: false
});

const req = http.request({
  hostname: "vgo-customer-service",
  port: 11434,
  path: "/v1/chat/completions",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": data.length
  }
}, (res) => {
  let body = "";
  res.on("data", (chunk) => body += chunk);
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    console.log("Response:", body);
  });
});

req.on("error", (e) => {
  console.error("Error:", e.message);
});

req.write(data);
req.end();
