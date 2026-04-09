const https = require('https');

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMzgwZGI1MC0zNDIxLTRhNTYtYmQxMS05MDA2Nzk4MmJiNmYiLCJlbWFpbCI6IjEwNDc3NjQwMEBxcS5jb20iLCJpYXQiOjE3NzU0ODYwMTMsImV4cCI6MTc3NjA5MDgxM30.d3ZbatonppNVEa7Dtjqde2F4M2TqKE3ihY5sOm7mVeg";
const model = "claude-haiku-4-5";

const postData = JSON.stringify({
  model: model,
  messages: [
    { role: "user", content: "hi" }
  ]
});

const options = {
  hostname: "vgoai.cn",
  port: 443,
  path: "/api/v1/chat/send",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  }
};

const req = https.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => data += chunk);
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    console.log("Response:", data);
  });
});

req.on("error", (e) => {
  console.error("Error:", e.message);
});

req.write(postData);
req.end();
