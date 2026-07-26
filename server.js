// server.js
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { findOrCreateCustomer, createInvoice } = require('./qbo');
require('dotenv').config();

const app = express();
app.use(express.json());

const TOKEN_FILE = path.join(__dirname, 'tokens.json');

// Your active Codespaces public URL (Must match Redirect URI in Intuit Developer Settings)
const REDIRECT_URI = 'https://curly-cod-g4v7w9jw544fx6v-3000.app.github.dev/callback';

const getAuthHeader = () => {
    return Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
};

// =========================================================================
// OAUTH INITIALIZATION ROUTES
// =========================================================================

// 1. Visit this route in your browser to kick off QuickBooks authorization
app.get('/auth', (req, res) => {
    const authUrl = `https://appcenter.intuit.com/connect/oauth2` +
        `?client_id=${process.env.QBO_CLIENT_ID}` +
        `&response_type=code` +
        `&scope=com.intuit.quickbooks.accounting` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&state=random_state_string`;

    res.redirect(authUrl);
});

// 2. Intuit redirects here with authorization code
app.get('/callback', async (req, res) => {
    const authCode = req.query.code;
    const realmId = req.query.realmId;

    if (!authCode) {
        return res.status(400).send("Missing authorization code.");
    }

    try {
        const tokenRes = await axios.post(
            'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            `grant_type=authorization_code&code=${authCode}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
            {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${getAuthHeader()}`
                }
            }
        );

        // Save tokens to local tokens.json file
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({
            access_token: tokenRes.data.access_token,
            refresh_token: tokenRes.data.refresh_token
        }, null, 2));

        console.log("\n==========================================");
        console.log("SUCCESS! Tokens obtained and saved into tokens.json");
        console.log(`Company Realm ID: ${realmId}`);
        console.log("==========================================\n");

        res.send("<h1>Authentication Successful!</h1><p>Tokens saved to tokens.json. You can now close this tab.</p>");
    } catch (err) {
        console.error("Token Exchange Error:", err.response?.data || err.message);
        res.status(500).send("Failed to exchange auth code for tokens.");
    }
});

// =========================================================================
// HUBSPOT WEBHOOK ROUTE
// =========================================================================
app.post('/webhook/hubspot', async (req, res) => {
    // Acknowledge receipt to HubSpot immediately
    res.status(200).send("Webhook received");

    try {
        const dealData = req.body;
        
        // Ensure stage is closedwon
        if (dealData.dealstage !== 'closedwon') {
            console.log("Deal stage is not Closed Won. Skipping.");
            return;
        }

        const customerInfo = {
            firstName: dealData.firstname || 'Unknown',
            lastName: dealData.lastname || 'Unknown',
            email: dealData.email,
            company: dealData.company || 'Unknown Company'
        };
        const dealAmount = parseFloat(dealData.amount);

        console.log(`\nProcessing Closed Won Deal for: ${customerInfo.email} | Amount: $${dealAmount}`);

        // Sync Customer and create Invoice in QBO
        const qboCustomerId = await findOrCreateCustomer(customerInfo);
        await createInvoice(qboCustomerId, dealAmount);

    } catch (error) {
        console.error("Error processing webhook:", error.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sync Middleware Server running on port ${PORT}`);
});