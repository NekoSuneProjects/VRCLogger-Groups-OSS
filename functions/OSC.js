const dgram = require("dgram");
const osc = require("osc-min");
const fs = require("fs");

const client = dgram.createSocket("udp4");
const getConfig = require("../functions/getConfig"); // Import the getConfig function

async function initializeConfig() {
  const Config = {
    OSC: {
      host: await getConfig("OSC.host"),
      port: await getConfig("OSC.port")
    }
  };
  return Config;
}

// Message queue
let messageQueue = [];

// Function to send OSC messages to the VRChat chatbox
async function sendChatboxMessage(address, args) {
  const Config = await initializeConfig(); // Fetch config settings from the database

  const oscArgs = args.map(arg => {
    if (typeof arg === "string") {
      return { type: "s", value: arg };
    } else if (typeof arg === "number") {
      return { type: "i", value: arg }; // use 'f' for float if needed
    } else if (typeof arg === "boolean") {
      return { type: "b", value: arg };
    } else {
      throw new Error("Unsupported argument type");
    }
  });

  // Create an OSC message
  const oscMessage = osc.toBuffer({
    address: address,
    args: oscArgs
  });

  client.send(
    oscMessage,
    0,
    oscMessage.length,
    Config.OSC.port,
    Config.OSC.host,
    err => {
      if (err) {
        console.error("Error sending message:", err);
      } else {
        console.log("Message sent to VRChat OSC");
      }
    }
  );
}

// Timer to process the message queue every 10 seconds
setInterval(() => {
  if (messageQueue.length > 0) {
    const message = messageQueue.shift(); // Get the first message in the queue
    sendChatboxMessage("/chatbox/input", [message, true]);
  }
}, 3000); // 10 seconds interval

// Function to add messages to the queue
function queueChatboxMessage(message) {
  messageQueue.push(message);
}

module.exports = {
  queueChatboxMessage
};
