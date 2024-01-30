const express = require("express");
const ethers = require("ethers");
const VaultPriceFeed = require("./contracts/VaultPriceFeed.json");
const WebSocket = require("ws");
const app = express();
const { google } = require('googleapis');
const serviceAccountKeyFile = "./credentials.json";
const sheetId = '1KXb7Gy_5FBa4OrKd4q8PVR8gPj4YHOPqOVLkt7raZQg';
const tabName = 'ETH Price Feed';
const cors = require("cors");
app.use(express.json());
app.use(cors()); // Enable CORS for all routes
const weth = "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB";
const intervalDuration = 301000; // 5 minutes and 1 second
let countdown = intervalDuration / 1000; // Countdown in seconds
let lastPrice = null;

const fetchAndBroadcastPrice = async () => {
  // Notify clients that the price is being updated
  countdown = intervalDuration / 1000; // Reset countdown after each fetch

  broadcastToClients({ message: "Updating price..." });

  try {
    const provider = new ethers.providers.JsonRpcProvider(
      "https://api.avax.network/ext/bc/C/rpc"
    );
    const routerContract = new ethers.Contract(
      VaultPriceFeed.address,
      VaultPriceFeed.abi,
      provider
    );
    const tx = await routerContract.getPriceV1(weth, false, true);
    const scaleFactor = ethers.BigNumber.from("10").pow(27);
    const priceInWei = ethers.BigNumber.from(tx);
    const price = priceInWei.div(scaleFactor);
    const adjusted = Number(price.toString()) / 1000;
    // Broadcast the updated price to all connected clients
    broadcastToClients({ price: adjusted });
    console.log(`ETH Exchange Price: ${adjusted}`);
   
    // Connect to g sheets
    const googleSheetClient = await _getGoogleSheetClient();
    // Record timestamp
    recordTimestamp();
    // Get Next Row
    const nextRow = await getNextAvailableRow(googleSheetClient, sheetId, tabName, 'A');
    const range = `B${nextRow}:B${nextRow}`;
    // Write current ETH price to spreadsheet
    const dataToBeInserted = [[adjusted]];
    await _writeGoogleSheet(googleSheetClient, sheetId, tabName, range, dataToBeInserted);
  // calculate change since last price check
  if (lastPrice !== null) {
    const changeRange = `C${nextRow}:C${nextRow}`;
    const percentageChange = ((adjusted - lastPrice) / lastPrice) * 100;
    const changeData = [[`${percentageChange.toFixed(2)}%`]]; // Ensure this is an array of arrays
    console.log(`Percentage Change: ${percentageChange.toFixed(2)}%`);
    await _writeGoogleSheet(googleSheetClient, sheetId, tabName, changeRange, changeData);
  }
    lastPrice = adjusted;
  } catch (err) {
    console.error(err);
    // Notify clients about the error
    broadcastToClients({ error: "Failed to fetch price" });
  }
};

// 
async function getNextAvailableRow(googleSheetClient, sheetId, tabName, column) {
  try {
      const res = await googleSheetClient.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `${tabName}!${column}:${column}`,
      });

      const rows = res.data.values || [];
      return rows.length + 1; // Plus 1 because array index starts at 0
  } catch (error) {
      console.error("Error occurred while getting the next available row:", error);
      return null;
  }
}

async function recordTimestamp() {
  try {
    // Generating google sheet client
    const googleSheetClient = await _getGoogleSheetClient();

    // Use column 'A' to determine the next available row
    const nextRow = await getNextAvailableRow(googleSheetClient, sheetId, tabName, 'A');

    // Prepare the timestamp
    const currentTime = new Date();
    const formattedTime = `${currentTime.toLocaleDateString()} ${currentTime.toLocaleTimeString()}`;

    // Write the timestamp to the next available row in column 'A'
    const range = `A${nextRow}:A${nextRow}`;
    const dataToBeInserted = [[formattedTime]];

    await _writeGoogleSheet(googleSheetClient, sheetId, tabName, range, dataToBeInserted);

  } catch (error) {
    console.error("Error occurred while recording timestamp:", error);
  }
}

async function _getGoogleSheetClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: serviceAccountKeyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  return google.sheets({
    version: 'v4',
    auth: authClient,
  });
}

async function _writeGoogleSheet(googleSheetClient, sheetId, tabName, range, data) {
  await googleSheetClient.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!${range}`,
      valueInputOption: 'USER_ENTERED',
      resource: {
          values: data
      },
  });
}
const wss = new WebSocket.Server({ noServer: true });
wss.on("connection", function connection(ws) {
  ws.on("message", function incoming(message) {
    console.log("received: %s", message);
  });
  ws.send(JSON.stringify({ message: "Connected to WebSocket Server" }));
});



const PORT = process.env.PORT || 4033;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Starting ETH WebSocket in 10 seconds...");
  console.log("Network: Avalanche Mainnet");
  console.log(`RPC: https://api.avax.network/ext/bc/C/rpc`);
  console.log('Fetching current Ethereum price...');
  fetchAndBroadcastPrice();
});

server.on("upgrade", function upgrade(request, socket, head) {
  wss.handleUpgrade(request, socket, head, function done(ws) {
    wss.emit("connection", ws, request);
  });
});

  // Helper function to broadcast messages to all connected clients
  const broadcastToClients = (message) => {
    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  };

  const startCountdown = () => {
    console.log(`${countdown} seconds until next price check...`);
    countdown -= 10; // Decrease countdown every 10 seconds
    if (countdown < 0) {
      countdown = intervalDuration / 1000;
    }
  };

setInterval(fetchAndBroadcastPrice, intervalDuration);
setInterval(startCountdown, 10000);