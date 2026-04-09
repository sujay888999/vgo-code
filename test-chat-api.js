const axios = require("axios");

async function test() {
  try {
    // First, login to get a token
    const loginRes = await axios.post("http://localhost:3001/api/v1/auth/login", {
      email: "104776400@qq.com",
      password: "your_password"
    });
    
    const token = loginRes.data?.data?.token;
    console.log("Login successful, token:", token ? "received" : "not received");
    
    if (token) {
      // Try sending a chat message
      const chatRes = await axios.post("http://localhost:3001/api/v1/chat/send", {
        messages: [{role: "user", content: "Hello"}],
        model: "vgo-customer-service"
      }, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });
      console.log("Chat response:", JSON.stringify(chatRes.data, null, 2));
    }
  } catch (e) {
    console.log("Error:", e.response?.data || e.message);
  }
}

test();
